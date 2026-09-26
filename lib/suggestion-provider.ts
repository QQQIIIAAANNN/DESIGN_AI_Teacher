import { getCliProxyHeaders, getCliProxyModelStatus, getCliProxyBaseUrl } from "@/lib/cliproxy-server";
import { extractText, parseJsonContent } from "@/lib/ai-proxy-client";
import { normalizeSuggestionPlan } from "@/lib/suggestion-svg";
import { retrieveKnowledge, knowledgePrompt } from "@/lib/knowledge-retrieval";

async function discoverImageModel(selected: string, models: string[]) {
  try {
    const response = await fetch(`${getCliProxyBaseUrl()}/v1/models`, { headers: getCliProxyHeaders(), cache: "no-store" });
    if (!response.ok) return selected;
    const payload = await response.json() as { data?: Array<Record<string, unknown>>; models?: Array<Record<string, unknown>> };
    const rows = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : [];
    const imageModel = rows.find((row) => {
      const modalities = row.output_modalities || row.outputModalities;
      const capabilities = row.capabilities && typeof row.capabilities === "object"
        ? row.capabilities as Record<string, unknown> : {};
      return typeof row.id === "string" && models.includes(row.id) &&
        (capabilities.image_edit === true || capabilities.imageEdit === true ||
          Array.isArray(modalities) && modalities.includes("image") ||
          /(^|[-_/])image(?:gen)?(?:[-_/]|$)/i.test(row.id));
    });
    return typeof imageModel?.id === "string" ? imageModel.id : selected;
  } catch { return selected; }
}

async function generateEditedImage(crop: File, prompt: string, selected: string, models: string[]) {
  const model = await discoverImageModel(selected, models);
  const form = new FormData();
  form.append("model", model);
  form.append("image", crop, crop.name || "plan-crop.png");
  form.append("prompt", prompt.slice(0, 4000));
  form.append("response_format", "b64_json");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(`${getCliProxyBaseUrl()}/v1/images/edits`, {
      method: "POST", headers: getCliProxyHeaders(), body: form, signal: controller.signal
    });
    if (!response.ok) {
      if ([400, 404, 422].includes(response.status)) throw new Error("已連線模型目前不支援局部圖片編修。請在 CLIProxyAPI 連接具圖片編修能力的模型。 ");
      if (response.status === 429) throw new Error("圖片編修模型達到額度或速率限制。");
      throw new Error(`圖片編修失敗（HTTP ${response.status}）。`);
    }
    const payload = await response.json() as { data?: Array<{ b64_json?: string; url?: string }> };
    const item = payload.data?.[0];
    if (item?.b64_json && /^[a-z0-9+/=]+$/i.test(item.b64_json)) return { dataUrl: `data:image/png;base64,${item.b64_json}`, model };
    if (item?.url && /^https:\/\//i.test(item.url)) return { remoteUrl: item.url, model };
    throw new Error("圖片模型未回傳可預覽的圖片。");
  } finally { clearTimeout(timeout); }
}

