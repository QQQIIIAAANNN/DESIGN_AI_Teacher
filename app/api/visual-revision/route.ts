import { NextResponse } from "next/server";
import { getCliProxyBaseUrl, getCliProxyHeaders, getCliProxyModelStatus } from "@/lib/cliproxy-server";
import { reviewAuthorizationError } from "@/lib/server-auth";
import { validRevisionBbox, type VisualRevisionSnapshot } from "@/lib/visual-revision";

export const runtime = "nodejs";
const MAX_FILE = 8 * 1024 * 1024;

function getImage(form: FormData, name: string): File {
  const file = form.get(name);
  if (!(file instanceof File) || file.type !== "image/png" || file.size < 100 || file.size > MAX_FILE) {
    throw new Error(name + " 必須是 8 MB 以下的 PNG 圖片。");
  }
  return file;
}

function getSnapshot(form: FormData): VisualRevisionSnapshot {
  let item: VisualRevisionSnapshot;
  try {
    item = JSON.parse(String(form.get("snapshot") || "")) as VisualRevisionSnapshot;
  } catch { throw new Error("缺少有效的 ROI 確認資料。"); }
  const b = item?.bbox;
  const brief = item?.brief;
  if (!item || typeof item.issueId !== "string" || item.issueId.length > 160 ||
      !b || !validRevisionBbox(b) ||
      !Number.isSafeInteger(item.revision) || item.revision < 0 ||
      typeof item.confirmedAt !== "string" ||
      !Number.isFinite(Date.parse(item.confirmedAt)) ||
      Math.abs(Date.now() - Date.parse(item.confirmedAt)) > 30 * 60 * 1000 ||
      !brief || typeof brief.problem !== "string" || !brief.problem.trim() ||
      typeof brief.designGoal !== "string" || !brief.designGoal.trim() ||
      !Array.isArray(brief.modifications) || !brief.modifications.length ||
      !brief.modifications.every((x) => typeof x === "string") ||
      !Array.isArray(brief.preserveConstraints) || !brief.preserveConstraints.every((x) => typeof x === "string")) {
    throw new Error("ROI 尚未確認或修改資料不完整，請重新確認位置。");
  }
  return item;
}

export async function POST(request: Request) {
  const denied = await reviewAuthorizationError(request);
  if (denied) return denied;
  try {
    const form = await request.formData();
    const snapshot = getSnapshot(form);
    const crop = getImage(form, "crop");
    const context = getImage(form, "context");
    const mask = getImage(form, "mask");
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
      "Architectural design exam improvement demonstration. Edit the FIRST image (a cropped drawing) only inside the editable mask.",
      "Use the SECOND image only for full-sheet location/context; do not redraw or edit the second image.",
      "Preserve the original hand-drawn drafting style, orientation, unchanged rooms, walls, stairs, structure and all surrounding connections.",
      "Do not invent measurements, legal compliance, floor areas or unreadable labels.",
      "Problem: " + brief.problem.slice(0, 700),
      "Design goal: " + brief.designGoal.slice(0, 160),
      "Required revisions: " + brief.modifications.slice(0, 5).map((x) => x.slice(0, 350)).join("; "),
      "Preserve: " + brief.preserveConstraints.slice(0, 5).map((x) => x.slice(0, 260)).join("; "),
      "Result is a restrained plan-view architectural design improvement sketch, not a photorealistic rendering."
    ].join("\n");

    const body = new FormData();
    body.set("model", model);
    body.append("image[]", crop, "revision-crop.png");
    body.append("image[]", context, "revision-context.png");
    body.append("mask", mask, "revision-mask.png");
    body.set("prompt", prompt);
    body.set("response_format", "b64_json");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
      const response = await fetch(`${getCliProxyBaseUrl()}/v1/images/edits`, {
        method: "POST", headers: getCliProxyHeaders(), body, signal: controller.signal
      });
      if (!response.ok) {
        if (response.status === 429) throw new Error("圖片編修模型目前達到額度或速率限制。");
        if ([400, 404, 415, 422].includes(response.status)) {
          throw new Error("目前的圖片模型或代理端點不接受雙圖＋遮罩編修。請確認模型支援 images/edits 的 image[] 與 mask。");
        }
        throw new Error(`AI 改圖失敗（HTTP ${response.status}）。`);
      }
      const payload = await response.json() as { data?: Array<{ b64_json?: string; url?: string }> };
      const result = payload.data?.[0];
      if (result?.b64_json && /^[a-zA-Z0-9+/=]+$/.test(result.b64_json)) {
        return NextResponse.json({ dataUrl: `data:image/png;base64,${result.b64_json}`, model, brief });
      }
      if (result?.url && /^https:\/\//i.test(result.url)) {
        return NextResponse.json({ remoteUrl: result.url, model, brief });
      }
      throw new Error("圖片編修模型沒有回傳可預覽圖片。");
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI 改圖發生錯誤。";
    const badRequest = /缺少有效|必須是|ROI 尚未/.test(message);
    return NextResponse.json({ error: error instanceof Error && error.name === "AbortError" ? "圖片編修逾時，請重試。" : message },
      { status: badRequest ? 400 : 502 });
  }
}
