import { NextResponse } from "next/server";

export async function reviewAuthorizationError(request: Request): Promise<NextResponse | null> {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "").trim();
  if (!url || !key) return null; // The local-only CLI configuration has no Supabase account layer.
  const header = request.headers.get("authorization") || "";
  if (!/^Bearer\s+\S+$/i.test(header)) {
    return NextResponse.json({ error: "請先登入已核准的帳號。" }, { status: 401 });
  }
  try {
    const response = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: key, Authorization: header }, cache: "no-store",
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return NextResponse.json({ error: "登入狀態已失效，請重新登入。" }, { status: 401 });
    const user = await response.json() as { app_metadata?: { membership_status?: string } };
    if (user.app_metadata?.membership_status !== "active") {
      return NextResponse.json({ error: "此帳號尚未取得審圖權限。" }, { status: 403 });
    }
    return null;
  } catch {
    return NextResponse.json({ error: "目前無法驗證會員資格，請稍後重試。" }, { status: 503 });
  }
}