export async function generateSuggestion(data: FormData) {
  const crop = data.get("crop");
  if (!(crop instanceof File) || !["image/png", "image/jpeg", "image/webp"].includes(crop.type) || crop.size > 8 * 1024 * 1024) {
    throw new Error("請提供 8 MB 以下的 PNG、JPEG 或 WebP 局部圖。");
  }
  const model = String(data.get("model") || "").trim();
  const status = await getCliProxyModelStatus();
  if (!status.running || !status.authenticated || !status.models.length) throw new Error("CLIProxyAPI 尚未連線或登入。");
  if (model && !status.models.includes(model)) throw new Error("所選模型已不在可用清單，請重新偵測模型。");
  const issueValue = JSON.parse(String(data.get("issue") || "{}")) as Record<string, unknown>;
  const title = String(issueValue.title || "局部修改").slice(0, 160);
  const description = String(issueValue.description || "").slice(0, 900);
  const suggestion = String(issueValue.suggestion || "").slice(0, 900);
  const evidence = String(issueValue.evidence || "").slice(0, 500);
  if (!suggestion.trim()) throw new Error("這項修改方向缺少具體內容。");
  const knowledge = await retrieveKnowledge(`${title} ${description} ${suggestion} ${evidence}`, "design", 14);
  const dataUrl = `data:${crop.type};base64,${Buffer.from(await crop.arrayBuffer()).toString("base64")}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(`${getCliProxyBaseUrl()}/v1/chat/completions`, {
      method: "POST", headers: { "Content-Type": "application/json", ...getCliProxyHeaders() }, signal: controller.signal,
      body: JSON.stringify({ model: model || status.models[0], temperature: 0.1, max_tokens: 3200, messages: [
        { role: "system", content: [
          "你是建築圖面局部修改繪圖員。分析使用者選中的裁圖與修改方向，自行判斷用 SVG 幾何或圖片編修較可靠。",
          "只畫修正所需的牆、柱、窗、門、家具、鋪面、植栽與標註。不得編造比例、尺寸、隱藏牆線或無法看到的房間。",
          "能以至少兩個可靠元素定位時選 mode=svg；幾何過於複雜或難以可靠表達時選 mode=image，並提供保留原圖方向與未修改區域的 imagePrompt。",
          "SVG 每個元素使用相對於裁圖左上(0,0)、右下(1,1)的座標。新增 action=add，拆除 action=remove。標註不能取代圖形。",
          '回傳純 JSON：SVG 為 {"mode":"svg","summary":"","elements":[{"type":"line|rect|circle|polyline|label","role":"wall|column|window|door|furniture|paving|planting|annotation","action":"add|remove","x":0.1,"y":0.1,"x2":0.2,"y2":0.2,"w":0.1,"h":0.1,"r":0.03,"points":[[0.1,0.1],[0.2,0.2]],"text":""}]}；圖片為 {"mode":"image","summary":"","imagePrompt":""}。SVG 只填對應 type 必需欄位。',
          "相關平台知識：", knowledgePrompt(knowledge)
        ].join("\n") },
        { role: "user", content: [{ type: "text", text: `問題：${title}\n圖面證據：${evidence}\n問題：${description}\n修改方向：${suggestion}\n請在局部原圖上定位修改。` }, { type: "image_url", image_url: { url: dataUrl, detail: "high" } }] }
      ] })
    });
    if (!response.ok) throw new Error(response.status === 429 ? "模型目前達到額度或速率限制。"
      : response.status === 400 ? "目前選取的模型無法處理局部圖片，請改選支援圖片的已連線模型。"
      : `局部繪圖失敗（HTTP ${response.status}）。`);
    const raw = parseJsonContent(extractText(await response.json())) as Record<string, unknown>;
    const summary = typeof raw.summary === "string" ? raw.summary.slice(0, 300) : "局部修改示意";
    if (raw.mode !== "image") {
      try {
        const plan = normalizeSuggestionPlan(raw);
        if (plan.elements.filter((element) => element.type !== "label").length >= 2) {
          return { kind: "svg" as const, plan };
        }
      } catch { /* Try image editing when vector geometry is not trustworthy. */ }
    }
    const imagePrompt = typeof raw.imagePrompt === "string" && raw.imagePrompt.trim()
      ? raw.imagePrompt.trim() : `Edit this cropped architectural plan only around this issue: ${title}. Problem: ${description}. Proposed change: ${suggestion}. Preserve orientation, all unaffected geometry and labels. Draw a restrained architectural improvement overlay.`;
    const image = await generateEditedImage(crop, imagePrompt, model || status.models[0], status.models);
    return { kind: "image" as const, summary, ...image };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("局部繪圖逾時，請縮小圖檔或改用另一個模型。");
    throw error;
  } finally { clearTimeout(timeoutId); }
}
