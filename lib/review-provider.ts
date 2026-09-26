import type {
  DrawingReview,
  ConfirmedRegion,
  ReviewItem,
  SupplementReviewResult
} from "@/lib/review-schema";
import { observationPrompt, normalizeObservation, applyObservationOverrides, type ObservationOverrides } from "@/lib/review-observation";
import { retrieveKnowledge, knowledgeQuery, knowledgePrompt } from "@/lib/knowledge-retrieval";
import { calibrateReview } from "@/lib/review-rubric";
import { reviewByTopics } from "@/lib/review-topics";
import { getKnowledgeImageDataUrl } from "@/lib/private-knowledge";
import { groundReview } from "@/lib/review-grounding";
import { questionReadingPrompt, normalizeQuestionContext, questionContextText, type QuestionContext } from "@/lib/question-context";
import type { QuestionDocument } from "@/lib/question-source";
import { practiceQuestionText, type PracticeQuestion } from "@/lib/practice-question";
import { normalizeReviewMinutes, reviewScenarioInstruction, type ReviewScenarioId } from "@/lib/review-scenario";
import { createHash } from "node:crypto";
import {
  createMockReview,
  createMockSupplementReview
} from "@/lib/review-mock";
import {
  extractText,
  parseJsonContent,
  normalizeReview,
  normalizeItem,
  readImageDimensions
} from "@/lib/ai-proxy-client";
import {
  getCliProxyHeaders,
  getCliProxyModelStatus
} from "@/lib/cliproxy-server";

export type ReviewIntensity = "gentle" | "standard" | "strict";

export type ReviewInput = {
  file: File;
  examType?: "design" | "site_planning";
  questionTitle?: string;
  questionDocument?: QuestionDocument | null;
  observationOverrides?: ObservationOverrides;
  confirmedRegions?: ConfirmedRegion[];
  model?: string;
  intensity?: ReviewIntensity;
  scenario?: ReviewScenarioId;
  targetMinutes?: number;
  practiceQuestion?: PracticeQuestion | null;
};

export type SupplementReviewInput = {
  file: File;
  reviewId: string;
  drawingId: string;
  originalIssue: ReviewItem;
  model?: string;
  intensity?: ReviewIntensity;
  scenario?: ReviewScenarioId;
  targetMinutes?: number;
};

export interface ReviewProvider {
  reviewDrawing(input: ReviewInput): Promise<DrawingReview>;
  reviewSupplement(input: SupplementReviewInput): Promise<SupplementReviewResult>;
}

export function getIntensityInstruction(intensity: ReviewIntensity = "standard"): string {
  switch (intensity) {
    case "gentle":
      return [
        "【審圖強度：溫和引導】",
        "- 保持建設性語氣，逐主題指出有證據的改善點與優點。",
        "- 評分準則與證據門檻不因語氣改變。"
      ].join("\n");
    case "strict":
      return [
        "【審圖強度：嚴格精審】",
        "- 對題意、基地、空間層次與動線要求更具體的圖面證據。",
        "- 有實際證據的重大缺失要反映於評分；不為湊數製造問題。",
        "- 文字、尺寸或圖形不清時提出精確的補圖要求，不把猜測當缺失。"
      ].join("\n");
    case "standard":
    default:
      return [
        "【審圖強度：標準】",
        "- 依平台知識要點與圖面證據，逐項涵蓋題意、基地、空間層次、動線、環境與表達。",
        "- 同時指出有證據的缺失與值得保持的優點；不為湊數虛構結論。"
      ].join("\n");
  }
}

class MockReviewProvider implements ReviewProvider {
  async reviewDrawing(input: ReviewInput): Promise<DrawingReview> {
    const result = createMockReview(input.file.name);
    const intensity = input.intensity || "standard";
    const model = input.model || "mock";
    if (result.issues[0]) {
      result.issues[0].title = `[${intensity.toUpperCase()}·${model}] ${result.issues[0].title}`;
    }
    return {
      ...result,
      model,
      intensity,
      scenario: input.scenario,
      targetMinutes: input.targetMinutes,
      practiceQuestion: input.practiceQuestion
    };
  }

