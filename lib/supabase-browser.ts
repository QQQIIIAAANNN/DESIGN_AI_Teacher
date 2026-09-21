export type SupabaseBrowserUser = {
  id: string;
  email?: string;
  app_metadata?: Record<string, unknown>;
};

export type SupabaseBrowserSession = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  user: SupabaseBrowserUser;
};

export type QuestionExamType =
  | "architectural_design"
  | "site_planning"
  | "civil_service_grade_3"
  | "other";

export type SupabaseQuestionPaper = {
  id: string;
  exam_year: number;
  exam_type: QuestionExamType;
  title: string;
  original_filename: string;
  size_bytes: number;
  storage_path: string;
  status: "draft" | "published" | "archived";
  created_at: string;
};

export type AiProxyPayload =
  | {
      action: "chat";
      model: string;
      messages: Array<{
        role: "system" | "user" | "assistant";
        content:
          | string
          | Array<
              | { type: "text"; text: string }
              | {
                  type: "image_url";
                  image_url: { url: string; detail?: "auto" | "low" | "high" };
                }
            >;
      }>;
    }
  | {
      action: "image_edit";
      model: string;
      prompt: string;
      image: { mime_type: string; base64: string };
    };

type SupabaseConfig = { url: string; publishableKey: string };

type AuthResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  expires_in?: number;
  user?: SupabaseBrowserUser;
};

const SESSION_KEY_PREFIX = "design-ai-teacher:supabase-session:v1:";

export function getSupabaseConfig(): SupabaseConfig | null {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const publishableKey = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "").trim();
  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}

export function isSupabaseConfigured() {
  return getSupabaseConfig() !== null;
}

export function isLiveReviewConfigured() {
  return isSupabaseConfigured() && Boolean((process.env.NEXT_PUBLIC_REVIEW_MODEL || "").trim());
}

export function isImageSuggestionConfigured() {
  return isSupabaseConfigured() && Boolean((process.env.NEXT_PUBLIC_IMAGE_MODEL || "").trim());
}

export function isActiveMember(user: SupabaseBrowserUser | null | undefined) {
  return user?.app_metadata?.membership_status === "active";
}

export function canCurateQuestionBank(user: SupabaseBrowserUser | null | undefined) {
  const roles = user?.app_metadata?.roles;
  return (
    Array.isArray(roles) &&
    (roles.includes("curator") || roles.includes("admin"))
  );
}

function storageKey() {
  const config = getSupabaseConfig();
  if (!config) return null;
  try {
    return SESSION_KEY_PREFIX + new URL(config.url).hostname;
  } catch {
    return SESSION_KEY_PREFIX + config.url;
  }
}

function readStoredSession(): SupabaseBrowserSession | null {
  if (typeof window === "undefined") return null;
  const key = storageKey();
  if (!key) return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || "null");
    if (
      !parsed ||
      typeof parsed.access_token !== "string" ||
      typeof parsed.refresh_token !== "string" ||
      typeof parsed.expires_at !== "number" ||
      !parsed.user ||
      typeof parsed.user.id !== "string"
    ) {
      return null;
    }
    return parsed as SupabaseBrowserSession;
  } catch {
    return null;
  }
}

function writeStoredSession(session: SupabaseBrowserSession | null) {
  if (typeof window === "undefined") return;
  const key = storageKey();
  if (!key) return;
  if (!session) {
    window.localStorage.removeItem(key);
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(session));
}

function normalizeSession(response: AuthResponse): SupabaseBrowserSession {
  if (!response.access_token || !response.refresh_token || !response.user?.id) {
    throw new Error("Supabase 沒有回傳有效的登入狀態。");
  }
  const now = Math.floor(Date.now() / 1000);
  return {
    access_token: response.access_token,
    refresh_token: response.refresh_token,
    expires_at: response.expires_at || now + (response.expires_in || 3600),
    user: response.user
  };
}

async function responseError(response: Response) {
  try {
    const body = await response.json();
    if (typeof body?.msg === "string") return body.msg;
    if (typeof body?.message === "string") return body.message;
    if (typeof body?.error_description === "string") return body.error_description;
    if (typeof body?.error === "string") return body.error;
  } catch {
    // Keep the user-facing error generic when a service returns non-JSON.
  }
  return "服務暫時無法完成要求，請稍後再試。";
}

