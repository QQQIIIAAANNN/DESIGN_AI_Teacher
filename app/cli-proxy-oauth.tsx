"use client";

import { useRef, useState } from "react";

type OAuthProvider = "codex" | "antigravity";
type FlowStatus = "idle" | "starting" | "waiting" | "success" | "error";

type FlowState = {
  provider: OAuthProvider;
  status: FlowStatus;
  state?: string;
  message?: string;
};

const defaultManagementUrl =
  (process.env.NEXT_PUBLIC_CLIPROXY_MANAGEMENT_URL || "http://127.0.0.1:8317").trim();

const providerLabels: Record<OAuthProvider, string> = {
  codex: "Codex",
  antigravity: "Antigravity"
};

function normalizedBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export default function CliProxyOAuthPanel() {
  const [managementUrl, setManagementUrl] = useState(defaultManagementUrl);
  const [managementKey, setManagementKey] = useState("");
  const [flow, setFlow] = useState<FlowState>({ provider: "codex", status: "idle" });
  const runId = useRef(0);

  async function startOAuth(provider: OAuthProvider) {
    const base = normalizedBaseUrl(managementUrl);
    const key = managementKey.trim();
    if (!base) {
      setFlow({ provider, status: "error", message: "請先填入 CLIProxyAPI 管理位址。" });
      return;
    }
    if (!key) {
      setFlow({
        provider,
        status: "error",
        message: "請輸入 CLIProxyAPI 管理密鑰；這不是供應商 API key，也不會保存到瀏覽器。"
      });
      return;
    }

    const currentRun = ++runId.current;
    const popup = window.open("about:blank", "_blank");
    setFlow({ provider, status: "starting", message: "正在向 CLIProxyAPI 建立 OAuth 流程…" });

    try {
      const startResponse = await fetch(
        base + "/v0/management/" + provider + "-auth-url?is_webui=true",
        {
          headers: {
            Accept: "application/json",
            Authorization: "Bearer " + key
          }
        }
      );
      const startPayload = await startResponse.json().catch(() => ({}));
      if (!startResponse.ok || typeof startPayload.url !== "string" || typeof startPayload.state !== "string") {
        throw new Error(
          typeof startPayload.error === "string"
            ? startPayload.error
            : "CLIProxyAPI 沒有回傳有效的 OAuth 入口。"
        );
      }

      if (popup && !popup.closed) {
        popup.location.href = startPayload.url;
      } else {
        window.location.assign(startPayload.url);
      }

      setFlow({
        provider,
        status: "waiting",
        state: startPayload.state,
        message: "OAuth 視窗已開啟；完成登入後會自動確認憑證是否寫入 CLIProxyAPI。"
      });

      for (let attempt = 0; attempt < 150; attempt += 1) {
        await wait(2000);
        if (currentRun !== runId.current) return;

        const statusResponse = await fetch(
          base + "/v0/management/get-auth-status?state=" +
            encodeURIComponent(startPayload.state),
          {
            headers: {
              Accept: "application/json",
              Authorization: "Bearer " + key
            }
          }
        );
        const statusPayload = await statusResponse.json().catch(() => ({}));
        if (!statusResponse.ok) {
          throw new Error(
            typeof statusPayload.error === "string"
              ? statusPayload.error
              : "無法讀取 CLIProxyAPI OAuth 狀態。"
          );
        }

        if (statusPayload.status === "ok") {
          setFlow({
            provider,
            status: "success",
            state: startPayload.state,
            message: providerLabels[provider] + " OAuth 已完成，憑證已交由 CLIProxyAPI 保存。"
          });
          return;
        }
        if (statusPayload.status === "error") {
          throw new Error(
            typeof statusPayload.error === "string"
              ? statusPayload.error
              : providerLabels[provider] + " OAuth 登入失敗。"
          );
        }
      }

      throw new Error("OAuth 流程逾時；可以重新按一次登入。");
    } catch (error) {
      if (popup && !popup.closed) popup.close();
      setFlow({
        provider,
        status: "error",
        message: error instanceof Error ? error.message : "CLIProxyAPI OAuth 流程失敗。"
      });
    }
  }

  return (
    <section className="cliproxy-oauth" aria-labelledby="cliproxy-oauth-title">
      <div className="cliproxy-oauth-heading">
        <div>
          <span className="step">AI CONNECTION</span>
          <h2 id="cliproxy-oauth-title">CLIProxyAPI OAuth 登入</h2>
          <p>
            使用 Codex 與 Antigravity 的官方 OAuth 登入；不使用另外計費的供應商 API key。
          </p>
        </div>
        <span className="qb-local-chip">OAuth only</span>
      </div>

      <div className="cliproxy-oauth-form">
        <label>
          <span>CLIProxyAPI 管理位址</span>
          <input
            type="url"
            value={managementUrl}
            onChange={(event) => setManagementUrl(event.target.value)}
            placeholder="http://127.0.0.1:8317"
            autoComplete="off"
          />
        </label>
        <label>
          <span>管理密鑰（非供應商 API key）</span>
          <input
            type="password"
            value={managementKey}
            onChange={(event) => setManagementKey(event.target.value)}
            placeholder="僅在本次瀏覽器工作階段使用"
            autoComplete="off"
          />
        </label>
      </div>

      <div className="cliproxy-oauth-actions">
        <button
          type="button"
          className="cliproxy-oauth-button codex"
          disabled={flow.status === "starting" || flow.status === "waiting"}
          onClick={() => void startOAuth("codex")}
        >
          {flow.provider === "codex" && flow.status === "waiting"
            ? "等待 Codex OAuth…"
            : "使用 Codex OAuth 登入"}
        </button>
        <button
          type="button"
          className="cliproxy-oauth-button antigravity"
          disabled={flow.status === "starting" || flow.status === "waiting"}
          onClick={() => void startOAuth("antigravity")}
        >
          {flow.provider === "antigravity" && flow.status === "waiting"
            ? "等待 Antigravity OAuth…"
            : "使用 Antigravity OAuth 登入"}
        </button>
      </div>

      {flow.message && (
        <p
          className={
            "cliproxy-oauth-status " +
            (flow.status === "error"
              ? "error"
              : flow.status === "success"
                ? "success"
                : "")
          }
          role={flow.status === "error" ? "alert" : "status"}
        >
          {flow.message}
        </p>
      )}

      <p className="cliproxy-oauth-note">
        管理 API 必須由你的私有 CLIProxyAPI 服務提供，並設定管理密鑰與 CORS；不要把管理密鑰寫進 GitHub Pages 的公開環境變數。
      </p>
    </section>
  );
}
