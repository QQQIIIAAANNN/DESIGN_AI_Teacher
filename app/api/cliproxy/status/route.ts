import { NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import {
  getCliProxyBaseUrl,
  getCliProxyExecutable,
  getCliProxyModelStatus,
  isLocalCliProxyUrl,
  startCliProxy
} from "@/lib/cliproxy-server";
import { reviewAuthorizationError } from "@/lib/server-auth";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getCliProxyModelStatus();
  const hasBinary = Boolean(getCliProxyExecutable());
  const autoStart =
    !status.running &&
    !process.env.NEXT_PUBLIC_SUPABASE_URL &&
    hasBinary &&
    process.env.CLIPROXY_AUTO_START === "1" &&
    isLocalCliProxyUrl();
  const launch = autoStart ? startCliProxy() : null;
  const starting = Boolean(launch?.success);
  const message = status.running
    ? status.message
    : starting
      ? "正在背景啟動 CLIProxyAPI，稍後會自動重新偵測。"
      : hasBinary
        ? "CLIProxyAPI 尚未啟動，請重新偵測或啟動服務。"
        : "尚未安裝 CLIProxyAPI，請先下載執行檔。";

  return NextResponse.json({
    running: status.running,
    starting,
    hasBinary,
    authenticated: status.authenticated,
    ready: status.running && status.models.length > 0,
    baseUrl: getCliProxyBaseUrl(),
    managementUrl: getCliProxyBaseUrl() + "/management.html",
    models: status.models,
    error: status.running && (!status.authenticated || (status.statusCode ?? 0) >= 400),
    message
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    const denied = await reviewAuthorizationError(request);
    if (denied) return denied;
    const body = await request.json().catch(() => ({}));
    const action = body.action;
    const cwd = process.cwd();

    if (action === "download") {
      const scriptPath = path.join(cwd, "scripts", "download-cliproxy.mjs");
      const child = spawn("node", [scriptPath], {
        cwd,
        detached: true,
        stdio: "ignore",
        windowsHide: true
      });
      child.unref();

      return NextResponse.json({
        success: true,
        message: "已在背景啟動官方 CLIProxyAPI 下載與解壓縮程序，約需 15~30 秒完成。"
      });
    }

    if (action === "start") {
      if (!isLocalCliProxyUrl()) {
        return NextResponse.json(
          { error: "目前設定的是遠端 CLIProxyAPI，無法從這台電腦啟動本機服務。" },
          { status: 400 }
        );
      }
      const status = await getCliProxyModelStatus();
      if (status.running) {
        return NextResponse.json({ success: true, ready: status.models.length > 0, message: status.message });
      }
      const result = startCliProxy(cwd);
      if (!result.success) {
        return NextResponse.json({ error: result.error || "啟動失敗。" }, { status: 404 });
      }
      return NextResponse.json({
        success: true,
        starting: true,
        message: "CLIProxyAPI 正在背景啟動，服務就緒後會自動更新模型清單。"
      });
    }

    return NextResponse.json({ error: "不支援的 action。" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "操作失敗。" },
      { status: 500 }
    );
  }
}
