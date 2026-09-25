type ChatTextPart = { type: "text"; text: string };
type ChatImagePart = { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } };
type ChatContent = string | Array<ChatTextPart | ChatImagePart>;
type ChatMessage = { role: "system" | "user" | "assistant"; content: ChatContent };

const DEFAULT_ALLOWED_ORIGINS = "https://qqqiiiaaannn.github.io,http://localhost:3000";
const MAX_REQUEST_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function allowedOrigins() {
  const value = Deno.env.get("AI_PROXY_ALLOWED_ORIGINS") || DEFAULT_ALLOWED_ORIGINS;
  return new Set(value.split(",").map((origin) => origin.trim()).filter(Boolean));
}

function corsHeaders(origin: string | null) {
  const headers = new Headers({
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "Vary": "Origin"
  });
  if (origin && allowedOrigins().has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

function jsonResponse(body: unknown, status: number, origin: string | null) {
  const headers = corsHeaders(origin);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { status, headers });
}

function parseAllowlist(value: string | undefined) {
  return new Set((value || "").split(",").map((entry) => entry.trim()).filter(Boolean));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateMessages(input: unknown): ChatMessage[] | null {
  if (!Array.isArray(input) || input.length < 1 || input.length > 20) return null;

  let textCharacters = 0;
  let imageCharacters = 0;
  const messages: ChatMessage[] = [];

  for (const item of input) {
    if (!isRecord(item) || !["system", "user", "assistant"].includes(String(item.role))) return null;
    if (typeof item.content === "string") {
      textCharacters += item.content.length;
      messages.push({ role: item.role as ChatMessage["role"], content: item.content });
      continue;
    }
    if (!Array.isArray(item.content) || item.content.length < 1 || item.content.length > 8) return null;

    const parts: Array<ChatTextPart | ChatImagePart> = [];
    for (const part of item.content) {
      if (!isRecord(part)) return null;
      if (part.type === "text" && typeof part.text === "string") {
        textCharacters += part.text.length;
        parts.push({ type: "text", text: part.text });
        continue;
      }
      if (part.type === "image_url" && isRecord(part.image_url) && typeof part.image_url.url === "string") {
        const url = part.image_url.url;
        if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(url)) return null;
        imageCharacters += url.length;
        const detail = ["auto", "low", "high"].includes(String(part.image_url.detail))
          ? part.image_url.detail as "auto" | "low" | "high"
          : "high";
        parts.push({ type: "image_url", image_url: { url, detail } });
        continue;
      }
      return null;
    }
    messages.push({ role: item.role as ChatMessage["role"], content: parts });
  }

  if (textCharacters > 50000 || imageCharacters > 11 * 1024 * 1024) return null;
  return messages;
}

function base64Bytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin);

  if (origin && !allowedOrigins().has(origin)) {
    return jsonResponse({ error: "Origin is not allowed." }, 403, origin);
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405, origin);
  }

  const authorization = request.headers.get("authorization") || "";
  const publishableKey = request.headers.get("apikey") || "";
  if (!authorization.toLowerCase().startsWith("bearer ") || !publishableKey) {
    return jsonResponse({ error: "Sign in to use the AI service." }, 401, origin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const proxyBaseUrl = Deno.env.get("CLIPROXY_BASE_URL") || "";
  const proxyApiKey = Deno.env.get("CLIPROXY_API_KEY") || "";
  if (!supabaseUrl || !proxyBaseUrl || !proxyApiKey) {
    return jsonResponse({ error: "The private AI service is not configured yet." }, 503, origin);
  }

  let proxyBase: URL;
  try {
    proxyBase = new URL(proxyBaseUrl);
  } catch {
    return jsonResponse({ error: "The private AI service URL is invalid." }, 503, origin);
  }
  if (proxyBase.protocol !== "https:") {
    return jsonResponse({ error: "The private AI service must use HTTPS." }, 503, origin);
  }

  const contentLength = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return jsonResponse({ error: "Request is too large." }, 413, origin);
  }

  let payload: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
      return jsonResponse({ error: "Request is too large." }, 413, origin);
    }
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) return jsonResponse({ error: "Invalid request body." }, 400, origin);
    payload = parsed;
  } catch {
    return jsonResponse({ error: "Invalid request body." }, 400, origin);
  }

  const action = payload.action;
  const model = typeof payload.model === "string" ? payload.model.trim() : "";
  const chatModels = parseAllowlist(Deno.env.get("CLIPROXY_CHAT_MODELS"));
  const imageModels = parseAllowlist(Deno.env.get("CLIPROXY_IMAGE_MODELS"));
  const allowedModels = action === "chat" ? chatModels : action === "image_edit" ? imageModels : new Set<string>();

  if (!model || !allowedModels.has(model)) {
    return jsonResponse({ error: "The requested model is not enabled on this service." }, 400, origin);
  }

  const authUrl = supabaseUrl.replace(/\/+$/, "") + "/auth/v1/user";
  let userResponse: Response;
  try {
    userResponse = await fetch(authUrl, {
      headers: { apikey: publishableKey, Authorization: authorization },
      signal: AbortSignal.timeout(10000)
    });
  } catch {
    return jsonResponse({ error: "Could not verify the signed-in account." }, 503, origin);
  }
  if (!userResponse.ok) {
    return jsonResponse({ error: "Sign in again to use the AI service." }, 401, origin);
  }

  let user: Record<string, unknown>;
  try {
    const body = await userResponse.json();
    if (!isRecord(body)) return jsonResponse({ error: "Could not verify the signed-in account." }, 401, origin);
    user = body;
  } catch {
    return jsonResponse({ error: "Could not verify the signed-in account." }, 401, origin);
  }
  const appMetadata = isRecord(user.app_metadata) ? user.app_metadata : {};
  if (appMetadata.membership_status !== "active") {
    return jsonResponse({ error: "This account has not been approved for the private AI service." }, 403, origin);
  }

  let upstreamUrl = "";
  let upstreamInit: RequestInit;

  if (action === "chat") {
    const messages = validateMessages(payload.messages);
    if (!messages) return jsonResponse({ error: "The review request is invalid or too large." }, 400, origin);
    upstreamUrl = proxyBase.toString().replace(/\/+$/, "") + "/v1/chat/completions";
    upstreamInit = {
      method: "POST",
      headers: {
        Authorization: "Bearer " + proxyApiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model, messages, stream: false, max_tokens: 4096, temperature: 0.1 })
    };
  } else if (action === "image_edit") {
    if (typeof payload.prompt !== "string" || payload.prompt.trim().length < 1 || payload.prompt.length > 4000) {
      return jsonResponse({ error: "The image suggestion prompt is invalid." }, 400, origin);
    }
    if (!isRecord(payload.image) || typeof payload.image.mime_type !== "string" || typeof payload.image.base64 !== "string") {
      return jsonResponse({ error: "A cropped reference image is required." }, 400, origin);
    }
    const mimeType = payload.image.mime_type;
    const base64 = payload.image.base64;
    if (!["image/png", "image/jpeg", "image/webp"].includes(mimeType) || base64.length > MAX_IMAGE_BYTES * 1.4) {
      return jsonResponse({ error: "The cropped reference image is not supported or is too large." }, 413, origin);
    }
    let bytes: Uint8Array;
    try {
      bytes = base64Bytes(base64);
    } catch {
      return jsonResponse({ error: "The cropped reference image is invalid." }, 400, origin);
    }
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      return jsonResponse({ error: "The cropped reference image is too large." }, 413, origin);
    }

    const form = new FormData();
    form.set("model", model);
    form.set("prompt", payload.prompt.trim());
    form.set("n", "1");
    form.append("image", new Blob([bytes], { type: mimeType }), "issue-area.png");
    upstreamUrl = proxyBase.toString().replace(/\/+$/, "") + "/v1/images/edits";
    upstreamInit = {
      method: "POST",
      headers: { Authorization: "Bearer " + proxyApiKey },
      body: form
    };
  } else {
    return jsonResponse({ error: "Unsupported AI task." }, 400, origin);
  }

  let quotaResponse: Response;
  try {
    quotaResponse = await fetch(supabaseUrl.replace(/\/+$/, "") + "/rest/v1/rpc/consume_ai_request", {
      method: "POST",
      headers: {
        apikey: publishableKey,
        Authorization: authorization,
        "Content-Type": "application/json"
      },
      body: "{}",
      signal: AbortSignal.timeout(10000)
    });
  } catch {
    return jsonResponse({ error: "Could not check the account's AI request limit." }, 503, origin);
  }
  if (!quotaResponse.ok) {
    return jsonResponse({ error: "Could not check the account's AI request limit." }, 503, origin);
  }
  let quotaAllowed = false;
  try {
    quotaAllowed = (await quotaResponse.json()) === true;
  } catch {
    return jsonResponse({ error: "Could not check the account's AI request limit." }, 503, origin);
  }
  if (!quotaAllowed) {
    return jsonResponse({ error: "Daily AI request limit reached. Try again tomorrow." }, 429, origin);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, { ...upstreamInit, signal: controller.signal });
  } catch {
    return jsonResponse({ error: "The private AI service could not complete the request." }, 502, origin);
  } finally {
    clearTimeout(timeout);
  }

  if (!upstream.ok) {
    const status = upstream.status === 429 ? 429 : 502;
    return jsonResponse({
      error: upstream.status === 429
        ? "The AI provider is temporarily rate limited."
        : "The private AI service returned an error."
    }, status, origin);
  }

  const responseText = await upstream.text();
  if (new TextEncoder().encode(responseText).byteLength > 16 * 1024 * 1024) {
    return jsonResponse({ error: "The AI response is too large." }, 502, origin);
  }
  const responseHeaders = corsHeaders(origin);
  responseHeaders.set("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
  return new Response(responseText, { status: 200, headers: responseHeaders });
});
