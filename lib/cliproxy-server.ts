import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { compatibleClaudeModel } from "@/lib/model-selection";

const defaultBaseUrl = "http://127.0.0.1:8317";
let startingUntil = 0;
const missingClaudeModels = new Map<string, number>();
const missingClaudeCooldownMs = 5 * 60 * 1000;

export type CliProxyModelStatus = {
  running: boolean;
  authenticated: boolean;
  models: string[];
  unavailableModels?: string[];
  statusCode?: number;
  message: string;
};

export function getCliProxyBaseUrl() {
  return (
    process.env.CLIPROXY_URL ||
    process.env.NEXT_PUBLIC_CLIPROXY_MANAGEMENT_URL ||
    defaultBaseUrl
  ).trim().replace(/\/+$/, "");
}

function getConfiguredApiKey() {
  const envKey = process.env.CLIPROXY_API_KEY?.trim();
  if (envKey) return envKey;

  const configPath = process.env.CLIPROXY_CONFIG?.trim()
    ? path.resolve(process.env.CLIPROXY_CONFIG.trim())
    : path.join(process.cwd(), "config.yaml");
  if (!fs.existsSync(configPath)) return "";

  try {
    const lines = fs.readFileSync(configPath, "utf8").split(/\r?\n/);
    let inApiKeys = false;
    for (const line of lines) {
      if (!inApiKeys) {
        if (/^api-keys\s*:\s*(?:#.*)?$/.test(line)) inApiKeys = true;
        continue;
      }
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      if (!/^[ \t]/.test(line)) break;
      const entry = trimmed.match(/^[-]\s*(.+?)\s*$/);
      if (!entry) continue;
      const key = entry[1].replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "");
      if (!key || /^your-api-key/i.test(key) || /^changeme$/i.test(key)) continue;
      return key;
    }
  } catch {
    return "";
  }
  return "";
}

export function getCliProxyHeaders(): Record<string, string> {
  const apiKey = getConfiguredApiKey();
  return apiKey ? { Authorization: "Bearer " + apiKey } : {};
}

function pruneMissingClaudeModels(now = Date.now()) {
  for (const [model, until] of missingClaudeModels) if (until <= now) missingClaudeModels.delete(model);
}

function markClaudeModelMissing(model: string) {
  pruneMissingClaudeModels();
  missingClaudeModels.set(model, Date.now() + missingClaudeCooldownMs);
}

function isKnownMissingClaudeModel(model: string) {
  pruneMissingClaudeModels();
  return (missingClaudeModels.get(model) || 0) > Date.now();
}

async function isClaudeModelNotFound(response: Response) {
  if (response.status !== 404 && response.status !== 503) return false;
  const body = await response.clone().json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return false;
  const error = body.error && typeof body.error === "object" ? body.error as Record<string, unknown> : {};
  const message = [body.message, body.error, error.message].filter((part): part is string => typeof part === "string").join(" ");
  const code = String(error.code || body.code || "").toLowerCase();
  const status = String(error.status || body.status || "").toLowerCase();
  if (response.status === 404) {
    return /(?:model|entity|requested entity).{0,50}(?:not found|does not exist)|(?:not found).{0,50}(?:model|entity)/i.test(message) ||
      ["model_not_found", "unknown_model", "model_not_available"].includes(code);
  }
  return /auth_unavailable/i.test(message) && /"code"\s*:\s*404/i.test(message) &&
    (/"status"\s*:\s*"not_found"/i.test(message) || /model.{0,50}(?:not found|not_found)/i.test(message));
}

function withActualModel(response: Response, model: string) {
  const responseHeaders = new Headers(response.headers);
  responseHeaders.set("X-CliProxy-Model", model);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders });
}

function requestForModel(init: RequestInit, payload: Record<string, unknown>, model: string): RequestInit {
  return { ...init, headers: new Headers(init.headers), body: JSON.stringify({ ...payload, model }) };
}

function isClaudeFamilyModel(model: string) {
  return /^claude-(?:opus|sonnet|haiku)(?:-|$)/i.test(model);
}

