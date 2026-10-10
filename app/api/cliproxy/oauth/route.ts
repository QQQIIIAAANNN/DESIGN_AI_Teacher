import { NextResponse } from "next/server";
import { exec } from "child_process";
import path from "path";
import fs from "fs";
import { getCliProxyExecutable } from "@/lib/cliproxy-server";
import { reviewAuthorizationError } from "@/lib/server-auth";

export const runtime = "nodejs";

type OAuthProviderConfig = {
  script: string;
  label: string;
  callbackPort?: number;
};

const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  codex: { script: "login_codex.bat", label: "Codex (ChatGPT Plus/Team/Pro)", callbackPort: 1455 },
  antigravity: { script: "login_antigravity.bat", label: "Google Antigravity", callbackPort: 51121 },
  claude: { script: "login_claude.bat", label: "Claude (Claude.ai 訂閱帳號)" }
};

function isOAuthProvider(value: unknown): value is keyof typeof OAUTH_PROVIDERS {
  return typeof value === "string" && Object.hasOwn(OAUTH_PROVIDERS, value);
}

export async function POST(request: Request) {
  try {
    const denied = await reviewAuthorizationError(request);
    if (denied) return denied;
    const body = await request.json().catch(() => ({}));
    const provider = body.provider;

    if (!isOAuthProvider(provider)) {
      return NextResponse.json(
        { error: `不支援的 OAuth 供應商，僅支援 ${Object.keys(OAUTH_PROVIDERS).join("、")}。` },
        { status: 400 }
      );
    }

    const { script, label, callbackPort } = OAUTH_PROVIDERS[provider];
    const cwd = process.cwd();
    const scriptPath = path.join(cwd, "scripts", "windows", script);

    if (!getCliProxyExecutable(cwd)) {
      return NextResponse.json(
        { error: "找不到 CLIProxyAPI。請先下載執行檔，或設定 CLIPROXY_BIN 指向它。" },
        { status: 404 }
      );
    }

    if (!fs.existsSync(scriptPath)) {
      return NextResponse.json({ error: `找不到 ${script} 登入腳本。` }, { status: 404 });
    }

    // 透過 exec 呼叫 Windows 原生 start 指令，傳入引號路徑，杜絕 Node 引號跳脫反斜線問題
    exec(`start "" "${scriptPath}"`, { cwd });

    return NextResponse.json({
      success: true,
      provider,
      providerName: label,
      message: `✨ 已開啟 ${label} 登入視窗！請在自動彈出的授權頁面完成登入，完成後即可直接使用帳號額度審圖。`,
      callbackPort,
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
