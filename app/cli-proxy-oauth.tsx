"use client";

import { useState, useEffect, useCallback } from "react";
import { getSavedSession } from "@/lib/supabase-browser";

async function controlHeaders() {
  const session = await getSavedSession();
  return { "Content-Type": "application/json", ...(session?.access_token
    ? { Authorization: `Bearer ${session.access_token}` } : {}) };
}

const defaultManagementUrl =
  (process.env.NEXT_PUBLIC_CLIPROXY_MANAGEMENT_URL || "http://127.0.0.1:8317").trim();

function normalizedBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

export default function CliProxyOAuthPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const managementUrl = defaultManagementUrl;
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [proxyStatus, setProxyStatus] = useState<{
    running: boolean;
    starting?: boolean;
    ready?: boolean;
    authenticated?: boolean;
    error?: boolean;
    hasBinary?: boolean;
    models: string[];
    message?: string;
  } | null>(null);

  const base = normalizedBaseUrl(managementUrl);
  const managementCenterUrl = base ? base + "/management.html" : "";

  const checkProxyStatus = useCallback(async () => {
    setIsCheckingStatus(true);
    try {
      const res = await fetch("/api/cliproxy/status", { cache: "no-store" });
      const data = await res.json();
      setProxyStatus({
        running: Boolean(data.running),
        starting: Boolean(data.starting),
        ready: Boolean(data.ready),
        authenticated: Boolean(data.authenticated),
        error: Boolean(data.error),
        hasBinary: Boolean(data.hasBinary),
        models: Array.isArray(data.models) ? data.models : [],
        message: data.message
      });
    } catch {
      setProxyStatus({
        running: false,
        ready: false,
        authenticated: false,
        error: true,
        hasBinary: false,
        models: [],
        message: "無法連接本地伺服器狀態端點。"
      });
    } finally {
      setIsCheckingStatus(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void checkProxyStatus();
    const timer = window.setInterval(() => void checkProxyStatus(), 4000);
    return () => window.clearInterval(timer);
  }, [isOpen, checkProxyStatus]);

  async function downloadCliProxy() {
    setMessage("正在從 GitHub 官方下載 CLIProxyAPI Windows 執行檔，約需 15~30 秒...");
    setIsError(false);
    try {
      const res = await fetch("/api/cliproxy/status", {
        method: "POST",
        headers: await controlHeaders(),
        body: JSON.stringify({ action: "download" })
      });
      const data = await res.json();
      if (data.success) {
        setMessage(data.message);
        window.setTimeout(() => void checkProxyStatus(), 1500);
      } else {
        setMessage(data.error || "下載失敗。");
        setIsError(true);
      }
    } catch {
      setMessage("下載請求失敗。");
      setIsError(true);
    }
  }

  async function startCliProxy() {
    setMessage("正在嘗試啟動本機 CLIProxyAPI (8317 port)...");
    setIsError(false);
    try {
      const res = await fetch("/api/cliproxy/status", {
        method: "POST",
        headers: await controlHeaders(),
        body: JSON.stringify({ action: "start" })
      });
      const data = await res.json();
      if (data.success) {
        setMessage(data.message || "CLIProxyAPI 正在背景啟動，模型清單會自動更新。");
        window.setTimeout(() => void checkProxyStatus(), 1000);
      } else {
        setMessage(data.error || "啟動失敗，請確認執行檔是否存在。");
        setIsError(true);
      }
    } catch {
      setMessage("啟動請求失敗，請手動執行 scripts\\windows\\start-local.bat。");
      setIsError(true);
    }
  }

  async function handleLaunchOAuth(provider: "codex" | "antigravity") {
    setLoadingProvider(provider);
    setIsError(false);
    const providerLabel = provider === "codex" ? "Codex (ChatGPT Plus/Pro)" : "Antigravity";
    setMessage(`正在為您開啟 ${providerLabel} OAuth 登入視窗...`);

    try {
      // 呼叫本地 Next.js 後端執行 OAuth 啟動指令 (喚起系統瀏覽器 OAuth 登入)
      const res = await fetch("/api/cliproxy/oauth", {
        method: "POST",
        headers: await controlHeaders(),
        body: JSON.stringify({ provider })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setMessage(
          `✨ ${providerLabel} 登入命令列視窗已開啟！請在自動彈出的瀏覽器中登入授權。完成後即可直接使用帳號額度審圖。`
        );
        setIsError(false);
      } else {
        setMessage(
          data.error || `未能直接啟動 ${providerLabel}，建議點擊下方「開啟 Web 管理中心」完成登入。`
        );
        setIsError(true);
      }
    } catch {
      setMessage(`連線失敗，請確認本地 Next.js 服務正常。`);
      setIsError(true);
    } finally {
      setLoadingProvider(null);
      void checkProxyStatus();
    }
  }

  async function copyCommand(command: string, label: string) {
    try {
      await navigator.clipboard.writeText(command);
      setMessage(label + " 指令已複製到剪貼簿；亦可在終端機手動執行。");
      setIsError(false);
    } catch {
      setMessage("手動執行指令：" + command);
      setIsError(false);
    }
  }

  return (
    <div className="cliproxy-settings">
      <button
        type="button"
        className="cliproxy-settings-trigger"
        aria-expanded={isOpen}
        aria-controls="cliproxy-settings-panel"
        onClick={() => setIsOpen((open) => !open)}
      >
        <span aria-hidden="true">⚙</span>
        {proxyStatus?.ready ? "🟢 CLIProxyAPI (模型可用)" : "CLIProxyAPI 設定"}
      </button>

      {isOpen && (
        <section
          id="cliproxy-settings-panel"
          className="cliproxy-settings-panel"
          aria-labelledby="cliproxy-settings-title"
        >
          <div className="cliproxy-settings-heading">
            <div>
              <span className="step">LOCAL OAUTH & QUOTA</span>
              <h2 id="cliproxy-settings-title">CLIProxyAPI 帳號額度登入</h2>
            </div>
            <button
              type="button"
              className="cliproxy-settings-close"
              onClick={() => setIsOpen(false)}
              aria-label="關閉 CLIProxyAPI 設定"
            >
              ×
            </button>
          </div>

          <p className="cliproxy-settings-copy">
            直接點擊下方登入按鈕即可開啟官方 OAuth 授權視窗，登入後審圖即可直接扣抵您的 ChatGPT Plus/Team 或 Antigravity 帳號額度。
          </p>

          {/* 連線狀態檢測卡片 */}
          <div className="cliproxy-status-box">
            <div className="cliproxy-status-header">
              <strong>
                狀態：
                {proxyStatus === null
                  ? "檢測中..."
                  : proxyStatus.ready
                  ? "🟢 已連線，OAuth 模型可用"
                  : proxyStatus.starting
                  ? "🟡 CLIProxyAPI 啟動中"
                  : proxyStatus.running
                  ? proxyStatus.authenticated === false
                    ? "🔴 服務已啟動，API key 尚未通過驗證"
                    : "🟡 服務已連線，尚未發現模型"
                  : proxyStatus.hasBinary
                  ? "🟡 執行檔已就緒 (尚未啟動服務)"
                  : "⚪ 尚未下載 cli-proxy-api.exe"}
              </strong>
              <div className="cliproxy-btn-group">
                <button
                  type="button"
                  className="cliproxy-command-button"
                  onClick={() => void checkProxyStatus()}
                  disabled={isCheckingStatus}
                >
                  {isCheckingStatus ? "檢測中..." : "🔄 重新檢測"}
                </button>
                {proxyStatus?.hasBinary && !proxyStatus.running && !proxyStatus.starting && (
                  <button
                    type="button"
                    className="cliproxy-primary-button"
                    style={{ minHeight: "26px", fontSize: "10px", padding: "0 8px" }}
                    onClick={() => void startCliProxy()}
                  >
                    🚀 啟動服務
                  </button>
                )}
                {!proxyStatus?.hasBinary && (
                  <button
                    type="button"
                    className="cliproxy-primary-button"
                    style={{ minHeight: "26px", fontSize: "10px", padding: "0 8px" }}
                    onClick={() => void downloadCliProxy()}
                  >
                    📥 下載執行檔
                  </button>
                )}
              </div>
            </div>

            {proxyStatus?.message && (
              <p
                className={`cliproxy-settings-status ${proxyStatus.error ? "error" : ""}`}
                role="status"
              >
                {proxyStatus.message}
              </p>
            )}

            {proxyStatus?.models && proxyStatus.models.length > 0 && (
              <div>
                <span style={{ fontSize: "10px", color: "#6e6860" }}>
                  可用 OAuth 模型（審圖將自動調用）：
                </span>
                <div className="cliproxy-models-list">
                  {proxyStatus.models.map((m) => (
                    <span key={m} className="cliproxy-model-pill">
                      {m}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 一鍵開啟 OAuth 登入視窗區塊 */}
          <div className="cliproxy-command-list">
            {/* Codex OAuth */}
            <div className="cliproxy-command-item">
              <div>
                <strong>Codex OAuth</strong>
                <span style={{ fontSize: "10px", color: "#666" }}>
                  使用 ChatGPT Plus / Team / Pro 帳號額度
                </span>
                <code>cli-proxy-api --codex-login</code>
              </div>
              <div className="cliproxy-btn-group">
                <button
                  type="button"
                  className="cliproxy-primary-button"
                  onClick={() => void handleLaunchOAuth("codex")}
                  disabled={loadingProvider === "codex"}
                >
                  {loadingProvider === "codex" ? "開啟中..." : "🔑 開啟登入視窗"}
                </button>
                <button
                  type="button"
                  className="cliproxy-command-button"
                  onClick={() => void copyCommand("cli-proxy-api --codex-login", "Codex")}
                  title="複製指令手動執行"
                >
                  複製指令
                </button>
              </div>
            </div>

            {/* Antigravity OAuth */}
            <div className="cliproxy-command-item">
              <div>
                <strong>Antigravity OAuth</strong>
                <span style={{ fontSize: "10px", color: "#666" }}>
                  使用 Google Antigravity / Gemini 帳號額度
                </span>
                <code>cli-proxy-api --antigravity-login</code>
              </div>
              <div className="cliproxy-btn-group">
                <button
                  type="button"
                  className="cliproxy-primary-button"
                  onClick={() => void handleLaunchOAuth("antigravity")}
                  disabled={loadingProvider === "antigravity"}
                >
                  {loadingProvider === "antigravity" ? "開啟中..." : "🔑 開啟登入視窗"}
                </button>
                <button
                  type="button"
                  className="cliproxy-command-button"
                  onClick={() => void copyCommand("cli-proxy-api --antigravity-login", "Antigravity")}
                  title="複製指令手動執行"
                >
                  複製指令
                </button>
              </div>
            </div>
          </div>

          {/* Web 管理中心快速入口 */}
          <div className="cliproxy-settings-actions" style={{ marginTop: "14px" }}>
            <a
              className="cliproxy-settings-link primary"
              href={managementCenterUrl || "#"}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => {
                if (!managementCenterUrl) event.preventDefault();
              }}
            >
              🌐 開啟 CLIProxyAPI Web 管理中心
            </a>
            <span className="cliproxy-settings-help">
              網址：<code>{managementCenterUrl || "http://127.0.0.1:8317/management.html"}</code>
            </span>
          </div>

          <label className="cliproxy-settings-field" style={{ marginTop: "12px" }}>
            <span>CLIProxyAPI 管理中心網址（於 .env.local 設定）</span>
            <input
              type="url"
              value={managementUrl}
              placeholder="http://127.0.0.1:8317"
              autoComplete="off"
              readOnly
            />
          </label>

          {message && (
            <p
              className={`cliproxy-settings-status ${isError ? "error" : ""}`}
              role="status"
            >
              {message}
            </p>
          )}

          <p className="cliproxy-settings-note">
            💡 提示：點擊按鈕開啟登入視窗後，授權由官方 OAuth 頁面完成，憑證僅由 CLIProxyAPI 安全保存在您本機的 auth-dir，絕不上傳到雲端或外部網站。
          </p>
        </section>
      )}
    </div>
  );
}
