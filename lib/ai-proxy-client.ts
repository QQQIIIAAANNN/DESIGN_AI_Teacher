import type {
  DrawingReview,
  NormalizedBBox,
  RedlinePrimitive,
  ReviewItem,
  ReviewSeverity,
  SupplementReviewResult,
  VisibilityStatus
} from "@/lib/review-schema";
import {
  callAiProxy,
  getSavedSession,
  isActiveMember,
  isImageSuggestionConfigured,
  isLiveReviewConfigured
} from "@/lib/supabase-browser";

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("無法讀取圖面。"));
    reader.onerror = () => reject(new Error("無法讀取圖面。"));
    reader.readAsDataURL(file);
  });
}

function extractText(response: Record<string, unknown>) {
  const choices = Array.isArray(response.choices) ? response.choices : [];
  const choice = choices[0] as Record<string, unknown> | undefined;
  const message = choice && typeof choice.message === "object" && choice.message
    ? choice.message as Record<string, unknown>
    : null;
  const content = message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && typeof (part as Record<string, unknown>).text === "string"
          ? String((part as Record<string, unknown>).text)
          : ""
      )
      .join("\n");
  }
  throw new Error("AI 回覆格式不完整，請再試一次。");
}

function parseJsonContent(content: string) {
  const trimmed = content.trim().replace(/^\uFEFF/, "");
  const withoutFence = trimmed
    .replace(/^\u0060\u0060\u0060(?:json)?\s*/i, "")
    .replace(/\s*\u0060\u0060\u0060$/i, "");
  try {
    return JSON.parse(withoutFence);
  } catch {
    throw new Error("AI 回覆不是有效 JSON，請重新審圖。");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedNumber(value: unknown, min: number, max: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function normalizeBbox(value: unknown): NormalizedBBox {
  if (!isRecord(value)) throw new Error("AI 回覆缺少有效的區域定位。");
  const x = value.x;
  const y = value.y;
  const w = value.w;
  const h = value.h;
  if (
    !boundedNumber(x, 0, 0.999) ||
    !boundedNumber(y, 0, 0.999) ||
    !boundedNumber(w, 0.001, 1) ||
    !boundedNumber(h, 0.001, 1)
  ) {
    throw new Error("AI 回覆的 SVG 區域定位超出圖面範圍。");
  }
  return {
    x: x as number,
    y: y as number,
    w: Math.min(w as number, 1 - (x as number)),
    h: Math.min(h as number, 1 - (y as number))
  };
}

function normalizeRedline(value: unknown): RedlinePrimitive | undefined {
  if (!isRecord(value)) return undefined;
  if (value.type === "line") {
    const coords = [value.x1, value.y1, value.x2, value.y2];
    if (coords.every((coordinate) => boundedNumber(coordinate, 0, 1))) {
      return {
        type: "line",
        x1: value.x1 as number,
        y1: value.y1 as number,
        x2: value.x2 as number,
        y2: value.y2 as number
      };
    }
  }
  if (value.type === "rect") {
    const box = normalizeBbox({ x: value.x, y: value.y, w: value.w, h: value.h });
    return { type: "rect", ...box };
  }
  if (value.type === "polyline" && Array.isArray(value.points) && value.points.length >= 2 && value.points.length <= 40) {
    const points = value.points.filter(
      (point): point is [number, number] =>
        Array.isArray(point) &&
        point.length === 2 &&
        boundedNumber(point[0], 0, 1) &&
        boundedNumber(point[1], 0, 1)
    );
    if (points.length >= 2) return { type: "polyline", points };
  }
  return undefined;
}

function normalizeItem(value: unknown, index: number): ReviewItem {
  if (!isRecord(value)) throw new Error("AI 回覆的問題格式不正確。");
  const kind = value.kind === "clarity_request" ? "clarity_request" : value.kind === "issue" ? "issue" : null;
  if (!kind) throw new Error("AI 回覆缺少問題類型。");
  const severity: ReviewSeverity =
    value.severity === "high" || value.severity === "medium" || value.severity === "low" || value.severity === "info"
      ? value.severity
      : "medium";
  const visibilityStatus: VisibilityStatus =
    value.visibilityStatus === "clear" ||
    value.visibilityStatus === "partially_blurry" ||
    value.visibilityStatus === "illegible"
      ? value.visibilityStatus
      : "clear";
  const crop = isRecord(value.cropRequest) ? value.cropRequest : null;
  const cropRequest = crop
    ? {
        reason: typeof crop.reason === "string" ? crop.reason.slice(0, 1000) : "",
        instructions: Array.isArray(crop.instructions)
          ? crop.instructions.filter((entry): entry is string => typeof entry === "string").slice(0, 8)
          : [],
        reviewTargets: Array.isArray(crop.reviewTargets)
          ? crop.reviewTargets.filter((entry): entry is string => typeof entry === "string").slice(0, 8)
          : []
      }
    : undefined;

  return {
    id: "ai-issue-" + (index + 1) + "-" + crypto.randomUUID(),
    kind,
    title: typeof value.title === "string" ? value.title.slice(0, 160) : "需要確認的空間問題",
    category: typeof value.category === "string" ? value.category.slice(0, 80) : "空間配置",
    severity,
    scoreImpact: typeof value.scoreImpact === "number" && Number.isFinite(value.scoreImpact)
      ? Math.max(-20, Math.min(0, value.scoreImpact))
      : null,
    confidence: boundedNumber(value.confidence, 0, 1) ? value.confidence as number : 0.5,
    visibilityStatus,
    description: typeof value.description === "string" ? value.description.slice(0, 1400) : "",
    suggestion: typeof value.suggestion === "string" ? value.suggestion.slice(0, 1400) : "",
    bbox: normalizeBbox(value.bbox),
    redline: normalizeRedline(value.redline),
    cropRequest: kind === "clarity_request" ? cropRequest ?? {
      reason: "局部資訊不足，請提供更清楚的原圖或近拍。",
      instructions: ["保留問題區域周邊約 10% 至 20% 的上下文。"],
      reviewTargets: ["確認該處的空間與動線關係"]
    } : undefined
  };
}

function normalizeReview(value: unknown, drawingName: string): DrawingReview {
  if (!isRecord(value) || !Array.isArray(value.issues) || !Array.isArray(value.dimensions)) {
    throw new Error("AI 回覆不符合審圖資料格式，請重新審圖。");
  }
  const issues = value.issues.slice(0, 20).map(normalizeItem);
  const dimensions = value.dimensions.slice(0, 8).flatMap((dimension, index) => {
    if (!isRecord(dimension)) return [];
    const score = dimension.score;
    const maxScore = dimension.maxScore;
    if (
      typeof score !== "number" ||
      typeof maxScore !== "number" ||
      !Number.isFinite(score) ||
      !Number.isFinite(maxScore) ||
      maxScore <= 0
    ) return [];
    return [{
      key: typeof dimension.key === "string" ? dimension.key.slice(0, 80) : "dimension-" + index,
      label: typeof dimension.label === "string" ? dimension.label.slice(0, 80) : "設計表現",
      score: Math.max(0, Math.min(score, maxScore)),
      maxScore,
      confidence: boundedNumber(dimension.confidence, 0, 1) ? dimension.confidence as number : 0.5
    }];
  });
  const overallScore = boundedNumber(value.overallScore, 0, 100)
    ? Math.round(value.overallScore as number)
    : null;

  return {
    reviewId: "review-" + crypto.randomUUID(),
    drawingId: drawingName,
    overallScore,
    dimensions,
    issues,
    needsSupplement: issues.some((issue) => issue.kind === "clarity_request")
  };
}

const reviewSystemPrompt = [
  "你是建築設計與敷地計畫考試的評圖助教。只依圖片可見內容評論；不得臆測不可讀的尺寸、法規符合性或結構安全。",
  "若圖面無法支持判斷，建立 clarity_request，明確說明需要補拍的區域，不要把推測寫成缺失。",
  "每個問題需以完整圖面左上為 (0,0)、右下為 (1,1) 輸出 normalized bbox，x/y/w/h 均介於 0 到 1，且框選對準可見問題。",
  "提出可執行且盡量局部的修改建議，區分硬性條件與設計偏好，不宣稱單一配置是唯一正解。",
  "只輸出 JSON，不要 Markdown 或其他說明。格式：",
  "{\"overallScore\":0-100或null,\"dimensions\":[{\"key\":\"planning\",\"label\":\"配置與機能\",\"score\":0,\"maxScore\":20,\"confidence\":0.0}],\"issues\":[{\"kind\":\"issue或clarity_request\",\"title\":\"\",\"category\":\"\",\"severity\":\"high/medium/low/info\",\"scoreImpact\":-1或null,\"confidence\":0.0,\"visibilityStatus\":\"clear/partially_blurry/illegible\",\"description\":\"\",\"suggestion\":\"\",\"bbox\":{\"x\":0.0,\"y\":0.0,\"w\":0.1,\"h\":0.1},\"redline\":{\"type\":\"line\",\"x1\":0.0,\"y1\":0.0,\"x2\":0.1,\"y2\":0.1},\"cropRequest\":{\"reason\":\"\",\"instructions\":[\"\"],\"reviewTargets\":[\"\"]}}],\"needsSupplement\":false}"
].join("\n");

export async function reviewDrawingWithAi(file: File): Promise<DrawingReview> {
  if (!isLiveReviewConfigured()) throw new Error("尚未設定正式 AI 審圖模型，請使用示範審圖。");
  if (file.size > 8 * 1024 * 1024) throw new Error("正式 AI 審圖目前接受 8 MB 以下圖面。");
  const session = await getSavedSession();
  if (!session || !isActiveMember(session.user)) {
    throw new Error("請先用已核准的帳號登入，再使用正式 AI 審圖。");
  }

  const dataUrl = await fileToDataUrl(file);
  const imageType = /^data:image\/(png|jpeg|webp);base64,/i.test(dataUrl);
  if (!imageType) throw new Error("正式 AI 審圖目前接受 PNG、JPEG 或 WebP 圖面。");

  const response = await callAiProxy(session, {
    action: "chat",
    model: (process.env.NEXT_PUBLIC_REVIEW_MODEL || "").trim(),
    messages: [
      { role: "system", content: reviewSystemPrompt },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "請審閱這張建築設計或敷地計畫作答圖，輸出 3 到 8 個有根據的評圖項目；若圖面無法判讀，優先要求補圖。"
          },
          { type: "image_url", image_url: { url: dataUrl, detail: "high" } }
        ]
      }
    ]
  });
  return normalizeReview(parseJsonContent(extractText(response)), file.name);
}