  async reviewSupplement(
    input: SupplementReviewInput
  ): Promise<SupplementReviewResult> {
    return createMockSupplementReview(input.originalIssue);
  }
}

async function fileToDataUrl(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);
  const base64 = buffer.toString("base64");
  const mimeType = file.type || "image/png";
  return `data:${mimeType};base64,${base64}`;
}

async function resolveCliProxyModel(requested?: string) {
  const status = await getCliProxyModelStatus();
  if (!status.running) {
    throw new Error("CLIProxyAPI 尚未連線。請用 start.bat 啟動，或在帳號設定中啟動服務。");
  }
  if (!status.authenticated) {
    throw new Error("CLIProxyAPI API key 無效或未設定。請確認 config.yaml 的 api-keys 或 CLIPROXY_API_KEY。");
  }
  if (!status.models.length) {
    throw new Error("CLIProxyAPI 尚未回報可用模型。請先完成 OAuth 登入，再重新偵測模型。");
  }
  const model = requested?.trim();
  if (model && !status.models.includes(model)) {
    throw new Error("所選模型已不在 CLIProxyAPI 清單中，請重新偵測並選擇目前可用的模型。");
  }
  return model || status.models[0];
}

async function callCliVision(baseUrl: string, model: string, system: string, userText: string, dataUrl: string, maxTokens: number,
  referenceImages: Array<{ id: string; url: string }> = []) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...getCliProxyHeaders() },
      body: JSON.stringify({ model, messages: [
        { role: "system", content: system },
        { role: "user", content: [{ type: "text", text: userText }, { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
          ...referenceImages.flatMap((item) => [{ type: "text", text: `以下為知識庫參考圖頁 ${item.id}，不是本次作答圖。` },
            { type: "image_url", image_url: { url: item.url, detail: "low" } }])] }
      ], temperature: 0.1, max_tokens: maxTokens }),
      signal: controller.signal
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error("CLIProxyAPI API key 無效或未設定。");
      if (response.status === 429) throw new Error("上游帳號達到額度或速率限制，請稍後再試。");
      if (response.status === 400) throw new Error("目前選取的模型無法處理這張圖片，請改選支援圖片的已連線模型。");
      throw new Error(`CLIProxyAPI 審圖失敗 (HTTP ${response.status})。`);
    }
    return parseJsonContent(extractText(await response.json()));
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("圖片模型回應逾時，請改用較小的圖檔或另一個已連線模型。");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

const questionContextCache = new Map<string, QuestionContext>();

async function readQuestionWithCli(baseUrl: string, model: string, document: QuestionDocument): Promise<QuestionContext> {
  const digest = createHash("sha256").update(model).update(document.title).update(document.text);
  document.pageImages.forEach((page) => digest.update(page));
  const key = digest.digest("hex");
  const cached = questionContextCache.get(key);
  if (cached) return cached;
  const content = [
    { type: "text", text: `題目：${document.title}\n抽取文字：\n${document.text.slice(0, 22000)}\n以下依序是題目 PDF 頁面；請結合基地附圖閱讀。` },
    ...document.pageImages.flatMap((url, index) => [
      { type: "text", text: `題目 PDF 第 ${index + 1} 頁` },
      { type: "image_url", image_url: { url, detail: "high" } }
    ])
  ];
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);
  try {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST", headers: { "Content-Type": "application/json", ...getCliProxyHeaders() }, signal: controller.signal,
      body: JSON.stringify({ model, temperature: 0.1, max_tokens: 3600, messages: [
        { role: "system", content: questionReadingPrompt },
        { role: "user", content }
      ] })
    });
    if (!response.ok) throw new Error(response.status === 400
      ? "目前模型無法閱讀題目 PDF 圖頁，請改選支援圖片的模型。"
      : response.status === 429 ? "題目判讀達到帳號額度或速率限制，請稍後再試。"
        : `題目 PDF 判讀失敗（HTTP ${response.status}）。`);
    const context = normalizeQuestionContext(parseJsonContent(extractText(await response.json())), document);
    if (!context.requirements.length && !context.siteConditions.length) throw new Error("模型未能從題目 PDF 抽出需求或基地條件。");
    if (questionContextCache.size >= 24) questionContextCache.delete(questionContextCache.keys().next().value || "");
    questionContextCache.set(key, context);
    return context;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("題目 PDF 判讀逾時，請選較短的題目或改用其他已連線模型。");
    throw error;
  } finally { clearTimeout(timeoutId); }
}

