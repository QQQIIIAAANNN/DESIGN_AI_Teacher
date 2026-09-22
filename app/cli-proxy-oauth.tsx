"use client";

import { useState } from "react";

const defaultManagementUrl =
  (process.env.NEXT_PUBLIC_CLIPROXY_MANAGEMENT_URL || "http://127.0.0.1:8317").trim();

function normalizedBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

export default function CliProxyOAuthPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [managementUrl, setManagementUrl] = useState(defaultManagementUrl);
  const [message, setMessage] = useState("");

  const base = normalizedBaseUrl(managementUrl);
  const managementCenterUrl = base ? base + "/management.html" : "";

  async function copyCommand(command: string, label: string) {
    try {
      await navigator.clipboard.writeText(command);
      setMessage(label + "登入指令已複製；請在 CLIProxyAPI 所在電腦執行。");
    } catch {
      setMessage("請在 CLIProxyAPI 所在電腦執行：" + command);
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
        CLIProxyAPI 設定
      </button>

      {isOpen && (
        <section
          id="cliproxy-settings-panel"
          className="cliproxy-settings-panel"
          aria-labelledby="cliproxy-settings-title"
        >
          <div className="cliproxy-settings-heading">
            <div>
              <span className="step">LOCAL OAUTH</span>
              <h2 id="cliproxy-settings-title">CLIProxyAPI 登入設定</h2>
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
            OAuth 由 CLIProxyAPI 原生管理中心或本機 CLI 完成；本站不呼叫管理 API，也不要求輸入 API key。
          </p>

          <label className="cliproxy-settings-field">
            <span>CLIProxyAPI 位址</span>
            <input
              type="url"
              value={managementUrl}
              onChange={(event) => setManagementUrl(event.target.value)}
              placeholder="http://127.0.0.1:8317"
              autoComplete="off"
            />
          </label>

          <div className="cliproxy-settings-actions">
            <a
              className="cliproxy-settings-link primary"
              href={managementCenterUrl || "#"}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => {
                if (!managementCenterUrl) event.preventDefault();
              }}
            >
              開啟 CLIProxyAPI 管理中心
            </a>
            <span className="cliproxy-settings-help">
              管理中心：<code>/management.html</code>
            </span>
          </div>

          <div className="cliproxy-command-list">
            <div className="cliproxy-command-item">
              <div>
                <strong>Codex OAuth</strong>
                <code>cli-proxy-api --codex-login</code>
              </div>
              <button
                type="button"
                className="cliproxy-command-button"
                onClick={() => void copyCommand("cli-proxy-api --codex-login", "Codex")}
              >
                複製指令
              </button>
            </div>
            <div className="cliproxy-command-item">
              <div>
                <strong>Antigravity OAuth</strong>
                <code>cli-proxy-api --antigravity-login</code>
              </div>
              <button
                type="button"
                className="cliproxy-command-button"
                onClick={() => void copyCommand("cli-proxy-api --antigravity-login", "Antigravity")}
              >
                複製指令
              </button>
            </div>
          </div>

          {message && <p className="cliproxy-settings-status" role="status">{message}</p>}

          <p className="cliproxy-settings-note">
            Codex OAuth 使用本機 callback 1455；Antigravity 使用 51121。完成登入後，憑證由 CLIProxyAPI 儲存在自己的 auth-dir。
          </p>
        </section>
      )}
    </div>
  );
}