export async function reviewSupplementWithAi(
  file: File,
  issue: ReviewItem
): Promise<SupplementReviewResult> {
  if (!isLiveReviewConfigured()) throw new Error("尚未設定正式 AI 審圖模型。");
  if (file.size > 8 * 1024 * 1024) throw new Error("局部補圖目前接受 8 MB 以下檔案。");
  const session = await getSavedSession();
  if (!session || !isActiveMember(session.user)) {
    throw new Error("請先用已核准的帳號登入，再使用正式 AI 審圖。");
  }
  const dataUrl = await fileToDataUrl(file);
  if (!/^data:image\/(png|jpeg|webp);base64,/i.test(dataUrl)) {
    throw new Error("局部補圖目前接受 PNG、JPEG 或 WebP。");
  }

  const response = await callAiProxy(session, {
    action: "chat",
    model: (process.env.NEXT_PUBLIC_REVIEW_MODEL || "").trim(),
    messages: [
      { role: "system", content: reviewSystemPrompt },
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "這是針對原問題的高解析補圖。不要重新評論整張圖。請輸出 JSON：{\"status\":\"resolved\"或\"still_uncertain\",\"issue\":完整 ReviewItem}。原問題 context：" +
              JSON.stringify(issue)
          },
          { type: "image_url", image_url: { url: dataUrl, detail: "high" } }
        ]
      }
    ]
  });
  const payload = parseJsonContent(extractText(response));
  if (!isRecord(payload) || !isRecord(payload.issue)) {
    throw new Error("局部審圖的回覆格式不正確。");
  }
  const status = payload.status === "resolved" ? "resolved" : "still_uncertain";
  const updated = normalizeItem(payload.issue, 0);
  return {
    status,
    issue: {
      ...updated,
      id: issue.id,
      bbox: issue.bbox,
      kind: status === "resolved" ? "issue" : "clarity_request",
      cropRequest: status === "resolved" ? undefined : updated.cropRequest
    }
  };
}