export class CliProxyReviewProvider implements ReviewProvider {
  private baseUrl: string;

  constructor() {
    this.baseUrl = (
      process.env.CLIPROXY_URL ||
      process.env.NEXT_PUBLIC_CLIPROXY_MANAGEMENT_URL ||
      "http://127.0.0.1:8317"
    ).trim().replace(/\/+$/, "");

  }

  async reviewDrawing(input: ReviewInput): Promise<DrawingReview> {
    const dataUrl = await fileToDataUrl(input.file);
    const imageDimensions = await readImageDimensions(input.file);
    const modelToUse = await resolveCliProxyModel(input.model);
    const questionContext = input.questionDocument
      ? await readQuestionWithCli(this.baseUrl, modelToUse, input.questionDocument) : null;
    const scenario = input.scenario || "design_8h";
    const targetMinutes = normalizeReviewMinutes(input.targetMinutes, scenario);
    const intensity = input.intensity || (scenario === "quick_study" ? "gentle" : scenario === "design_8h" ? "strict" : "standard");
    const intensityInstruction = `${getIntensityInstruction(intensity)}\n${reviewScenarioInstruction(scenario, targetMinutes)}`;
    const observations = applyObservationOverrides(normalizeObservation(await callCliVision(
      this.baseUrl, modelToUse, observationPrompt, "請先逐項辨識這張完整圖面；只回傳觀察 JSON。", dataUrl, 2800
    )), input.observationOverrides);
    const questionTitle = questionContext?.title || input.practiceQuestion?.title || input.questionTitle?.trim() || "未指定題目";
    const questionBrief = questionContext ? questionContextText(questionContext)
      : input.practiceQuestion ? practiceQuestionText(input.practiceQuestion) : "";
    const query = knowledgeQuery(observations, questionTitle, questionBrief);
    const result = await reviewByTopics({ questionTitle, questionBrief, observation: observations,
      confirmedRegions: input.confirmedRegions || [], intensityInstruction, examType: input.examType || "design",
      retrieve: (topicQuery, limit, focusKeys) => retrieveKnowledge(`${query} ${topicQuery}`, input.examType || "design", limit, focusKeys),
      invoke: async (system, user, maxTokens, imageRefs) => {
        const images = (await Promise.all(imageRefs.map(async (id) => ({ id, url: await getKnowledgeImageDataUrl(id) }))))
          .filter((item): item is { id: string; url: string } => Boolean(item.url));
        return callCliVision(this.baseUrl, modelToUse, system, user, dataUrl, maxTokens, images);
      } });
    const knowledge = result.knowledge;
    const normalized = normalizeReview(result.raw, input.file.name, imageDimensions);
    const allowedIds = new Set(knowledge.map((unit) => unit.id));
    const grounded = { ...groundReview(normalized, observations, allowedIds, input.confirmedRegions),
      model: modelToUse, intensity, scenario, targetMinutes, practiceQuestion: input.practiceQuestion,
      observations, retrievedKnowledge: knowledge, questionContext };
    return calibrateReview(grounded, questionBrief, observations, questionContext?.confidence);
  }

