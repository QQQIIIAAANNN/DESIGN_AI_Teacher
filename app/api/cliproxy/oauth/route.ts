import { NextResponse } from "next/server";
import { exec } from "child_process";
import path from "path";
import fs from "fs";
import { getCliProxyExecutable } from "@/lib/cliproxy-server";
import { reviewAuthorizationError } from "@/lib/server-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const denied = await reviewAuthorizationError(request);
    if (denied) return denied;
    const body = await request.json().catch(() => ({}));
    const provider = body.provider;

    if (provider !== "codex" && provider !== "antigravity") {
      return NextResponse.json(
        { error: "不支援的 OAuth 供應商，僅支援 'codex' 或 'antigravity'。" },
        { status: 400 }
      );
    }

    const cwd = process.cwd();
    const scriptName = provider === "codex" ? "login_codex.bat" : "login_antigravity.bat";
    const scriptPath = path.join(cwd, "scripts", "windows", scriptName);

    if (!getCliProxyExecutable(cwd)) {
      return NextResponse.json(
        { error: "找不到 CLIProxyAPI。請先下載執行檔，或設定 CLIPROXY_BIN 指向它。" },
        { status: 404 }
      );
    }

    // 檢查專用登入批次檔是否存在
    if (!fs.existsSync(scriptPath)) {
      return NextResponse.json(
        { error: `找不到 ${scriptName} 登入腳本。` },
        { status: 404 }
      );
    }

    // 透過 exec 呼叫 Windows 原生 start 指令，傳入引號路徑，杜絕 Node 引號跳脫反斜線問題
    exec(`start "" "${scriptPath}"`, { cwd });

    const providerName =
      provider === "codex" ? "Codex (ChatGPT Plus/Team/Pro)" : "Google Antigravity";

    return NextResponse.json({
      success: true,
      provider,
      providerName,
      message: `✨ 已開啟 ${providerName} 登入視窗！請在自動彈出的授權頁面完成登入，完成後即可直接使用帳號額度審圖。`,
      callbackPort: provider === "codex" ? 1455 : 51121,
      managementUrl: (process.env.NEXT_PUBLIC_CLIPROXY_MANAGEMENT_URL || "http://127.0.0.1:8317").trim()
    });
  } catch (error) {
    console.error("CLIProxy OAuth trigger failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "啟動 OAuth 流程時發生錯誤。" },
      { status: 500 }
    );
  }
}