function cropIssueImage(imageUrl: string, bbox: NormalizedBBox) {
  return new Promise<string>(async (resolve, reject) => {
    try {
      const source = new Image();
      source.src = imageUrl;
      await source.decode();

      const clamp = (value: number) => Math.max(0, Math.min(1, value));
      const x = clamp(bbox.x);
      const y = clamp(bbox.y);
      const width = Math.max(0.005, Math.min(1 - x, bbox.w));
      const height = Math.max(0.005, Math.min(1 - y, bbox.h));
      const left = clamp(x - Math.max(width * 0.45, 0.04));
      const top = clamp(y - Math.max(height * 0.45, 0.04));
      const right = clamp(x + width + Math.max(width * 0.45, 0.04));
      const bottom = clamp(y + height + Math.max(height * 0.45, 0.04));
      const sourceX = left * source.naturalWidth;
      const sourceY = top * source.naturalHeight;
      const sourceW = (right - left) * source.naturalWidth;
      const sourceH = (bottom - top) * source.naturalHeight;
      const scale = Math.min(1, 1400 / Math.max(sourceW, sourceH));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(sourceW * scale));
      canvas.height = Math.max(1, Math.round(sourceH * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("瀏覽器無法裁切這張圖面。");
      context.drawImage(source, sourceX, sourceY, sourceW, sourceH, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/png"));
    } catch {
      reject(new Error("無法準備問題區域的局部圖。"));
    }
  });
}

export async function generateIssueSuggestionImage(imageUrl: string, issue: ReviewItem) {
  if (!isImageSuggestionConfigured()) throw new Error("尚未設定 AI 建議圖模型。");
  const session = await getSavedSession();
  if (!session || !isActiveMember(session.user)) {
    throw new Error("請先用已核准的帳號登入，再產生 AI 建議圖。");
  }

  const dataUrl = await cropIssueImage(imageUrl, issue.bbox);
  const base64 = dataUrl.split(",")[1] || "";
  const prompt = [
    "Edit the provided cropped architectural plan to show one restrained, legible design-improvement sketch.",
    "Preserve the original drawing orientation, scale impression, and every unaffected wall and room. Do not invent dimensions, code clearances, room labels, or unrelated design changes.",
    "Focus only on this teacher-marked issue: " + issue.title + ".",
    "Problem: " + issue.description,
    "Suggested repair: " + issue.suggestion,
    "Use a clear architectural redline / light-color overlay that distinguishes the proposed change from the original. Keep the result diagrammatic, calm, and useful for exam practice."
  ].join("\n");

  const response = await callAiProxy(session, {
    action: "image_edit",
    model: (process.env.NEXT_PUBLIC_IMAGE_MODEL || "").trim(),
    prompt,
    image: { mime_type: "image/png", base64 }
  });

  const data = Array.isArray(response.data) ? response.data[0] as Record<string, unknown> | undefined : undefined;
  if (typeof data?.b64_json === "string") {
    const binary = atob(data.b64_json);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return { blob: new Blob([bytes], { type: "image/png" }), remoteUrl: "" };
  }
  if (typeof data?.url === "string" && /^https:\/\//i.test(data.url)) {
    return { blob: null, remoteUrl: data.url };
  }
  throw new Error("AI 沒有回傳可預覽的建議圖，請稍後再試。");
}