  async reviewSupplement(
    input: SupplementReviewInput
  ): Promise<SupplementReviewResult> {
    const dataUrl = await fileToDataUrl(input.file);
    const imageDimensions = await readImageDimensions(input.file);
    const modelToUse = await resolveCliProxyModel(input.model);
    const intensity = input.intensity || "standard";
    const scenario = input.scenario || "design_8h";
    const intensityInstruction = `${getIntensityInstruction(intensity)}\n${reviewScenarioInstruction(scenario,
      normalizeReviewMinutes(input.targetMinutes, scenario))}`;
    const knowledge = await retrieveKnowledge(
      `${input.originalIssue.title} ${input.originalIssue.description} ${input.originalIssue.suggestion} ${input.originalIssue.evidence || ""}`,
      "design", 10
    );
    const systemPrompt = [
      "你是建築圖面局部補圖審查員。只重審原問題，不評整張圖。先核對文字與幾何證據，原辨識結論可推翻。",
      "如果無法確認，status=still_uncertain、issue.kind=clarity_request；可以確認則 status=resolved。只有圖面及檢索知識均支持時才給缺失。",
      "issue 需含 evidence、criterion、sourceRefs、featureTag、bbox 與一般 ReviewItem 欄位；bbox 以局部圖左上(0,0)、右下(1,1)標示。只回傳 {status,issue} JSON。",
      intensityInstruction,
      `僅引用以下已檢索知識：\n${knowledgePrompt(knowledge)}`
    ].join("\n");
    const temperature = intensity === "strict" ? 0.05 : intensity === "gentle" ? 0.2 : 0.1;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000);

    try {
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getCliProxyHeaders()
        },
        body: JSON.stringify({
          model: modelToUse,
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text:
                    "這是針對原問題的高解析局部補圖。不要重新評論整張圖。請輸出 JSON：{\"status\":\"resolved\"或\"still_uncertain\",\"issue\":完整 ReviewItem}。原問題 context：" +
                    JSON.stringify(input.originalIssue)
                },
                { type: "image_url", image_url: { url: dataUrl, detail: "high" } }
              ]
            }
          ],
          temperature,
          max_tokens: 4096
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error("CLIProxyAPI API key 無效或未設定。請確認 config.yaml 的 api-keys 或 CLIPROXY_API_KEY。");
        }
        if (response.status === 429) {
          throw new Error("上游帳號目前達到額度或速率限制，請稍後再試或切換另一個已連線模型。");
        }
        throw new Error(`CLIProxyAPI 局部精審失敗 (HTTP ${response.status})，請確認 OAuth 帳號與模型狀態。`);
      }

      const payload = await response.json();
      const parsed = parseJsonContent(extractText(payload)) as Record<string, unknown>;
      const status = parsed.status === "resolved" ? "resolved" : "still_uncertain";
      const updated = normalizeItem(parsed.issue, 0, imageDimensions);
      const allowedIds = new Set(knowledge.map((unit) => unit.id));
      const sourceRefs = (updated.sourceRefs || []).filter((id) => allowedIds.has(id));
      const grounded = !!updated.evidence?.trim() && !!updated.criterion?.trim() && sourceRefs.length > 0;
      const finalStatus = status === "resolved" && grounded ? "resolved" : "still_uncertain";

      return {
        status: finalStatus,
        issue: {
          ...updated,
          id: input.originalIssue.id,
          bbox: input.originalIssue.bbox,
          sourceRefs,
          kind: finalStatus === "resolved" ? "issue" : "clarity_request",
          cropRequest: finalStatus === "resolved" ? undefined : updated.cropRequest || input.originalIssue.cropRequest
        }
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export function getReviewProvider(): ReviewProvider {
  const provider = (process.env.REVIEW_PROVIDER || "cliproxy").trim().toLowerCase();

  if (provider === "mock") {
    return new MockReviewProvider();
  }

  if (provider === "cliproxy") {
    return new CliProxyReviewProvider();
  }

  if (provider === "auto") return new CliProxyReviewProvider();

  throw new Error(`Unsupported REVIEW_PROVIDER "${provider}".`);
}