/** Retry only a confirmed Claude missing-model error, preserving the requested provider family. */
export async function cliProxyCompletion(baseUrl: string, init: RequestInit): Promise<Response> {
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;
  if (typeof init.body !== "string") return fetch(endpoint, init);
  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(init.body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fetch(endpoint, init);
    payload = parsed as Record<string, unknown>;
  } catch { return fetch(endpoint, init); }
  if (typeof payload.model !== "string") return fetch(endpoint, init);
  if (!isClaudeFamilyModel(payload.model)) return fetch(endpoint, init);

  if (isKnownMissingClaudeModel(payload.model)) {
    const status = await getCliProxyModelStatus();
    const fallback = compatibleClaudeModel(payload.model, status.models);
    if (!fallback) throw new Error(`Claude 模型 ${payload.model} 暫時不可用，沒有同系列替代模型。`);
    const retry = await fetch(endpoint, requestForModel(init, payload, fallback));
    if (await isClaudeModelNotFound(retry)) markClaudeModelMissing(fallback);
    return withActualModel(retry, fallback);
  }

  const first = await fetch(endpoint, init);
  if (!(await isClaudeModelNotFound(first))) return first;
  markClaudeModelMissing(payload.model);
  const status = await getCliProxyModelStatus();
  const fallback = compatibleClaudeModel(payload.model, status.models);
  if (!fallback) throw new Error(`Claude 模型 ${payload.model} 不存在，沒有同系列替代模型。`);
  const retry = await fetch(endpoint, requestForModel(init, payload, fallback));
  if (await isClaudeModelNotFound(retry)) markClaudeModelMissing(fallback);
  return withActualModel(retry, fallback);
}

export async function getCliProxyModelStatus(): Promise<CliProxyModelStatus> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(getCliProxyBaseUrl() + "/v1/models", {
      method: "GET",
      headers: getCliProxyHeaders(),
      cache: "no-store",
      signal: controller.signal
    });
    if (response.status === 401 || response.status === 403) {
      return {
        running: true,
        authenticated: false,
        models: [],
        statusCode: response.status,
        message: "CLIProxyAPI 已啟動，但 API key 無效或未設定。請確認 config.yaml 的 api-keys，或設定 CLIPROXY_API_KEY。"
      };
    }
    if (!response.ok) {
      return {
        running: true,
        authenticated: true,
        models: [],
        statusCode: response.status,
        message: "CLIProxyAPI 有回應，但模型清單查詢失敗（HTTP " + response.status + "）。"
      };
    }

    const payload = await response.json().catch(() => ({})) as {
      data?: Array<{ id?: unknown }>;
      models?: Array<{ id?: unknown }>;
    };
    const rows = Array.isArray(payload.data)
      ? payload.data
      : Array.isArray(payload.models) ? payload.models : [];
    const models = Array.from(new Set(
      rows
        .map((model) => model && typeof model.id === "string" ? model.id.trim() : "")
        .filter(Boolean)
    ));
    pruneMissingClaudeModels();
    const unavailableModels = [...missingClaudeModels.keys()].filter((model) => models.includes(model));
    const availableModels = models.filter((model) => !unavailableModels.includes(model));
    return {
      running: true,
      authenticated: true,
      models: availableModels,
      unavailableModels,
      statusCode: response.status,
      message: availableModels.length
        ? "已連線，發現 " + availableModels.length + " 個可用模型。"
        : "CLIProxyAPI 已連線，但目前沒有可用模型。請先完成 OAuth 登入。"
    };
  } catch {
    return { running: false, authenticated: false, models: [], message: "目前連不上 CLIProxyAPI。" };
  } finally {
    clearTimeout(timeoutId);
  }
}

export function isLocalCliProxyUrl() {
  try {
    const hostname = new URL(getCliProxyBaseUrl()).hostname.toLowerCase();
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
  } catch {
    return false;
  }
}

export function getCliProxyExecutable(cwd = process.cwd()) {
  const configured = process.env.CLIPROXY_BIN?.trim();
  const candidates = [
    ...(configured ? [path.resolve(cwd, configured)] : []),
    path.join(cwd, process.platform === "win32" ? "cli-proxy-api.exe" : "cli-proxy-api")
  ];
  for (const directory of (process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    candidates.push(path.join(directory, process.platform === "win32" ? "cli-proxy-api.exe" : "cli-proxy-api"));
  }
  return candidates.find((candidate) => fs.existsSync(candidate) ) || null;
}

export function startCliProxy(cwd = process.cwd()) {
  const executable = getCliProxyExecutable(cwd);
  if (!executable) return { success: false, starting: false, error: "找不到 CLIProxyAPI 執行檔。" };
  if (Date.now() < startingUntil) return { success: true, starting: true };
  startingUntil = Date.now() + 12000;
  try {
    const child: ChildProcess = spawn(executable, [], {
      cwd,
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.once("error", () => { startingUntil = 0; });
    child.unref();
    return { success: true, starting: true };
  } catch {
    startingUntil = 0;
    return { success: false, starting: false, error: "無法啟動 CLIProxyAPI。" };
  }
}