async function authRequest<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const config = getSupabaseConfig();
  if (!config) throw new Error("尚未設定 Supabase 專案。");
  const response = await fetch(config.url + "/auth/v1/" + path, {
    method: "POST",
    headers: {
      apikey: config.publishableKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(await responseError(response));
  return (await response.json()) as T;
}

export async function requestEmailOtp(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !normalizedEmail.includes("@")) {
    throw new Error("請輸入有效的電子郵件地址。");
  }
  await authRequest("otp", { email: normalizedEmail, create_user: false });
}

export async function verifyEmailOtp(email: string, token: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedToken = token.replace(/\s+/g, "");
  if (!normalizedEmail || normalizedToken.length < 6) {
    throw new Error("請輸入收到的 6 位數登入碼。");
  }
  const response = await authRequest<AuthResponse>("verify", {
    email: normalizedEmail,
    token: normalizedToken,
    type: "email"
  });
  const session = normalizeSession(response);
  writeStoredSession(session);
  return session;
}

async function refreshSession(session: SupabaseBrowserSession) {
  const response = await authRequest<AuthResponse>("token?grant_type=refresh_token", {
    refresh_token: session.refresh_token
  });
  const refreshed = normalizeSession(response);
  writeStoredSession(refreshed);
  return refreshed;
}

export async function getSavedSession() {
  const session = readStoredSession();
  if (!session) return null;
  if (session.expires_at > Math.floor(Date.now() / 1000) + 90) return session;
  try {
    return await refreshSession(session);
  } catch {
    writeStoredSession(null);
    return null;
  }
}

export async function signOutSupabase(session?: SupabaseBrowserSession | null) {
  const stored = readStoredSession();
  const current = stored && (!session || stored.user.id === session.user.id)
    ? stored
    : session || stored;
  const config = getSupabaseConfig();
  if (!config) return;
  if (current?.access_token) {
    try {
      await fetch(config.url + "/auth/v1/logout", {
        method: "POST",
        headers: {
          apikey: config.publishableKey,
          Authorization: "Bearer " + current.access_token
        }
      });
    } catch {
      // Clearing the browser session is sufficient if the network is unavailable.
    }
  }
  writeStoredSession(null);
}

async function authorizedFetch(
  session: SupabaseBrowserSession,
  path: string,
  init: RequestInit = {}
) {
  const config = getSupabaseConfig();
  if (!config) throw new Error("尚未設定 Supabase 專案。");

  const stored = readStoredSession();
  let current = stored && stored.user.id === session.user.id ? stored : session;
  if (current.expires_at <= Math.floor(Date.now() / 1000) + 90) {
    current = await refreshSession(current);
  }

  const send = (activeSession: SupabaseBrowserSession) =>
    fetch(config.url + "/" + path.replace(/^\/+/, ""), {
      ...init,
      headers: {
        apikey: config.publishableKey,
        Authorization: "Bearer " + activeSession.access_token,
        ...Object.fromEntries(new Headers(init.headers).entries())
      }
    });

  let response = await send(current);
  if (response.status === 401) {
    current = await refreshSession(current);
    response = await send(current);
  }
  return response;
}

async function authorizedJson<T>(
  session: SupabaseBrowserSession,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await authorizedFetch(session, path, init);
  if (!response.ok) throw new Error(await responseError(response));
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function listQuestionPapers(session: SupabaseBrowserSession) {
  const statusFilter = canCurateQuestionBank(session.user)
    ? "&status=in.(draft,published)"
    : "&status=eq.published";
  const query =
    "rest/v1/question_papers?select=id,exam_year,exam_type,title,original_filename,size_bytes,storage_path,status,created_at" +
    statusFilter +
    "&order=exam_year.desc,title.asc";
  return authorizedJson<SupabaseQuestionPaper[]>(session, query);
}

export async function createQuestionSignedUrl(
  session: SupabaseBrowserSession,
  storagePath: string
) {
  const encodedPath = storagePath.split("/").map(encodeURIComponent).join("/");
  const result = await authorizedJson<{ signedURL?: string }>(
    session,
    "storage/v1/object/sign/exam-papers/" + encodedPath,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: 3600 })
    }
  );
  if (!result.signedURL) throw new Error("無法建立題目 PDF 預覽連結。");

  const config = getSupabaseConfig();
  if (!config) throw new Error("尚未設定 Supabase 專案。");
  if (/^https?:\/\//i.test(result.signedURL)) return result.signedURL;

  const path = result.signedURL.startsWith("/")
    ? result.signedURL
    : "/" + result.signedURL;
  return config.url + (path.startsWith("/storage/v1/") ? path : "/storage/v1" + path);
}

export async function uploadQuestionPaper(
  session: SupabaseBrowserSession,
  input: {
    year: number;
    category: QuestionExamType;
    title: string;
    file: File;
  }
) {
  if (input.file.size > 25 * 1024 * 1024) {
    throw new Error("PDF 超過 25 MB，請先縮小檔案。");
  }
  const config = getSupabaseConfig();
  if (!config) throw new Error("尚未設定 Supabase 專案。");

  const id = crypto.randomUUID();
  const storagePath = session.user.id + "/" + input.year + "/" + id + ".pdf";
  const encodedPath = storagePath.split("/").map(encodeURIComponent).join("/");
  const uploadResponse = await authorizedFetch(
    session,
    "storage/v1/object/exam-papers/" + encodedPath,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/pdf",
        "x-upsert": "false",
        "cache-control": "3600"
      },
      body: input.file
    }
  );
  if (!uploadResponse.ok) throw new Error(await responseError(uploadResponse));

  const record = {
    id,
    exam_year: input.year,
    exam_type: input.category,
    title: input.title.trim() || input.file.name.replace(/\.pdf$/i, ""),
    original_filename: input.file.name,
    storage_path: storagePath,
    mime_type: "application/pdf",
    size_bytes: input.file.size,
    uploaded_by: session.user.id,
    status: "draft"
  };
  const rows = await authorizedJson<SupabaseQuestionPaper[]>(
    session,
    "rest/v1/question_papers?select=id,exam_year,exam_type,title,original_filename,size_bytes,storage_path,status,created_at",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify(record)
    }
  );
  if (!rows[0]) throw new Error("PDF 已上傳，但題目索引沒有成功建立；請聯絡管理員檢查。");
  return rows[0];
}

export async function callAiProxy(
  session: SupabaseBrowserSession,
  payload: AiProxyPayload
) {
  const response = await authorizedFetch(session, "functions/v1/ai-proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(await responseError(response));
  return (await response.json()) as Record<string, unknown>;
}

export async function publishQuestionPaper(session: SupabaseBrowserSession, questionId: string) {
  const rows = await authorizedJson<SupabaseQuestionPaper[]>(
    session,
    "rest/v1/question_papers?id=eq." + encodeURIComponent(questionId),
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify({ status: "published" })
    }
  );
  if (!rows[0]) throw new Error("題目仍未發布，請確認目前帳號是否有題庫整理權限。");
  return rows[0];
}
