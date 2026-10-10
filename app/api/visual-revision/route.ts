import { NextResponse } from "next/server";
import sharp from "sharp";
import { getCliProxyBaseUrl, getCliProxyHeaders, getCliProxyModelStatus } from "@/lib/cliproxy-server";
import { reviewAuthorizationError } from "@/lib/server-auth";
import { validRevisionBbox, type VisualRevisionSnapshot } from "@/lib/visual-revision";
import { InputError, prepareMaskedEdit } from "@/lib/visual-revision-server";

export const runtime = "nodejs";

function getSnapshot(form: FormData): VisualRevisionSnapshot {
  let item: VisualRevisionSnapshot;
  try {
    item = JSON.parse(String(form.get("snapshot") || "")) as VisualRevisionSnapshot;
  } catch { throw new InputError("缺少有效的 ROI 確認資料。"); }
  const b = item?.bbox;
  const brief = item?.brief;
  if (!item || typeof item.issueId !== "string" || !item.issueId || item.issueId.length > 160 ||
      !b || !validRevisionBbox(b) ||
      !Number.isSafeInteger(item.revision) || item.revision < 0 ||
      typeof item.confirmedAt !== "string" ||
      !Number.isFinite(Date.parse(item.confirmedAt)) ||
      Math.abs(Date.now() - Date.parse(item.confirmedAt)) > 30 * 60 * 1000 ||
      !brief || typeof brief.problem !== "string" || !brief.problem.trim() ||
      typeof brief.designGoal !== "string" || !brief.designGoal.trim() ||
      !Array.isArray(brief.modifications) || !brief.modifications.length ||
      !brief.modifications.every((x) => typeof x === "string") ||
      !Array.isArray(brief.preserveConstraints) ||
      !brief.preserveConstraints.every((x) => typeof x === "string")) {
    throw new InputError("ROI 尚未確認或修改資料不完整，請重新確認位置。");
  }
  return item;
}

function proxyError(status: number, responseText: string) {
  let upstream = "";
  try {
    const parsed = JSON.parse(responseText) as { error?: string | { message?: string }; message?: string };
    upstream = typeof parsed.error === "string" ? parsed.error :
      typeof parsed.error?.message === "string" ? parsed.error.message :
      typeof parsed.message === "string" ? parsed.message : "";
  } catch { upstream = ""; }
  const detail = upstream.slice(0, 240).replace(/[\r\n]+/g, " ");
  if (status === 429) return "圖片模型已達額度或速率限制，請稍後再試。";
  if (status === 401 || status === 403) return "圖片模型授權不足或帳號尚未登入。";
  if (status === 404) return /model/i.test(detail) ? "找不到指定的圖片編修模型，請檢查模型名稱。" :
    "圖片編修端點不存在（HTTP 404），請檢查 images/edits 路徑。";
  if (status === 415) return "模型不接受目前的圖片媒體格式（HTTP 415），請檢查 PNG 編碼。";
  if (/safety|policy|moderation|blocked|content.filter|violation/i.test(detail)) {
    return "圖片編修遭內容審核拒絕，請縮小編輯內容或調整修改說明。";
  }
  if (/dimension|resolution|aspect|size|pixel|too.large|image.shape/i.test(detail)) {
    return "圖片尺寸或長寬比不符合模型要求：" + detail;
  }
  if (/unsupported|unknown.parameter|image\[\]|mask|invalid.endpoint|not.implemented/i.test(detail)) {
    return "目前圖片模型不支援多圖或遮罩編修參數：" + detail;
  }
  if (status === 422) return "圖片內容無法處理（HTTP 422）" + (detail ? "：" + detail : "，請確認裁圖內容。");
  if (status === 400) return "圖片編修要求有誤（HTTP 400）" + (detail ? "：" + detail : "，請確認尺寸與模型參數。");
  return "圖片模型服務失敗（HTTP " + status + "）" + (detail ? "：" + detail : "。");
}

export async function POST(request: Request) {
  const denied = await reviewAuthorizationError(request);
  if (denied) return denied;
  try {
    const form = await request.formData();
    const snapshot = getSnapshot(form);
    // Supplied "mask" fields are ignored. Only the trusted server implementation creates masks.
    const assets = await prepareMaskedEdit(form, snapshot.bbox);
    const status = await getCliProxyModelStatus();
    if (!status.running || !status.authenticated || !status.models.length) {
      return NextResponse.json({ error: "尚未連接 CLIProxyAPI，無法生成 AI 改圖。" }, { status: 503 });
    }
    const model = (process.env.VISUAL_IMAGE_MODEL || process.env.NEXT_PUBLIC_IMAGE_MODEL || "").trim() ||
      status.models.find((name) => /(^|[-_/])(image|imagen)([-_/]|$)|gpt-image/i.test(name)) || "";
    if (!model || !status.models.includes(model)) {
      return NextResponse.json({ error: "找不到具備圖片編修能力的模型，請設定 VISUAL_IMAGE_MODEL。" }, { status: 503 });
    }

    const brief = snapshot.brief;
    const prompt = [
      "Architectural design exam improvement demonstration. Edit the FIRST image only inside the provided transparent edit mask.",
      "Use the SECOND image only for full-sheet location/context; never redraw the second image.",
      "The first image may have white letterbox margins. Preserve the drawing style, orientation, rooms, walls, stairs, structure and surrounding connections.",
      "Do not invent measurements, legal compliance, areas, or unreadable labels.",
      "Problem: " + brief.problem.slice(0, 700),
      "Design goal: " + brief.designGoal.slice(0, 160),
      "Required revisions: " + brief.modifications.slice(0, 5).map((x) => x.slice(0, 350)).join("; "),
      "Preserve: " + brief.preserveConstraints.slice(0, 5).map((x) => x.slice(0, 260)).join("; "),
      "Output a restrained plan-view design improvement sketch, not a rendering."
    ].join("\n");

    const body = new FormData();
    body.set("model", model);
    body.append("image[]", assets.crop);
    body.append("image[]", assets.context);
    body.append("mask", assets.mask);
    body.set("size", assets.size);
    body.set("prompt", prompt);
    body.set("response_format", "b64_json");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
      const response = await fetch(getCliProxyBaseUrl() + "/v1/images/edits", {
        method: "POST", headers: getCliProxyHeaders(), body, signal: controller.signal
      });
      if (!response.ok) throw new Error(proxyError(response.status, await response.text()));
      const payload = await response.json() as { data?: Array<{ b64_json?: string; url?: string }> };
      const result = payload.data?.[0];
      if (result?.b64_json && /^[a-zA-Z0-9+/=]+$/.test(result.b64_json)) {
        const png = Buffer.from(result.b64_json, "base64");
        const meta = await sharp(png).metadata().catch(() => { throw new Error("模型回傳的圖片無法辨識。"); });
        if (meta.width !== assets.frame.width || meta.height !== assets.frame.height) {
          throw new Error("模型回傳圖片尺寸不符，無法保證安全的 ROI 合成。");
        }
        return NextResponse.json({
          dataUrl: "data:image/png;base64," + result.b64_json, model, brief, frame: assets.frame
        });
      }
      if (result?.url) {
        throw new Error("圖片模型只回傳遠端 URL，無法保證瀏覽器 Canvas 可讀取像素。請設定模型回傳 b64_json。");
      }
      throw new Error("圖片模型未回傳可預覽的圖片。");
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 改圖發生錯誤。";
    const clientError = error instanceof InputError;
    return NextResponse.json({
      error: error instanceof Error && error.name === "AbortError" ? "圖片編修逾時，請重試。" : message
    }, { status: clientError ? 400 : 502 });
  }
}
