"use client";

import { ChangeEvent, type MouseEvent, type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DrawingReview,
  ConfirmedRegion,
  ReviewItem,
  DiscussionMessage,
  ReviewSeverity,
  SupplementReviewResult
} from "@/lib/review-schema";
import type { ReviewIntensity } from "@/lib/review-provider";
import { questionBankCatalog, type ProjectQuestion, type QuestionCategory } from "@/data/question-bank";
import type { QuestionDocument } from "@/lib/question-source";
import type { ObservationOverrides } from "@/lib/review-observation";
import { calibrateReview } from "@/lib/review-rubric";
import { normalizeConfirmedRegions } from "@/lib/review-grounding";
import { questionContextText } from "@/lib/question-context";
import { isPracticeQuestion, type PracticeQuestion, type PracticeQuestionMode } from "@/lib/practice-question";
import { renderPracticeSiteSvg } from "@/lib/practice-site";
import { getReviewScenario, isReviewScenarioId, normalizeReviewMinutes, reviewScenarios,
  type ReviewScenarioId } from "@/lib/review-scenario";
import {
  createMockReview,
  createMockSupplementReview
} from "@/lib/review-mock";
import { QuestionBankPanel, QuestionSelector } from "./question-bank";
import CliProxyOAuthPanel from "./cli-proxy-oauth";
import {
  isImageSuggestionConfigured,
  isLiveReviewConfigured,
  isSupabaseConfigured,
  getSavedSession,
  persistReviewSession,
  saveSuggestionImage,
  updatePersistedReviewFinding,
  updatePersistedReviewPayload
} from "@/lib/supabase-browser";
import {
  generateIssueSuggestionImage,
  cropIssueImage,
  reviewDrawingWithAi,
  reviewSupplementWithAi
} from "@/lib/ai-proxy-client";
import { normalizeSuggestionPlan, renderSuggestionSvg } from "@/lib/suggestion-svg";

const defaultDimensions = [
  "題意與機能需求",
  "基地紋理與建築計畫",
  "空間層次與公共性",
  "入口與動線",
  "圖面可讀性與論證"
];

const severityLabels: Record<ReviewSeverity, string> = {
  high: "高",
  medium: "中",
  low: "低",
  info: "需補圖"
};

const isStaticDemo = process.env.NEXT_PUBLIC_STATIC_DEMO === "true";
const liveReviewEnabled = isLiveReviewConfigured();
const aiSuggestionEnabled = isImageSuggestionConfigured();
const supabaseConnected = isSupabaseConfigured();

async function reviewApiHeaders(): Promise<HeadersInit | undefined> {
  if (!supabaseConnected) return undefined;
  const session = await getSavedSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : undefined;
}

type SupplementState = {
  name: string;
  url: string;
  status: "reviewing" | "resolved" | "uncertain" | "error";
  message?: string;
};

type SuggestionGraphicState = {
  status: "generating" | "ready" | "error";
  url?: string;
  message?: string;
  format?: "svg" | "png";
  remote?: boolean;
};

type PersistedReviewState = {
  sessionId: string;
  findingIds: Record<string, string>;
};

function formatClock(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return [Math.floor(safe / 3600), Math.floor(safe % 3600 / 60), safe % 60]
    .map((part) => String(part).padStart(2, "0")).join(":");
}

async function fileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("無法讀取檔案以匯出。"));
    reader.readAsDataURL(file);
  });
}

async function fileFromBundle(value: unknown, types: string[]): Promise<File | null> {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.dataUrl !== "string" || typeof record.name !== "string" ||
      typeof record.type !== "string" || !types.includes(record.type) ||
      !record.dataUrl.startsWith(`data:${record.type};base64,`)) return null;
  const blob = await (await fetch(record.dataUrl)).blob();
  if (blob.size > 25 * 1024 * 1024) throw new Error("匯入的圖面或題目超過 25 MB。");
  return new File([blob], record.name.slice(0, 180), { type: record.type });
}

function importedReviewOrNull(value: unknown): DrawingReview | null {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("工作檔的審圖資料不完整。");
  const review = value as DrawingReview;
  if (typeof review.reviewId !== "string" || typeof review.drawingId !== "string" ||
      !Array.isArray(review.issues) || review.issues.length > 80 ||
      !Array.isArray(review.dimensions) || review.dimensions.length > 20 ||
      review.dimensions.some((item) => !item || typeof item.key !== "string" || typeof item.label !== "string" ||
        typeof item.score !== "number" || typeof item.maxScore !== "number") ||
      review.issues.some((item) => !item || typeof item.id !== "string" || typeof item.title !== "string" ||
        typeof item.description !== "string" || typeof item.suggestion !== "string" || !item.bbox ||
        ![item.bbox.x, item.bbox.y, item.bbox.w, item.bbox.h].every((number) => typeof number === "number" && Number.isFinite(number) && number >= 0 && number <= 1) ||
        item.bbox.x + item.bbox.w > 1.001 || item.bbox.y + item.bbox.h > 1.001)) {
    throw new Error("工作檔的審圖意見或圖面定位格式不正確。");
  }
  const safeContext = review.questionContext && Array.isArray(review.questionContext.requirements) &&
    Array.isArray(review.questionContext.siteConditions) && Array.isArray(review.questionContext.drawingRequirements) &&
    Array.isArray(review.questionContext.constraints) && Array.isArray(review.questionContext.uncertainties)
    ? { ...review.questionContext, sourceUrl: review.questionContext.sourceUrl?.startsWith("https://wwwq.moex.gov.tw/")
      ? review.questionContext.sourceUrl : undefined } : null;
  const observation = review.observations;
  const safeObservation = observation && observation.checks && typeof observation.checks === "object" &&
    Object.values(observation.checks).every((check) => check && typeof check.status === "string") &&
    [observation.siteEvidence, observation.programEvidence, observation.spatialEvidence, observation.visibleText,
      observation.uncertainties].every(Array.isArray) ? observation : undefined;
  return { ...review, questionContext: safeContext, observations: safeObservation,
    scoreNote: typeof review.scoreNote === "string" ? review.scoreNote : undefined,
    overallScore: typeof review.overallScore === "number" ? review.overallScore : null,
    issues: review.issues.map((item) => ({ ...item, redline: undefined,
      sourceRefs: Array.isArray(item.sourceRefs) ? item.sourceRefs.filter((ref): ref is string => typeof ref === "string").slice(0, 8) : [] })),
    coverage: Array.isArray(review.coverage) ? review.coverage.filter((item) => item && typeof item.key === "string" &&
      typeof item.label === "string" && typeof item.summary === "string").slice(0, 40) : [],
    retrievedKnowledge: Array.isArray(review.retrievedKnowledge) ? review.retrievedKnowledge.filter((item) =>
      item && typeof item.id === "string" && typeof item.statement === "string").slice(0, 100) : [] };
}

function svgValue(value: number) {
  return value * 100;
}

export default function Home() {
  const [imageUrl, setImageUrl] = useState("");
  const [drawingFile, setDrawingFile] = useState<File | null>(null);
  const [activeId, setActiveId] = useState("");
  const [review, setReview] = useState<DrawingReview | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [selectedQuestion, setSelectedQuestion] = useState<ProjectQuestion | null>(null);
  const [questionPdf, setQuestionPdf] = useState<File | null>(null);
  const [observationOverrides, setObservationOverrides] = useState<ObservationOverrides>({});
  const [confirmedRegions, setConfirmedRegions] = useState<ConfirmedRegion[]>([]);
  const [questionExpanded, setQuestionExpanded] = useState(true);
  const [observationsExpanded, setObservationsExpanded] = useState(false);
  const [pickingIssueId, setPickingIssueId] = useState("");
  const [pickingFeatureKey, setPickingFeatureKey] = useState<keyof ObservationOverrides | "">("");
  const [drawingZoom, setDrawingZoom] = useState(100);
  const [supplements, setSupplements] = useState<Record<string, SupplementState>>({});
  const [suggestionGraphics, setSuggestionGraphics] = useState<Record<string, SuggestionGraphicState>>({});
  const [aiSuggestionGraphics, setAiSuggestionGraphics] = useState<Record<string, SuggestionGraphicState>>({});
  const [selectedScenario, setSelectedScenario] = useState<ReviewScenarioId>("design_8h");
  const [targetMinutes, setTargetMinutes] = useState(480);
  const [timerRemaining, setTimerRemaining] = useState(480 * 60);
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerEndAt, setTimerEndAt] = useState(0);
  const [generatedQuestion, setGeneratedQuestion] = useState<PracticeQuestion | null>(null);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [questionMode, setQuestionMode] = useState<PracticeQuestionMode>("mock");
  const [questionCategory, setQuestionCategory] = useState<QuestionCategory>("architectural_design");
  const [specialRequirements, setSpecialRequirements] = useState("");
  const [questionSelectorKey, setQuestionSelectorKey] = useState(0);
  const [isGeneratingQuestion, setIsGeneratingQuestion] = useState(false);
  const [questionGenerationError, setQuestionGenerationError] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [transferNotice, setTransferNotice] = useState("");
  const [discussions, setDiscussions] = useState<Record<string, DiscussionMessage[]>>({});
  const [discussionDrafts, setDiscussionDrafts] = useState<Record<string, string>>({});
  const [discussionBusyId, setDiscussionBusyId] = useState("");
  const [discussionOpenId, setDiscussionOpenId] = useState("");
  const [discussionErrors, setDiscussionErrors] = useState<Record<string, string>>({});
  const [discussionPending, setDiscussionPending] = useState<{ id: string; text: string } | null>(null);
  const [discussionStreamText, setDiscussionStreamText] = useState("");
  const [persistedReview, setPersistedReview] = useState<PersistedReviewState | null>(null);
  const [persistenceNotice, setPersistenceNotice] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [selectedIntensity, setSelectedIntensity] = useState<ReviewIntensity>("strict");
  const [detectedModels, setDetectedModels] = useState<string[]>([]);
  const [proxyStatus, setProxyStatus] = useState<{
    running: boolean;
    starting: boolean;
    hasBinary: boolean;
    ready: boolean;
    error: boolean;
    message: string;
  } | null>(null);
  const [isRefreshingProxy, setIsRefreshingProxy] = useState(false);
  const [knowledgeStats, setKnowledgeStats] = useState<{ sourceCount: number; textChunks: number;
    imagePages: number; imageEmbeddings: number } | null>(null);
  const suggestionGraphicUrls = useRef<string[]>([]);
  const aiSuggestionGraphicUrls = useRef<string[]>([]);
  const questionPdfInputRef = useRef<HTMLInputElement>(null);
  const bundleInputRef = useRef<HTMLInputElement>(null);
  const drawingViewportRef = useRef<HTMLDivElement>(null);
  const reviewPanelRef = useRef<HTMLElement>(null);
  const overlayDrag = useRef<{ id: string; mode: "move" | "resize"; startX: number; startY: number;
    initial: ReviewItem["bbox"]; latest: ReviewItem["bbox"] } | null>(null);
  const suppressOverlayClick = useRef(false);
  const generatedSiteSvg = useMemo(() => generatedQuestion?.sitePlan
    ? renderPracticeSiteSvg(generatedQuestion.sitePlan) : "", [generatedQuestion]);
  const generatedSiteUrl = useMemo(() => generatedSiteSvg
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(generatedSiteSvg)}` : "", [generatedSiteSvg]);

  useEffect(() => {
    if (isStaticDemo) return;
    void fetch("/api/knowledge/status", { cache: "no-store" }).then((response) => response.ok ? response.json() : null)
      .then((value) => { if (value) setKnowledgeStats(value); }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!timerRunning) return;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((timerEndAt - Date.now()) / 1000));
      setTimerRemaining(remaining);
      if (remaining === 0) setTimerRunning(false);
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [timerEndAt, timerRunning]);

  useEffect(() => {
    if (!discussionBusyId) return;
    const log = document.getElementById(`discussion-log-${discussionBusyId}`);
    if (log) log.scrollTop = log.scrollHeight;
  }, [discussionBusyId, discussionStreamText]);

  const refreshCliproxyStatus = useCallback(async (manual = false) => {
    if (manual) setIsRefreshingProxy(true);
    try {
      const response = await fetch("/api/cliproxy/status", { cache: "no-store" });
      const data = await response.json();
      const models = Array.isArray(data.models)
        ? data.models.filter((model: unknown): model is string => typeof model === "string")
        : [];
      setDetectedModels(models);
      setProxyStatus({
        running: Boolean(data.running),
        starting: Boolean(data.starting),
        hasBinary: Boolean(data.hasBinary),
        ready: Boolean(data.ready),
        error: Boolean(data.error),
        message: typeof data.message === "string" ? data.message : "無法讀取 CLIProxyAPI 狀態。"
      });
      setSelectedModel((current) => models.includes(current) ? current : models[0] || "");
    } catch {
      setDetectedModels([]);
      setProxyStatus({
        running: false,
        starting: false,
        hasBinary: false,
        ready: false,
        error: true,
        message: "無法連接本機服務狀態端點。"
      });
      setSelectedModel("");
    } finally {
      if (manual) setIsRefreshingProxy(false);
    }
  }, []);

  useEffect(() => {
    const savedModel = localStorage.getItem("design_ai_selected_model");
    const savedScenario = localStorage.getItem("design_ai_review_scenario");
    if (savedModel) setSelectedModel(savedModel);
    if (isReviewScenarioId(savedScenario)) {
      const minutes = normalizeReviewMinutes(localStorage.getItem("design_ai_review_minutes"), savedScenario);
      setSelectedScenario(savedScenario);
      setQuestionCategory(savedScenario === "site_4h" ? "site_planning" : savedScenario === "civil_6h" ? "civil_service_grade_3" : "architectural_design");
      setTargetMinutes(minutes);
      setTimerRemaining(minutes * 60);
      setSelectedIntensity(savedScenario === "quick_study" ? "gentle" : savedScenario === "design_8h" ? "strict" : "standard");
    }
    if (isStaticDemo) return;
    void refreshCliproxyStatus();
    const timer = window.setInterval(() => void refreshCliproxyStatus(), 7000);
    return () => window.clearInterval(timer);
  }, [refreshCliproxyStatus]);

  function handleModelChange(model: string) {
    setSelectedModel(model);
    if (typeof window !== "undefined") {
      localStorage.setItem("design_ai_selected_model", model);
    }
  }

  function handleScenarioChange(scenario: ReviewScenarioId) {
    const minutes = getReviewScenario(scenario).minutes;
    setSelectedScenario(scenario);
    setQuestionCategory(scenario === "site_4h" ? "site_planning" : scenario === "civil_6h" ? "civil_service_grade_3" : "architectural_design");
    setTargetMinutes(minutes);
    setSelectedIntensity(scenario === "quick_study" ? "gentle" : scenario === "design_8h" ? "strict" : "standard");
    if (!timerRunning) setTimerRemaining(minutes * 60);
    localStorage.setItem("design_ai_review_scenario", scenario);
    localStorage.setItem("design_ai_review_minutes", String(minutes));
  }

  function handleMinutesChange(value: number) {
    const minutes = normalizeReviewMinutes(value, selectedScenario);
    setTargetMinutes(minutes);
    if (!timerRunning) setTimerRemaining(minutes * 60);
    localStorage.setItem("design_ai_review_minutes", String(minutes));
  }

  const isLocalModelReady = Boolean(selectedModel && detectedModels.includes(selectedModel));

  async function handleGenerateQuestion() {
    if (!isLocalModelReady || isGeneratingQuestion) return;
    setIsGeneratingQuestion(true);
    setQuestionGenerationError("");
    try {
      const response = await fetch("/api/questions/generate", { method: "POST",
        headers: { "Content-Type": "application/json", ...await reviewApiHeaders() },
        body: JSON.stringify({ category: questionCategory, mode: questionMode,
          scenario: selectedScenario, minutes: targetMinutes, model: selectedModel, specialRequirements }) });
      const payload = await response.json();
      if (!response.ok || !isPracticeQuestion(payload.question) || !payload.question.sitePlan) {
        throw new Error(payload?.error || "模型未回傳完整的練習題。");
      }
      setGeneratedQuestion(payload.question);
      setGeneratorOpen(true);
      setSelectedQuestion(null);
      setQuestionSelectorKey((current) => current + 1);
      setQuestionPdf(null);
      if (questionPdfInputRef.current) questionPdfInputRef.current.value = "";
    } catch (error) {
      setQuestionGenerationError(error instanceof Error ? error.message : "題目生成失敗。");
    } finally { setIsGeneratingQuestion(false); }
  }

  async function handleExport() {
    try {
      const bundle = {
        format: "design-ai-teacher-review", version: 1, exportedAt: new Date().toISOString(),
        drawing: drawingFile ? { name: drawingFile.name, type: drawingFile.type, dataUrl: await fileDataUrl(drawingFile) } : null,
        questionPdf: questionPdf ? { name: questionPdf.name, type: "application/pdf",
          dataUrl: await fileDataUrl(new File([questionPdf], questionPdf.name, { type: "application/pdf" })) } : null,
        selectedQuestionId: selectedQuestion?.id || null, generatedQuestion, selectedScenario, targetMinutes,
        timerRemaining: timerRunning ? Math.max(0, Math.ceil((timerEndAt - Date.now()) / 1000)) : timerRemaining,
        review, confirmedRegions, observationOverrides, discussions
      };
      const url = URL.createObjectURL(new Blob([JSON.stringify(bundle)], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `審圖工作檔-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setTransferNotice("已匯出圖面、題目、審圖意見、定位與卡片討論。局部修改圖請於各卡片另行下載。");
    } catch (error) { setTransferNotice(error instanceof Error ? error.message : "匯出失敗。"); }
  }

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    setTransferNotice("");
    try {
      if (file.size > 100 * 1024 * 1024) throw new Error("工作檔超過 100 MB，請檢查檔案內容。");
      const bundle = JSON.parse(await file.text()) as Record<string, unknown>;
      if (bundle.format !== "design-ai-teacher-review" || bundle.version !== 1) throw new Error("這不是本平台支援的審圖工作檔。");
      const importedDrawing = await fileFromBundle(bundle.drawing, ["image/png", "image/jpeg", "image/webp"]);
      const importedPdf = await fileFromBundle(bundle.questionPdf, ["application/pdf"]);
      const importedReview = importedReviewOrNull(bundle.review);
      if (importedReview && !importedDrawing) throw new Error("工作檔缺少審圖所對應的原始圖面。");
      const scenario = isReviewScenarioId(bundle.selectedScenario) ? bundle.selectedScenario : "design_8h";
      const minutes = normalizeReviewMinutes(bundle.targetMinutes, scenario);
      const question = questionBankCatalog.find((item) => item.id === bundle.selectedQuestionId) || null;
      const practice = isPracticeQuestion(bundle.generatedQuestion) ? bundle.generatedQuestion : null;
      if (imageUrl.startsWith("blob:")) URL.revokeObjectURL(imageUrl);
      clearSuggestionGraphics();
      setDrawingFile(importedDrawing);
      setImageUrl(importedDrawing ? URL.createObjectURL(importedDrawing) : "");
      setImageSize(null);
      setQuestionPdf(importedPdf);
      setSelectedQuestion(question);
      setQuestionSelectorKey((current) => current + 1);
      setGeneratedQuestion(practice);
      setQuestionMode(practice?.mode || "mock");
      setSpecialRequirements(practice?.specialRequirements || "");
      setGeneratorOpen(Boolean(practice));
      setSelectedScenario(scenario);
      setQuestionCategory(practice?.category || (scenario === "site_4h" ? "site_planning" : scenario === "civil_6h" ? "civil_service_grade_3" : "architectural_design"));
      setTargetMinutes(minutes);
      setSelectedIntensity(scenario === "quick_study" ? "gentle" : scenario === "design_8h" ? "strict" : "standard");
      setTimerRunning(false);
      setTimerRemaining(typeof bundle.timerRemaining === "number" && Number.isFinite(bundle.timerRemaining)
        ? Math.max(0, Math.min(600 * 60, Math.round(bundle.timerRemaining))) : minutes * 60);
      setReview(importedReview || null);
      setActiveId(importedReview?.issues[0]?.id || "");
      setConfirmedRegions(normalizeConfirmedRegions(bundle.confirmedRegions));
      setObservationOverrides(bundle.observationOverrides && typeof bundle.observationOverrides === "object"
        ? bundle.observationOverrides as ObservationOverrides : {});
      setDiscussions(bundle.discussions && typeof bundle.discussions === "object" && !Array.isArray(bundle.discussions)
        ? Object.fromEntries(Object.entries(bundle.discussions).slice(0, 80).map(([id, messages]) => [id,
          Array.isArray(messages) ? messages.slice(-20).flatMap((message) =>
            message && (message.role === "user" || message.role === "assistant") && typeof message.text === "string"
              ? [{ role: message.role, text: message.text.slice(0, 2000), verdict: message.verdict }] : []) : []])) : {});
      setDiscussionOpenId("");
      setDiscussionPending(null);
      setDiscussionStreamText("");
      setSupplements({});
      setPersistedReview(null);
      setReviewError("");
      setTransferNotice("工作檔已匯入。計時器維持暫停；重新審圖會使用目前選取的情境與題目。");
    } catch (error) {
      setTransferNotice(error instanceof Error ? error.message : "匯入失敗。");
    } finally {
      setIsImporting(false);
      event.target.value = "";
    }
  }

  async function handleDiscuss(issue: ReviewItem) {
    const message = (discussionDrafts[issue.id] || "").trim();
    if (!message || !imageUrl || discussionBusyId) return;
    if (!isLocalModelReady) {
      setDiscussionErrors((current) => ({ ...current, [issue.id]: "請先連接可用的 CLI 模型，再討論此卡片。" }));
      return;
    }
    setDiscussionBusyId(issue.id);
    setDiscussionPending({ id: issue.id, text: message });
    setDiscussionStreamText("");
    setDiscussionErrors((current) => ({ ...current, [issue.id]: "" }));
    try {
      const cropUrl = await cropIssueImage(imageUrl, issue.bbox);
      const cropBlob = await (await fetch(cropUrl)).blob();
      const form = new FormData();
      form.append("crop", new File([cropBlob], "card-region.png", { type: "image/png" }));
      form.append("issue", JSON.stringify(issue));
      form.append("history", JSON.stringify(discussions[issue.id] || []));
      form.append("message", message);
      form.append("model", selectedModel);
      form.append("scenario", review?.scenario || selectedScenario);
      const response = await fetch("/api/review/discuss", { method: "POST", body: form,
        headers: { ...await reviewApiHeaders(), Accept: "text/event-stream" } });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}));
        throw new Error(failure.error || "卡片討論失敗。");
      }
      if (!response.body) throw new Error("模型沒有提供可讀的討論串流。");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamedReply = "";
      const outcome: { current: { reply: string; verdict: DiscussionMessage["verdict"]; revisedIssue?: ReviewItem } | null } = { current: null };
      const consume = (block: string) => {
        const data = block.split("\n").filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart()).join("\n");
        if (!data) return;
        const event = JSON.parse(data) as { type: string; text?: string; reply?: string;
          verdict?: DiscussionMessage["verdict"]; revisedIssue?: ReviewItem; message?: string };
        if (event.type === "delta" && event.text) {
          streamedReply += event.text;
          setDiscussionStreamText(streamedReply);
        } else if (event.type === "done" && typeof event.reply === "string") {
          outcome.current = { reply: event.reply, verdict: event.verdict, revisedIssue: event.revisedIssue };
        } else if (event.type === "error") throw new Error(event.message || "討論串流中斷，請重試。");
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          consume(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
        }
      }
      if (buffer.trim()) consume(buffer);
      const payload = outcome.current;
      if (!payload || !payload.reply.trim()) throw new Error("模型未完成討論回覆，請重試。");
      setDiscussions((current) => ({ ...current, [issue.id]: [...(current[issue.id] || []),
        { role: "user", text: message }, { role: "assistant", text: payload.reply, verdict: payload.verdict }] }));
      setDiscussionDrafts((current) => ({ ...current, [issue.id]: "" }));
      if (payload.verdict === "revised" && payload.revisedIssue?.id === issue.id) {
        const nextReview = review ? { ...review, overallScore: null, scoreStale: true,
          scoreNote: "卡片討論已修正一項判讀；請重新完整審圖後更新分數。",
          issues: review.issues.map((item) => item.id === issue.id ? payload.revisedIssue as ReviewItem : item) } : null;
        if (nextReview) {
          setReview(nextReview);
          setPersistenceNotice("卡片討論與修正僅保存在本機頁面；可匯出工作檔保存。總分請重新完整審圖更新。");
        }
      }
    } catch (error) {
      setDiscussionErrors((current) => ({ ...current, [issue.id]: error instanceof Error ? error.message : "卡片討論失敗。" }));
    } finally {
      setDiscussionBusyId("");
      setDiscussionPending(null);
      setDiscussionStreamText("");
    }
  }

  function downloadGeneratedSite() {
    if (!generatedSiteSvg || !generatedQuestion) return;
    const url = URL.createObjectURL(new Blob([generatedSiteSvg], { type: "image/svg+xml;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${generatedQuestion.title.replace(/[\\/:*?"<>|]/g, "-")}-基地條件圖.svg`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  useEffect(() => {
    return () => {
      suggestionGraphicUrls.current.forEach((url) => URL.revokeObjectURL(url));
      aiSuggestionGraphicUrls.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  const issues = review?.issues ?? [];
  const displayDimensions =
    review?.dimensions ??
    defaultDimensions.map((label) => ({
      key: label,
      label,
      score: null,
      maxScore: null,
      confidence: 0,
      evidenceConfidence: 0,
      rationale: "",
      evidence: "",
      sourceRefs: [] as string[]
    }));

  const activeIssue = useMemo<ReviewItem | undefined>(
    () => issues.find((issue) => issue.id === activeId),
    [activeId, issues]
  );

  useEffect(() => {
    const viewport = drawingViewportRef.current;
    const stage = viewport?.querySelector<HTMLElement>(".drawing-stage");
    if (viewport && stage && activeIssue) {
      viewport.scrollTo({ left: Math.max(0, stage.offsetWidth * (activeIssue.bbox.x + activeIssue.bbox.w / 2) - viewport.clientWidth / 2),
        top: Math.max(0, stage.offsetHeight * (activeIssue.bbox.y + activeIssue.bbox.h / 2) - viewport.clientHeight / 2), behavior: "smooth" });
    }
    const panel = reviewPanelRef.current;
    const card = Array.from(panel?.querySelectorAll<HTMLElement>("[data-review-item-id]") || [])
      .find((item) => item.dataset.reviewItemId === activeId);
    if (panel && card) {
      if (window.matchMedia("(max-width: 980px)").matches) {
        card.scrollIntoView({ block: "nearest", behavior: "smooth" });
        return;
      }
      const panelBox = panel.getBoundingClientRect();
      const cardBox = card.getBoundingClientRect();
      if (cardBox.top < panelBox.top + 60 || cardBox.bottom > panelBox.bottom - 20) {
        panel.scrollTo({ top: Math.max(0, panel.scrollTop + cardBox.top - panelBox.top - 72), behavior: "smooth" });
      }
    }
  }, [activeId, drawingZoom]);

  function clearSuggestionGraphics() {
    suggestionGraphicUrls.current.forEach((url) => URL.revokeObjectURL(url));
    suggestionGraphicUrls.current = [];
    aiSuggestionGraphicUrls.current.forEach((url) => URL.revokeObjectURL(url));
    aiSuggestionGraphicUrls.current = [];
    setSuggestionGraphics({});
    setAiSuggestionGraphics({});
  }

  async function handleGenerateSuggestion(issue: ReviewItem) {
    if (!imageUrl || issue.kind !== "issue") return;
    if (!isLocalModelReady) {
      setReviewError("請先連接可用的圖片模型。");
      return;
    }
    const previousUrl = suggestionGraphics[issue.id]?.url;
    if (previousUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(previousUrl);
      suggestionGraphicUrls.current = suggestionGraphicUrls.current.filter((url) => url !== previousUrl);
    }
    setSuggestionGraphics((current) => ({ ...current, [issue.id]: { status: "generating" } }));
    try {
      const cropDataUrl = await cropIssueImage(imageUrl, issue.bbox);
      const cropImage = new Image();
      cropImage.src = cropDataUrl;
      await cropImage.decode();
      const cropBlob = await (await fetch(cropDataUrl)).blob();
      const formData = new FormData();
      formData.append("action", "suggestion");
      formData.append("crop", new File([cropBlob], "suggestion-crop.png", { type: "image/png" }));
      formData.append("model", selectedModel);
      formData.append("issue", JSON.stringify(issue));
      const response = await fetch("/api/review", { method: "POST", body: formData, headers: await reviewApiHeaders() });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "局部 SVG 產生失敗。");
      if (payload.kind === "image") {
        const remote = typeof payload.remoteUrl === "string" && /^https:\/\//.test(payload.remoteUrl);
        const url = remote ? payload.remoteUrl : typeof payload.dataUrl === "string"
          ? URL.createObjectURL(await (await fetch(payload.dataUrl)).blob()) : "";
        if (!url) throw new Error("圖片模型未回傳可預覽的修改圖。");
        if (!remote) suggestionGraphicUrls.current.push(url);
        setSuggestionGraphics((current) => ({ ...current, [issue.id]: {
          status: "ready", url, format: "png", remote,
          message: `${payload.summary || "局部圖面編修"}（模型改用圖片編修；請核對比例與未修改區域。）`
        } }));
      } else {
        const plan = normalizeSuggestionPlan(payload.plan);
        const svg = renderSuggestionSvg(cropDataUrl, cropImage.naturalWidth, cropImage.naturalHeight, plan, issue.title);
        const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
        suggestionGraphicUrls.current.push(url);
        setSuggestionGraphics((current) => ({ ...current, [issue.id]: {
          status: "ready", url, format: "svg",
          message: plan.summary + "（彩色圖形為修改提案，請人工核對。）"
        } }));
      }
    } catch (error) {
      setSuggestionGraphics((current) => ({
        ...current,
        [issue.id]: { status: "error", message: error instanceof Error ? error.message : "局部 SVG 產生失敗。" }
      }));
    }
  }
  async function handleGenerateAiSuggestion(issue: ReviewItem) {
    if (!imageUrl || issue.kind !== "issue") return;

    const previous = aiSuggestionGraphics[issue.id]?.url;
    if (previous?.startsWith("blob:")) {
      URL.revokeObjectURL(previous);
      aiSuggestionGraphicUrls.current = aiSuggestionGraphicUrls.current.filter((url) => url !== previous);
    }
    setAiSuggestionGraphics((current) => ({
      ...current,
      [issue.id]: { status: "generating" }
    }));

    try {
      const result = await generateIssueSuggestionImage(imageUrl, issue);
      let url = result.blob ? URL.createObjectURL(result.blob) : result.remoteUrl;
      if (result.blob) aiSuggestionGraphicUrls.current.push(url);

      let message =
        "由 AI 參考此問題區域與修改方向生成；請再自行核對比例、法規與設計完整性。";
      const findingId = persistedReview?.findingIds[issue.id];
      if (result.blob && persistedReview && findingId) {
        try {
          const saved = await saveSuggestionImage(
            persistedReview.sessionId,
            findingId,
            result.blob,
            (process.env.NEXT_PUBLIC_IMAGE_MODEL || "").trim()
          );
          if (url.startsWith("blob:")) {
            URL.revokeObjectURL(url);
            aiSuggestionGraphicUrls.current = aiSuggestionGraphicUrls.current.filter(
              (candidate) => candidate !== url
            );
          }
          url = saved.signedUrl;
          message += " 已保存至 Supabase 私有儲存，僅限本人登入後預覽。";
        } catch (error) {
          setPersistenceNotice(
            error instanceof Error
              ? "建議圖已在本機產生，但私有保存失敗：" + error.message
              : "建議圖已在本機產生，但私有保存失敗。"
          );
          message += " 本次先保留在瀏覽器，私有保存稍後可重試。";
        }
      } else if (result.blob && !persistedReview) {
        message += " 本次審圖尚未建立雲端紀錄，因此只保留在瀏覽器。";
      } else if (result.remoteUrl) {
        message += " 上游回傳遠端預覽連結，未複製到平台儲存。";
      }

      setAiSuggestionGraphics((current) => ({
        ...current,
        [issue.id]: { status: "ready", url, message }
      }));
    } catch (error) {
      setAiSuggestionGraphics((current) => ({
        ...current,
        [issue.id]: {
          status: "error",
          message: error instanceof Error ? error.message : "AI 建議圖產生失敗。"
        }
      }));
    }
  }

  function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setReviewError("請上傳 PNG、JPEG 或 WebP 圖面。");
      event.target.value = "";
      return;
    }

    if (imageUrl.startsWith("blob:")) URL.revokeObjectURL(imageUrl);
    setDrawingFile(file);
    setImageUrl(URL.createObjectURL(file));
    setImageSize(null);
    setReview(null);
    setActiveId("");
    setReviewError("");
    setSupplements({});
    setObservationOverrides({});
    setConfirmedRegions([]);
    setQuestionExpanded(true);
    setObservationsExpanded(false);
    setPickingIssueId("");
    setPickingFeatureKey("");
    setDiscussions({});
    setDiscussionOpenId("");
    setPersistedReview(null);
    setPersistenceNotice("");
    clearSuggestionGraphics();
  }

  async function handleReview(overrides: ObservationOverrides = observationOverrides, regions: ConfirmedRegion[] = confirmedRegions) {
    if (!drawingFile || isReviewing) return;

    setIsReviewing(true);
    setPickingIssueId("");
    setPickingFeatureKey("");
    setReviewError("");
    setPersistenceNotice("");
    setPersistedReview(null);
    clearSuggestionGraphics();

    try {
      let nextReview: DrawingReview;

      if (isStaticDemo) {
        nextReview = createMockReview(drawingFile.name);
      } else if (isLocalModelReady) {
        const formData = new FormData();
        formData.append("drawing", drawingFile);
        if (selectedQuestion) formData.append("questionId", selectedQuestion.id);
        if (questionPdf) formData.append("questionPdf", questionPdf);
        formData.append("model", selectedModel);
        formData.append("intensity", selectedIntensity);
        formData.append("scenario", selectedScenario);
        formData.append("targetMinutes", String(targetMinutes));
        if (generatedQuestion && !selectedQuestion && !questionPdf) formData.append("practiceQuestion", JSON.stringify(generatedQuestion));
        formData.append("observationOverrides", JSON.stringify(overrides));
        formData.append("confirmedRegions", JSON.stringify(regions));
        const response = await fetch("/api/review", { method: "POST", body: formData, headers: await reviewApiHeaders() });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error ?? "審圖失敗。");
        nextReview = payload as DrawingReview;
      } else if (liveReviewEnabled) {
        let questionDocument: QuestionDocument | null = null;
        if (selectedQuestion || questionPdf) {
          const questionData = new FormData();
          questionData.append("action", "question-document");
          if (selectedQuestion) questionData.append("questionId", selectedQuestion.id);
          if (questionPdf) questionData.append("questionPdf", questionPdf);
          const questionResponse = await fetch("/api/review", { method: "POST", body: questionData, headers: await reviewApiHeaders() });
          const questionPayload = await questionResponse.json();
          if (!questionResponse.ok) throw new Error(questionPayload?.error || "讀取題目 PDF 失敗。");
          questionDocument = questionPayload.document as QuestionDocument | null;
        }
        nextReview = await reviewDrawingWithAi(drawingFile, {
          questionTitle: selectedQuestion ? `${selectedQuestion.year} 年 ${selectedQuestion.title}` : undefined,
          questionDocument,
          practiceQuestion: !selectedQuestion && !questionPdf ? generatedQuestion : null,
          scenario: selectedScenario,
          targetMinutes,
          observationOverrides: overrides,
          confirmedRegions: regions,
          examType: selectedQuestion?.category === "site_planning" || generatedQuestion?.category === "site_planning" ? "site_planning" : "design"
        });
      } else {
        throw new Error(proxyStatus?.message || "尚未連接可用的 AI 模型。請先連接 OAuth 帳號。");
      }

      nextReview = { ...nextReview, scenario: selectedScenario, targetMinutes,
        practiceQuestion: !selectedQuestion && !questionPdf ? generatedQuestion : null };
      setReview(nextReview);
      setDiscussions({});
      setDiscussionOpenId("");
      setQuestionExpanded(true);
      setObservationsExpanded(Boolean(nextReview.observations && Object.values(nextReview.observations.checks).some((check) =>
        check.status === "uncertain" || (check.status !== "not_seen" && (check.locationConfidence ?? 0.4) < 0.7))));
      setActiveId(nextReview.issues[0]?.id ?? "");

      if (liveReviewEnabled && supabaseConnected) {
        try {
          const saved = await persistReviewSession(
            nextReview,
            selectedQuestion
              ? `${selectedQuestion.year}年-${selectedQuestion.title}-${drawingFile.name}`
              : drawingFile.name,
            nextReview.model || selectedModel || (process.env.NEXT_PUBLIC_REVIEW_MODEL || "").trim()
          );
          setPersistedReview(saved);
        } catch (error) {
          setPersistenceNotice(
            error instanceof Error
              ? "AI 審圖已完成，但雲端紀錄保存失敗：" + error.message
              : "AI 審圖已完成，但雲端紀錄保存失敗；本次仍可繼續使用。"
          );
        }
      }
    } catch (error) {
      setReviewError(
        error instanceof Error ? error.message : "審圖流程發生錯誤。"
      );
    } finally {
      setIsReviewing(false);
    }
  }

  async function handleSupplementUpload(
    issue: ReviewItem,
    event: ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];
    if (!file) return;
    await runSupplement(issue, file);
  }

  async function runSupplement(issue: ReviewItem, file: File) {
    if (!review) return;

    const previewUrl = URL.createObjectURL(file);

    setSupplements((current) => ({
      ...current,
      [issue.id]: {
        name: file.name,
        url: previewUrl,
        status: "reviewing"
      }
    }));

    try {
      let result: SupplementReviewResult;
      const localModel = review.model && detectedModels.includes(review.model)
        ? review.model
        : isLocalModelReady
          ? selectedModel
          : null;

      if (isStaticDemo) {
        result = createMockSupplementReview(issue);
      } else if (localModel) {
        const formData = new FormData();
        formData.append("crop", file);
        formData.append("reviewId", review.reviewId);
        formData.append("drawingId", review.drawingId);
        formData.append("issue", JSON.stringify(issue));
        formData.append("model", localModel);
        formData.append("intensity", review.intensity || selectedIntensity);
        formData.append("scenario", review.scenario || selectedScenario);
        formData.append("targetMinutes", String(review.targetMinutes || targetMinutes));

        const response = await fetch("/api/review/supplement", {
          method: "POST",
          body: formData,
          headers: await reviewApiHeaders()
        });

        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload?.error ?? "局部精審失敗");
        }

        result = payload as SupplementReviewResult;
      } else if (liveReviewEnabled) {
        result = await reviewSupplementWithAi(file, issue);
      } else {
        throw new Error(proxyStatus?.message || "尚未連接可用的 AI 模型。");
      }

      const updatedIssue = issue.locationConfirmed
        ? { ...result.issue, bbox: issue.bbox, locationConfidence: 1, locationConfirmed: true, locationPinned: issue.locationPinned }
        : result.issue;
      const nextIssues = review.issues.map((currentIssue) =>
        currentIssue.id === issue.id ? updatedIssue : currentIssue
      );
      let nextReview: DrawingReview = {
        ...review,
        issues: nextIssues,
        needsSupplement: nextIssues.some(
          (currentIssue) => currentIssue.kind === "clarity_request"
        )
      };
      if (nextReview.observations) {
        nextReview = calibrateReview(nextReview, nextReview.questionContext ? questionContextText(nextReview.questionContext) : "",
          nextReview.observations, nextReview.questionContext?.confidence);
      }
      nextReview = { ...nextReview, overallScore: null, scoreStale: true,
        scoreNote: "局部判讀已更新此項意見。五項分數仍基於原圖，請重新完整審圖後再看總分。" };
      setReview(nextReview);

      if (liveReviewEnabled && persistedReview?.findingIds[issue.id]) {
        try {
          await updatePersistedReviewFinding(
            persistedReview.sessionId,
            persistedReview.findingIds[issue.id],
            updatedIssue
          );
          await updatePersistedReviewPayload(persistedReview.sessionId, nextReview);
        } catch (error) {
          setPersistenceNotice(
            error instanceof Error
              ? "局部精審已完成，但雲端紀錄更新失敗：" + error.message
              : "局部精審已完成，但雲端紀錄更新失敗。"
          );
        }
      }

      setSupplements((current) => ({
        ...current,
        [issue.id]: {
          name: file.name,
          url: previewUrl,
          status: result.status === "resolved" ? "resolved" : "uncertain",
          message:
            result.status === "resolved"
              ? "已用局部圖完成精審並回寫原問題。"
              : "資訊仍不足，建議再補一張更清楚的局部圖。"
        }
      }));
    } catch (error) {
      setSupplements((current) => ({
        ...current,
        [issue.id]: {
          name: file.name,
          url: previewUrl,
          status: "error",
          message:
            error instanceof Error ? error.message : "局部精審流程發生錯誤。"
        }
      }));
    }
  }

  function saveIssueRegion(issue: ReviewItem, bbox: ReviewItem["bbox"], pinned = issue.locationPinned === true) {
    setConfirmedRegions((current) => [...current.filter((region) => region.title !== issue.title),
      { title: issue.title, featureTag: issue.featureTag, bbox, pinned }]);
    setReview((current) => current ? { ...current, scoreStale: true, overallScore: null,
      issues: current.issues.map((item) => item.id === issue.id
        ? { ...item, bbox, locationConfidence: 1, locationConfirmed: true, locationPinned: pinned } : item) } : current);
  }

  function handleOverlayPointerDown(event: PointerEvent<SVGRectElement>, issue: ReviewItem, mode: "move" | "resize") {
    if (pickingIssueId || pickingFeatureKey || issue.locationPinned) return;
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    const bounds = svg.getBoundingClientRect();
    overlayDrag.current = { id: issue.id, mode,
      startX: (event.clientX - bounds.left) / bounds.width,
      startY: (event.clientY - bounds.top) / bounds.height,
      initial: issue.bbox, latest: issue.bbox };
    suppressOverlayClick.current = true;
    svg.setPointerCapture(event.pointerId);
    setActiveId(issue.id);
    event.preventDefault();
    event.stopPropagation();
  }

  function handleOverlayPointerMove(event: PointerEvent<SVGSVGElement>) {
    const drag = overlayDrag.current;
    if (!drag) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const dx = (event.clientX - bounds.left) / bounds.width - drag.startX;
    const dy = (event.clientY - bounds.top) / bounds.height - drag.startY;
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
    const bbox = drag.mode === "move"
      ? { ...drag.initial, x: clamp(drag.initial.x + dx, 0, 1 - drag.initial.w),
        y: clamp(drag.initial.y + dy, 0, 1 - drag.initial.h) }
      : { ...drag.initial, w: clamp(drag.initial.w + dx, 0.02, 1 - drag.initial.x),
        h: clamp(drag.initial.h + dy, 0.02, 1 - drag.initial.y) };
    drag.latest = bbox;
    setReview((current) => current ? { ...current, issues: current.issues.map((item) =>
      item.id === drag.id ? { ...item, bbox } : item) } : current);
  }

  function handleOverlayPointerUp(event: PointerEvent<SVGSVGElement>) {
    const drag = overlayDrag.current;
    if (!drag) return;
    overlayDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const issue = review?.issues.find((item) => item.id === drag.id);
    if (issue) saveIssueRegion(issue, drag.latest);
    window.setTimeout(() => { suppressOverlayClick.current = false; }, 0);
  }

  async function reReviewIssue(issue: ReviewItem) {
    if (!imageUrl || isReviewing) return;
    if (issue.kind === "strength") {
      await handleReview();
      return;
    }
    try {
      const cropDataUrl = await cropIssueImage(imageUrl, issue.bbox);
      const cropBlob = await (await fetch(cropDataUrl)).blob();
      await runSupplement(issue, new File([cropBlob], "重新定位局部圖.png", { type: "image/png" }));
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : "局部重審失敗。");
    }
  }

  async function handleImagePositionClick(event: MouseEvent<SVGSVGElement>) {
    if (suppressOverlayClick.current) return;
    if ((!pickingIssueId && !pickingFeatureKey) || !review || !imageUrl) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const px = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const py = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    if (pickingFeatureKey && review.observations) {
      const check = review.observations.checks[pickingFeatureKey];
      const w = Math.max(0.04, Math.min(0.18, check.bbox?.w || 0.08));
      const h = Math.max(0.04, Math.min(0.18, check.bbox?.h || 0.08));
      const bbox = { x: Math.max(0, Math.min(1 - w, px - w / 2)), y: Math.max(0, Math.min(1 - h, py - h / 2)), w, h };
      const nextOverrides: ObservationOverrides = { ...observationOverrides,
        [pickingFeatureKey]: { ...observationOverrides[pickingFeatureKey], status: "verified", bbox } };
      setObservationOverrides(nextOverrides);
      setPickingFeatureKey("");
      await handleReview(nextOverrides);
      return;
    }
    const issue = review.issues.find((item) => item.id === pickingIssueId);
    if (!issue) return;
    const w = Math.max(0.04, Math.min(0.25, issue.bbox.w));
    const h = Math.max(0.04, Math.min(0.25, issue.bbox.h));
    const bbox = { x: Math.max(0, Math.min(1 - w, px - w / 2)), y: Math.max(0, Math.min(1 - h, py - h / 2)), w, h };
    const corrected: ReviewItem = { ...issue, bbox, locationConfidence: 1, locationConfirmed: true, locationPinned: false };
    const nextRegions = [...confirmedRegions.filter((region) => region.title !== issue.title),
      { title: issue.title, featureTag: issue.featureTag, bbox, pinned: false }];
    setConfirmedRegions(nextRegions);
    setReview((current) => current ? { ...current, scoreStale: true, overallScore: null,
      issues: current.issues.map((item) => item.id === issue.id ? { ...corrected, locationPinned: false } : item) } : current);
    setActiveId(issue.id);
    setPickingIssueId("");
    if (issue.kind === "strength") await handleReview(observationOverrides, nextRegions);
    else await reReviewIssue(corrected);
  }

  return (
    <main className="page-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">ARCHITECT EXAM STUDIO</p>
          <h1>AI 審圖老師</h1>
          <p className="subtle">
            建築設計 × 敷地繪圖，從「哪裡有問題」一路標到「可以怎麼改」。
          </p>
        </div>
        <div className="topbar-actions">
          <QuestionBankPanel />
          {!isStaticDemo && <CliProxyOAuthPanel />}
          <div className="status-pill">
            {isLocalModelReady
              ? "CLIProxyAPI 帳號額度已連線"
              : liveReviewEnabled
                ? "雲端 AI 已設定"
                : isStaticDemo
                  ? "GitHub Pages 展示版"
                  : "請連接 AI 帳號"}
          </div>
        </div>
      </header>
      {isStaticDemo && <p className="hosted-demo-note">這是 GitHub Pages 靜態展示頁。AI 生題、串流意見討論與帳號額度審圖需要執行
        <a href="https://github.com/QQQIIIAAANNN/DESIGN_AI_Teacher" target="_blank" rel="noopener noreferrer">本機完整版本</a>。</p>}

      <section className="hero-grid">
        <div className="upload-card">
          <div>
            <span className="step">01</span>
            <h2>上傳你的練習圖</h2>
            <p>
              完整圖先做全局判讀，系統再決定哪些區域需要高解析補圖。
            </p>
          </div>

          <label className="dropzone">
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleUpload} />
            <strong>{imageUrl ? "更換圖面" : "選擇作答圖"}</strong>
            <span>{drawingFile ? drawingFile.name : "建議使用完整掃描或正拍"}</span>
          </label>

          <details className="review-config-card">
            <summary className="config-summary">模型與審查設定 <span>{selectedModel || "等待連線"} · {getReviewScenario(selectedScenario).label}</span></summary>
            <div className="config-header">
              <span className="config-label">審圖參數設定</span>
              <span className="config-status-badge">
                {proxyStatus?.ready
                  ? "🟢 已發現 " + detectedModels.length + " 個可用模型"
                  : proxyStatus?.starting
                    ? "🟡 CLIProxyAPI 啟動中"
                    : proxyStatus?.running
                      ? "🟡 服務已連線，等待模型"
                      : "⚪ 尚未連接 CLIProxyAPI"}
              </span>
            </div>

            {/* 模型選擇 */}
            <div className="config-field">
              <label htmlFor="model-select" className="field-title">
                <span>🤖 AI 核心模型</span>
                <button
                  type="button"
                  className="text-toggle-btn"
                  onClick={() => void refreshCliproxyStatus(true)}
                  disabled={isRefreshingProxy}
                >
                  {isRefreshingProxy ? "偵測中…" : "重新偵測"}
                </button>
              </label>
              <select
                id="model-select"
                className="model-select"
                value={selectedModel}
                onChange={(event) => handleModelChange(event.target.value)}
                disabled={detectedModels.length === 0}
              >
                {!detectedModels.length && (
                  <option value="">{isStaticDemo ? "展示版不連接本機模型" : proxyStatus?.message || "正在偵測 CLIProxyAPI 模型…"}</option>
                )}
                {detectedModels.map((model) => (
                  <option key={model} value={model}>{model}</option>
                ))}
              </select>
              {proxyStatus?.message && <small className="subtle" role="status">{proxyStatus.message}</small>}
            </div>

            <div className="config-field">
              <div className="field-title"><span>審查情境</span><small>依作圖時間與應交成果設定門檻</small></div>
              <div className="scenario-grid" role="radiogroup" aria-label="審查情境">
                {reviewScenarios.map((scenario) => <button key={scenario.id} type="button" role="radio"
                  aria-checked={selectedScenario === scenario.id}
                  className={`scenario-option ${selectedScenario === scenario.id ? "active" : ""}`}
                  onClick={() => handleScenarioChange(scenario.id)}>
                  <strong>{scenario.label}</strong><span>{scenario.range}</span>
                </button>)}
              </div>
              <div className="scenario-detail">
                <p>{getReviewScenario(selectedScenario).description}</p>
                <label>本次作圖時間 <input type="number" min="60" max="600" step="15" value={targetMinutes}
                  onChange={(event) => setTargetMinutes(Number(event.target.value))}
                  onBlur={() => handleMinutesChange(targetMinutes)} /> 分鐘</label>
                <small>{getReviewScenario(selectedScenario).expectation}</small>
              </div>
            </div>
          </details>

          <div className="practice-tools">
            <div className="practice-timer" aria-label="練習計時器">
              <span>練習計時</span><output aria-live={timerRemaining === 0 ? "polite" : "off"}>{formatClock(timerRemaining)}</output>
              <button type="button" onClick={() => {
                if (timerRunning) {
                  setTimerRemaining(Math.max(0, Math.ceil((timerEndAt - Date.now()) / 1000)));
                  setTimerRunning(false);
                } else {
                  const remaining = timerRemaining || targetMinutes * 60;
                  setTimerRemaining(remaining);
                  setTimerEndAt(Date.now() + remaining * 1000);
                  setTimerRunning(true);
                }
              }}>{timerRunning ? "暫停" : timerRemaining === 0 ? "再開始" : "開始"}</button>
              <button type="button" onClick={() => { setTimerRunning(false); setTimerRemaining(targetMinutes * 60); }}>重設</button>
            </div>
            <div className="bundle-actions">
              <button type="button" onClick={() => void handleExport()}>匯出工作檔</button>
              <button type="button" onClick={() => bundleInputRef.current?.click()} disabled={isImporting}>{isImporting ? "匯入中…" : "匯入工作檔"}</button>
              <input ref={bundleInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => void handleImport(event)} />
            </div>
          </div>
          {transferNotice && <p className="status-note" role="status">{transferNotice}</p>}

          <QuestionSelector key={questionSelectorKey} initialQuestion={selectedQuestion} onSelect={(question) => {
            setSelectedQuestion(question);
            if (question) setGeneratedQuestion(null);
          }} />
          <details className="practice-generator" open={generatorOpen} onToggle={(event) => setGeneratorOpen(event.currentTarget.open)}>
            <summary>AI 生成練習題 <span>同級模擬 · 考前猜題</span></summary>
            <div className="generator-controls">
              <label>用途<select value={questionMode} onChange={(event) => setQuestionMode(event.target.value as PracticeQuestionMode)}>
                <option value="mock">同級模擬題</option><option value="forecast">考前猜題練習</option>
              </select></label>
              <label>題型<select value={questionCategory} onChange={(event) => setQuestionCategory(event.target.value as QuestionCategory)}>
                <option value="architectural_design">建築設計</option><option value="site_planning">敷地計畫</option>
                <option value="civil_service_grade_3">公務三級</option>
              </select></label>
              <label className="generator-special">特殊練習需求
                <textarea value={specialRequirements} maxLength={800} rows={3}
                  onChange={(event) => setSpecialRequirements(event.target.value)}
                  placeholder="例如：河岸基地、保留老樹，並特別練習人車分流與半戶外空間。" />
              </label>
              <button type="button" disabled={!isLocalModelReady || isGeneratingQuestion}
                onClick={() => void handleGenerateQuestion()}>{isGeneratingQuestion ? "正在參考歷年案例…" : generatedQuestion ? "重新生成" : "生成題目"}</button>
            </div>
            <p className="generator-note">參考同類歷年案例及可讀取的官方 PDF，產生新的題目與一致的基地示意圖；猜題不代表官方預測。</p>
            {isStaticDemo && <p className="generator-note">完整生題與基地圖下載請在本機完整版使用。</p>}
            {questionGenerationError && <p className="error-text" role="alert">{questionGenerationError}</p>}
            {generatedQuestion && <div className="generated-question-card">
              <div className="generated-question-title"><div><span>{generatedQuestion.mode === "forecast" ? "考前猜題練習" : "同級模擬題"}</span>
                <h3>{generatedQuestion.title}</h3></div>
                <button type="button" onClick={() => setGeneratedQuestion(null)}>不使用</button></div>
              <p>{generatedQuestion.premise}</p>
              {generatedQuestion.specialRequirements && <p className="generated-focus">本次指定練習：{generatedQuestion.specialRequirements}</p>}
              {generatedSiteUrl && <figure className="generated-site-figure">
                <div className="generated-site-heading"><figcaption>基地條件圖 <span>圖上方為北 · 黑白試題風格</span></figcaption>
                  <button type="button" onClick={downloadGeneratedSite}>下載 SVG</button></div>
                <img src={generatedSiteUrl} alt="依題目基地尺寸、道路與鄰地條件繪製的基地圖，指北向上" />
              </figure>}
              {([ ["基地條件", generatedQuestion.siteConditions], ["機能需求", generatedQuestion.program],
                ["設計課題", generatedQuestion.designTasks], ["應交圖說", generatedQuestion.drawingRequirements],
                ["限制條件", generatedQuestion.constraints] ] as const).map(([heading, rows]) =>
                rows.length ? <section key={heading}><strong>{heading}</strong><ul>{rows.map((row, index) => <li key={index}>{row}</li>)}</ul></section> : null)}
              <small>參考案例：{generatedQuestion.referenceIds.map((id) => {
                const source = questionBankCatalog.find((item) => item.id === id);
                return source ? <a key={id} href={source.sourceUrl} target="_blank" rel="noopener noreferrer">{source.year} 年 {source.title}</a> : null;
              })} · {generatedQuestion.sourceDepth === "pdf" ? "含官方 PDF 摘錄" : "僅依題庫索引"}</small>
            </div>}
          </details>
          <details className="question-upload-option">
            <summary>改用自己的題目 PDF{questionPdf ? ` · ${questionPdf.name}` : ""}</summary>
            <label className="question-brief-field">
              <span>上傳檔會優先於已選的官方題目使用。題目文字與基地附圖會自動判讀。</span>
              <input ref={questionPdfInputRef} type="file" accept="application/pdf,.pdf" onChange={(event) => {
                setQuestionPdf(event.target.files?.[0] || null);
                if (event.target.files?.[0]) setGeneratedQuestion(null);
              }} />
            </label>
            {questionPdf && <button className="question-upload-clear" type="button" onClick={() => {
              setQuestionPdf(null);
              if (questionPdfInputRef.current) questionPdfInputRef.current.value = "";
            }}>移除上傳檔</button>}
          </details>

          <button
            className="primary-btn"
            disabled={
              !drawingFile ||
              isReviewing ||
              (!isStaticDemo && !isLocalModelReady && !liveReviewEnabled)
            }
            onClick={() => void handleReview()}
          >
            {isReviewing
              ? "正在分主題審圖與評分…"
              : `開始審圖（${getReviewScenario(selectedScenario).label}${selectedModel ? " · " + selectedModel : liveReviewEnabled ? " · 雲端 AI" : ""}）`}
          </button>
          {(isLocalModelReady || liveReviewEnabled) && <p className="data-use-note">開始審圖時，作答圖與選定題目會傳送至已連接的模型；按下修改圖或卡片討論時才會傳送對應局部圖。</p>}
          {isReviewing && <p className="review-progress-note" role="status">正在依序核對題意與基地、空間層次、動線及環境構造，最後才給出五項暫評。</p>}

          {reviewError && <p className="error-text">{reviewError}</p>}
          {persistenceNotice && <p className="status-note" role="status">{persistenceNotice}</p>}
        </div>




      </section>

      {imageUrl && <>
      <section className="workspace">
        <div className="canvas-card">
          <div className="section-head">
            <div>
              <span className="step">03</span>
              <h2>圖面與審查標註</h2>
            </div>
            <div className="legend">
              <span><i className="dot high" /> 高風險</span>
              <span><i className="dot mid" /> 可改善</span>
              <span><i className="dot low" /> 微調</span>
              <span><i className="dot clarity" /> 需補圖</span>
            </div>
          </div>

          <div className="drawing-tools" aria-label="圖面縮放與定位">
            <span>圖面縮放</span>
            <button type="button" aria-label="縮小圖面" disabled={drawingZoom <= 75} onClick={() => setDrawingZoom((value) => Math.max(75, value - 25))}>−</button>
            <output>{drawingZoom}%</output>
            <button type="button" aria-label="放大圖面" disabled={drawingZoom >= 300} onClick={() => setDrawingZoom((value) => Math.min(300, value + 25))}>＋</button>
            <button type="button" onClick={() => setDrawingZoom(100)}>適合視窗</button>
            <small>選取標註後拖曳移動，拖曳右下角調整範圍。</small>
          </div>

          <div className="drawing-viewport" ref={drawingViewportRef}>
          <div
            className={`drawing-stage ${imageUrl ? "has-image" : ""}`}
            style={
              imageSize
                ? { aspectRatio: `${imageSize.width} / ${imageSize.height}`, width: `${drawingZoom}%` }
                : undefined
            }
          >
            {imageUrl ? (
              <>
                <img
                  src={imageUrl}
                  alt="上傳的建築師考試作答圖"
                  onLoad={(event) =>
                    setImageSize({
                      width: event.currentTarget.naturalWidth,
                      height: event.currentTarget.naturalHeight
                    })
                  }
                />

                {review && (
                  <svg className={`overlay ${pickingIssueId || pickingFeatureKey ? "is-picking" : ""}`} viewBox="0 0 100 100" preserveAspectRatio="none"
                    onPointerMove={handleOverlayPointerMove} onPointerUp={handleOverlayPointerUp} onPointerCancel={handleOverlayPointerUp}
                    onClick={(event) => void handleImagePositionClick(event)}>
                    {issues.map((issue, index) => {
                      const active = issue.id === activeId;
                      const cls =
                        issue.severity === "high"
                          ? "svg-high"
                          : issue.severity === "medium"
                            ? "svg-mid"
                            : issue.severity === "low"
                              ? "svg-low"
                              : "svg-clarity";

                      return (
                        <g
                          key={issue.id}
                          className={active ? "svg-active" : ""}
                          onClick={() => setActiveId(issue.id)}
                        >
                          <title>{issue.title}{issue.locationPinned ? "，位置已固定" : "，可拖曳調整"}</title>
                          <rect
                            x={svgValue(issue.bbox.x)}
                            y={svgValue(issue.bbox.y)}
                            width={svgValue(issue.bbox.w)}
                            height={svgValue(issue.bbox.h)}
                            rx="1"
                            className={`issue-box ${cls} ${issue.kind === "clarity_request" ? "clarity-box" : ""} ${issue.locationPinned ? "pinned-box" : ""}`}
                            onPointerDown={(event) => handleOverlayPointerDown(event, issue, "move")}
                          />
                          {active && !issue.locationPinned && !pickingIssueId && !pickingFeatureKey && <rect
                            x={svgValue(issue.bbox.x + issue.bbox.w) - 1.5}
                            y={svgValue(issue.bbox.y + issue.bbox.h) - 1.5}
                            width="3" height="3" rx="0.5" className="resize-handle"
                            onPointerDown={(event) => handleOverlayPointerDown(event, issue, "resize")}
                          />}
                          <circle
                            cx={svgValue(issue.bbox.x) + 2}
                            cy={svgValue(issue.bbox.y) + 2}
                            r="2.4"
                            className={`issue-pin ${cls}`}
                          />
                          <text
                            x={svgValue(issue.bbox.x) + 2}
                            y={svgValue(issue.bbox.y) + 2.8}
                            className="issue-number"
                          >
                            {index + 1}
                          </text>

                          {issue.redline?.type === "line" && (
                            <line
                              x1={svgValue(issue.redline.x1)}
                              y1={svgValue(issue.redline.y1)}
                              x2={svgValue(issue.redline.x2)}
                              y2={svgValue(issue.redline.y2)}
                              className="redline"
                            />
                          )}

                          {issue.redline?.type === "rect" && (
                            <rect
                              x={svgValue(issue.redline.x)}
                              y={svgValue(issue.redline.y)}
                              width={svgValue(issue.redline.w)}
                              height={svgValue(issue.redline.h)}
                              className="redline dashed"
                            />
                          )}

                          {issue.redline?.type === "polyline" && (
                            <polyline
                              points={issue.redline.points
                                .map(([x, y]) => `${svgValue(x)},${svgValue(y)}`)
                                .join(" ")}
                              className="redline"
                            />
                          )}
                        </g>
                      );
                    })}
                  </svg>
                )}
              </>
            ) : (
              <div className="empty-state">
                <div className="mini-plan" />
                <strong>圖面會顯示在這裡</strong>
                <span>上傳後即可疊加 AI 批註、紅線與補圖要求</span>
              </div>
            )}
          </div>
          </div>

          {activeIssue && (
            <div className="active-region-note">
              <strong>目前選取：</strong>
              <span>{activeIssue.title}</span>
              <small>模型信心 {Math.round(activeIssue.confidence * 100)}%</small>
            </div>
          )}
          {(pickingIssueId || pickingFeatureKey) && <div className="location-pick-hint" role="status">
            點一下圖面中{pickingFeatureKey ? "要素" : "這項意見"}的正確位置，平台會重新判讀。
            <button type="button" onClick={() => { setPickingIssueId(""); setPickingFeatureKey(""); }}>取消</button>
          </div>}
        </div>

        <aside className="review-panel" ref={reviewPanelRef}>
          <div className="section-head">
            <div>
              <span className="step">04</span>
              <h2>審圖意見</h2>
            </div>
            <div className="review-meta-pills">
              {review?.scenario && (
                <span className={`intensity-pill pill-${review.intensity || "standard"}`}>
                  {getReviewScenario(review.scenario).label} · {review.targetMinutes || getReviewScenario(review.scenario).minutes} 分鐘
                </span>
              )}
              {review?.model && (
                <span className="model-pill">🤖 {review.model}</span>
              )}
              <span className="issue-count">
                {review ? `${issues.length} 項` : "尚未分析"}
              </span>
            </div>
          </div>

          {knowledgeStats && <p className="knowledge-status">
            私有教材索引：{knowledgeStats.sourceCount} 份來源 · {knowledgeStats.textChunks} 段文字 · {knowledgeStats.imagePages} 筆圖頁
            {knowledgeStats.imageEmbeddings > 0 && ` · ${knowledgeStats.imageEmbeddings} 筆圖片向量`}
            <span>教材摘錄尚未人工審定</span>
          </p>}

          {review?.questionContext && (
            <details className="review-trace question-context-panel" open={questionExpanded}
              onToggle={(event) => setQuestionExpanded(event.currentTarget.open)}>
              <summary>已讀取題目 · {review.questionContext.title} · 信心 {Math.round(review.questionContext.confidence * 100)}%</summary>
              <p>來源：{review.questionContext.sourceKind === "official" ? "官方試題 PDF" : "你上傳的 PDF"} · {review.questionContext.pageCount} 頁</p>
              <p>{review.questionContext.summary}</p>
              {!!review.questionContext.requirements.length && <p><strong>計畫需求</strong>　{review.questionContext.requirements.join("；")}</p>}
              {!!review.questionContext.siteConditions.length && <p><strong>基地條件</strong>　{review.questionContext.siteConditions.join("；")}</p>}
              {!!review.questionContext.drawingRequirements.length && <p><strong>圖面要求</strong>　{review.questionContext.drawingRequirements.join("；")}</p>}
              {!!review.questionContext.constraints.length && <p><strong>限制條件</strong>　{review.questionContext.constraints.join("；")}</p>}
              {!!review.questionContext.uncertainties.length && <p><strong>待核對</strong>　{review.questionContext.uncertainties.join("；")}</p>}
              {review.questionContext.sourceUrl && <a href={review.questionContext.sourceUrl} target="_blank" rel="noopener noreferrer">開啟原始題目 PDF</a>}
            </details>
          )}
          {review?.observations && (
            <details className="review-trace" open={observationsExpanded}
              onToggle={(event) => setObservationsExpanded(event.currentTarget.open)}>
              <summary>圖面辨識與位置確認</summary>
              <p>{review.observations.summary}</p>
              <div className="trace-list">
                {Object.entries(review.observations.checks).map(([key, check]) => (
                  <label className="feature-confirm" key={key}>
                    <span><strong>{({ north_arrow: "指北針", main_entrance: "主入口", basement_ramp: "地下室車道坡道", outdoor_stair: "戶外階梯" } as Record<string, string>)[key] || key}</strong>
                      {check.status === "verified" ? "已辨識" : check.status === "not_seen" ? "未見" : "待確認"} · 證據信心 {Math.round((check.confidence ?? 0.5) * 100)}% · 定位信心 {Math.round((check.locationConfidence ?? 0.4) * 100)}%<br />{check.evidence}</span>
                    <div className="feature-confirm-actions">
                      <select aria-label={`確認${key}`} value={observationOverrides[key as keyof ObservationOverrides]?.status || ""}
                        onChange={(event) => setObservationOverrides((current) => ({ ...current,
                          [key]: { ...current[key as keyof ObservationOverrides], status: event.target.value as "verified" | "uncertain" | "not_seen" || undefined } }))}>
                        <option value="">依模型判讀</option>
                        <option value="verified">我確認有此要素</option>
                        <option value="not_seen">圖上沒有此要素</option>
                        <option value="uncertain">仍需確認</option>
                      </select>
                      <button className="secondary-action" type="button" onClick={() => {
                        setActiveId(""); setPickingIssueId(""); setPickingFeatureKey(key as keyof ObservationOverrides);
                      }}>{(check.locationConfidence ?? 0.4) < 0.7 ? "確認圖面位置" : "更正圖面位置"}</button>
                    </div>
                  </label>
                ))}
              </div>
              {Object.values(observationOverrides).some((value) => Boolean(value?.status || value?.bbox)) && <button className="secondary-action" type="button" disabled={isReviewing} onClick={() => void handleReview()}>
                依確認結果重新審圖
              </button>}
              {review.observations.spatialEvidence.length > 0 && <p>空間證據：{review.observations.spatialEvidence.join("；")}</p>}
              {review.observations.siteEvidence.length > 0 && <p>基地證據：{review.observations.siteEvidence.join("；")}</p>}
              {review.observations.programEvidence.length > 0 && <p>機能證據：{review.observations.programEvidence.join("；")}</p>}
            </details>
          )}
          {review?.retrievedKnowledge?.length ? (
            <details className="review-trace">
              <summary>本次檢索的知識要點（{review.retrievedKnowledge.length}）</summary>
              <ul>{review.retrievedKnowledge.map((unit) => (
                <li key={unit.id}><strong>{unit.id}</strong> · {unit.sourceTitle}（{unit.sourceType === "platform_policy" ? "平台準則" : unit.sourceType}）：{unit.statement}</li>
              ))}</ul>
            </details>
          ) : null}

          {!!review?.coverage?.length && <details className="review-trace coverage-panel" open>
            <summary>審查範圍（{review.coverage.filter((item) => item.status === "reviewed").length}/{review.coverage.length} 項已檢視）</summary>
            <div className="coverage-grid">{review.coverage.map((item) => <div key={item.key} className={`coverage-item status-${item.status}`}>
              <strong>{item.label}</strong>
              <span>{item.status === "reviewed" ? "已檢視" : item.status === "not_applicable" ? "本題不適用" : "需更多證據"}</span>
              <p>{item.summary}</p>
            </div>)}</div>
          </details>}

          {review && <p className="confidence-explain">信心數值是模型對證據與落點的估計。位置不準時可直接在圖面更正，系統會重新判讀。</p>}

          <div className="issue-list">
            {review ? (
              issues.map((issue, index) => {
                const supplement = supplements[issue.id];
                const graphic = suggestionGraphics[issue.id];
                const aiGraphic = aiSuggestionGraphics[issue.id];

                return (
                  <article
                    key={issue.id}
                    data-review-item-id={issue.id}
                    className={`issue-card ${activeId === issue.id ? "active" : ""} ${issue.kind === "clarity_request" ? "clarity-card" : ""} ${issue.kind === "strength" ? "strength-card" : ""}`}
                    onClick={() => setActiveId(issue.id)}
                  >
                    <div className="issue-top">
                      <span className={`severity severity-${issue.severity}`}>
                        {issue.kind === "strength" ? "值得保留" : severityLabels[issue.severity]}
                      </span>
                      <span className="category">{issue.category}</span>
                      <b>
                        {issue.scoreImpact === null
                          ? `${Math.round(issue.confidence * 100)}% 信心`
                          : `${issue.scoreImpact} 分`}
                      </b>
                    </div>

                    <h3>{index + 1}. {issue.title}</h3>
                    <p>{issue.description}</p>
                    <div className="confidence-row">
                      <span>判斷信心 {Math.round((issue.evidenceConfidence ?? issue.confidence) * 100)}%</span>
                      <span>定位信心 {Math.round((issue.locationConfidence ?? 0.5) * 100)}%</span>
                      {issue.locationConfirmed && <span>位置已由你確認</span>}
                      {issue.locationPinned && <span>📌 已固定</span>}
                    </div>
                    <div className="region-actions"><button className="secondary-action" type="button" onClick={(event) => {
                        event.stopPropagation(); setActiveId(issue.id); setPickingIssueId(issue.id);
                      }}>{!issue.locationConfirmed && (issue.locationConfidence ?? 0.5) < 0.7 ? "在圖面確認位置" : "更正圖面位置"}</button>
                      <button className="secondary-action" type="button" disabled={isReviewing || supplement?.status === "reviewing"} onClick={(event) => {
                        event.stopPropagation(); void reReviewIssue(issue);
                      }}>重審此處</button>
                      <button className="secondary-action" type="button" onClick={(event) => {
                        event.stopPropagation(); saveIssueRegion(issue, issue.bbox, !issue.locationPinned);
                      }}>{issue.locationPinned ? "解除圖釘" : "圖釘固定"}</button>
                      <button className="secondary-action discussion-trigger" type="button"
                        aria-expanded={discussionOpenId === issue.id}
                        onClick={(event) => { event.stopPropagation(); setActiveId(issue.id);
                          setDiscussionOpenId((current) => current === issue.id ? "" : issue.id); }}>
                        討論此意見{discussions[issue.id]?.length ? ` · ${Math.ceil(discussions[issue.id].length / 2)}` : ""}
                      </button></div>
                    {(issue.evidence || issue.criterion || issue.sourceRefs?.length) && (
                      <div className="issue-evidence">
                        {issue.evidence && <p><strong>圖面證據：</strong>{issue.evidence}</p>}
                        {issue.criterion && <p><strong>審查要點：</strong>{issue.criterion}</p>}
                        {!!issue.sourceRefs?.length && <p><strong>知識依據：</strong>{issue.sourceRefs.join("、")}</p>}
                      </div>
                    )}

                    {discussionOpenId === issue.id && <section className="issue-discussion"
                      aria-label={`${issue.title}的討論`} onClick={(event) => event.stopPropagation()}>
                      <div className="discussion-heading"><strong>針對這項意見討論</strong>
                        <span>模型會重新看此處局部圖；若修正判讀，總分需重評。對話可隨工作檔匯出。</span></div>
                      <div id={`discussion-log-${issue.id}`} className="discussion-messages" role="log">
                        {(discussions[issue.id] || []).length ? discussions[issue.id].map((entry, messageIndex) =>
                          <div key={messageIndex} className={`discussion-message ${entry.role}`}>
                            <span>{entry.role === "user" ? "你" : entry.verdict === "revised" ? "AI · 已修正" :
                              entry.verdict === "needs_evidence" ? "AI · 需更多證據" : "AI"}</span>
                            <p>{entry.text}</p>
                          </div>) : !discussionPending || discussionPending.id !== issue.id
                            ? <p className="discussion-empty">可以指出誤判、補充圖面線索，或追問這項評語的依據。</p> : null}
                        {discussionPending?.id === issue.id && <>
                          <div className="discussion-message user"><span>你</span><p>{discussionPending.text}</p></div>
                          <div className="discussion-message streaming" aria-live="polite">
                            <span>AI · 即時回覆中</span><p>{discussionStreamText || "正在核對局部圖與相關知識…"}</p>
                          </div>
                        </>}
                      </div>
                      <form onSubmit={(event) => { event.preventDefault(); void handleDiscuss(issue); }}>
                        <label htmlFor={`discussion-${issue.id}`} className="sr-only">討論內容</label>
                        <textarea id={`discussion-${issue.id}`} value={discussionDrafts[issue.id] || ""}
                          onChange={(event) => setDiscussionDrafts((current) => ({ ...current, [issue.id]: event.target.value }))}
                          maxLength={2000} rows={3} placeholder="例如：這裡其實是地下室車道，坡道線與車道箭頭在右下方。" />
                        <button type="submit" disabled={!isLocalModelReady || !discussionDrafts[issue.id]?.trim() || Boolean(discussionBusyId)}>
                          {discussionBusyId === issue.id ? "重新核對中…" : "送出討論"}</button>
                      </form>
                      {discussionErrors[issue.id] && <p className="error-text" role="alert">{discussionErrors[issue.id]}</p>}
                    </section>}

                    {issue.kind === "clarity_request" && issue.cropRequest ? (
                      <div className="crop-request">
                        <strong>為什麼需要補圖</strong>
                        <p>{issue.cropRequest.reason}</p>

                        <strong>補圖時請保留</strong>
                        <ul>
                          {issue.cropRequest.instructions.map((instruction) => (
                            <li key={instruction}>{instruction}</li>
                          ))}
                        </ul>

                        <div className="review-targets">
                          {issue.cropRequest.reviewTargets.map((target) => (
                            <span key={target}>{target}</span>
                          ))}
                        </div>

                        <label
                          className="crop-upload"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(event) => handleSupplementUpload(issue, event)}
                          />
                          <strong>
                            {supplement?.status === "reviewing"
                              ? "局部精審中…"
                              : supplement
                                ? "更換局部圖"
                                : "補上局部高解析圖"}
                          </strong>
                          <span>{supplement ? supplement.name : "重新近拍或上傳裁切圖"}</span>
                        </label>

                        {supplement && (
                          <div className="supplement-preview">
                            <img src={supplement.url} alt="使用者補上的局部圖" />
                            <div>
                              <strong>
                                {supplement.status === "reviewing"
                                  ? "正在局部精審"
                                  : supplement.status === "error"
                                    ? "局部精審失敗"
                                    : supplement.status === "uncertain"
                                      ? "仍需更清楚的局部圖"
                                      : "局部精審完成"}
                              </strong>
                              <span>{supplement.message ?? "保留原圖 context，重審此區。"}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        <div className="suggestion">
                          <strong>{issue.kind === "strength" ? "值得繼續保持" : "修改方向"}</strong>
                          <span>{issue.suggestion}</span>
                        </div>
                        {supplement?.status === "resolved" && (
                          <div className="resolved-note">
                            ✓ 此意見已由局部補圖重新判讀
                          </div>
                        )}
                      </>
                    )}
                    {issue.kind === "issue" && (
                      <div
                        className="suggestion-graphic-actions"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <button
                          className="suggestion-generate-button"
                          type="button"
                          disabled={graphic?.status === "generating" || !isLocalModelReady ||
                            (!issue.locationConfirmed && (issue.locationConfidence ?? 0.5) < 0.7)}
                          onClick={() => void handleGenerateSuggestion(issue)}
                        >
                          {graphic?.status === "generating"
                            ? "正在生成局部修改圖…"
                            : graphic?.status === "ready"
                              ? "重新生成局部修改圖"
                              : "生成局部修改圖"}
                        </button>
                        {aiSuggestionEnabled && (
                          <details className="advanced-image-action">
                            <summary>其他產圖方式</summary>
                            <button
                            className="suggestion-generate-button ai-suggestion-button"
                            type="button"
                            disabled={aiGraphic?.status === "generating"}
                            onClick={() => void handleGenerateAiSuggestion(issue)}
                          >
                            {aiGraphic?.status === "generating"
                              ? "AI 正在產生局部示意圖…"
                              : aiGraphic?.status === "ready"
                                ? "重新產生 AI 局部示意圖"
                                : "AI 產生此項局部示意圖"}
                            </button>
                          </details>
                        )}
                        <p className="suggestion-graphic-note">
                          {(!issue.locationConfirmed && (issue.locationConfidence ?? 0.5) < 0.7)
                            ? "請先在圖面確認位置，再生成修改圖。"
                            : "按下後讀取這個局部圖。能精準定位時產生 SVG；複雜圖形會改用已連線的圖片編修模型。"}
                        </p>
                        {graphic?.status === "error" && (
                          <p className="suggestion-graphic-error" role="alert">
                            {graphic.message}
                          </p>
                        )}
                        {graphic?.status === "ready" && graphic.url && (
                          <figure className="suggestion-graphic-preview">
                            <img src={graphic.url} alt={issue.title + " 的局部修改圖"} />
                            <figcaption>
                              <span>{graphic.message}</span>
                              <a href={graphic.url}
                                download={graphic.remote ? undefined : `局部修改-${issue.id}.${graphic.format === "png" ? "png" : "svg"}`}
                                target={graphic.remote ? "_blank" : undefined}
                                rel={graphic.remote ? "noopener noreferrer" : undefined}
                                onClick={(event) => event.stopPropagation()}>
                                {graphic.remote ? "開啟圖片" : `下載 ${graphic.format === "png" ? "PNG" : "SVG"}`}
                              </a>
                            </figcaption>
                          </figure>
                        )}
                        {aiGraphic?.status === "error" && (
                          <p className="suggestion-graphic-error" role="alert">{aiGraphic.message}</p>
                        )}
                        {aiGraphic?.status === "ready" && aiGraphic.url && (
                          <figure className="suggestion-graphic-preview ai-suggestion-preview">
                            <img src={aiGraphic.url} alt={issue.title + " 的 AI 局部改善示意圖"} />
                            <figcaption>
                              <span>{aiGraphic.message}</span>
                              {aiGraphic.url.startsWith("blob:") ? (
                                <a
                                  href={aiGraphic.url}
                                  download={"AI改善示意圖-" + issue.id + ".png"}
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  下載 PNG
                                </a>
                              ) : (
                                <a
                                  href={aiGraphic.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  開啟原圖
                                </a>
                              )}
                            </figcaption>
                          </figure>
                        )}
                      </div>
                    )}
                  </article>
                );
              })
            ) : (
              <div className="panel-empty">
                點選「開始審圖」後，這裡會顯示意見、圖面位置及需要補拍的局部區域。
              </div>
            )}
          </div>
        </aside>
      </section>


      <section className="score-card score-summary" aria-labelledby="score-title">
        <div className="section-head">
          <div>
            <span className="step">05</span>
            <h2 id="score-title">結構化評分</h2>
          </div>
          <span className="issue-count">{review?.scoreStale ? "等待重新評分" : review ? "本次審圖" : "等待審圖"}</span>
        </div>
        <div className="score-summary-body">
          <div className="score-big">
            <strong>{review?.overallScore ?? "--"}</strong>
            <span>/ 100</span>
          </div>
          {review?.scoreNote && <p className="score-note">{review.scoreNote}</p>}
          {review?.scoreStale && <button className="secondary-action rescore-action" type="button" disabled={isReviewing} onClick={() => void handleReview()}>
            {isReviewing ? "正在重新審圖…" : "重新完整審圖並更新分數"}
          </button>}

          <div className="dimension-list">
            {displayDimensions.map((dimension) => {
              const hasScore = !review?.scoreStale &&
                dimension.score !== null && dimension.maxScore !== null;

              return (
                <div key={dimension.label} className="dimension-row">
                  <span>{dimension.label}</span>
                  <div className="meter">
                    <i
                      style={{
                        width: hasScore
                          ? `${(dimension.score / dimension.maxScore) * 100}%`
                          : "0%"
                      }}
                    />
                  </div>
                  <b>
                    {hasScore
                      ? `${dimension.score}/${dimension.maxScore}`
                      : "--"}
                  </b>
                  {review && <small className="dimension-detail">
                    證據信心 {Math.round((dimension.evidenceConfidence ?? dimension.confidence) * 100)}% · {dimension.rationale || "理由待補"}
                    {dimension.evidence ? ` · 圖面證據：${dimension.evidence}` : " · 圖面證據不足"}
                    {dimension.sourceRefs?.length ? ` · 知識：${dimension.sourceRefs.join("、")}` : ""}
                  </small>}
                </div>
              );
            })}
          </div>
        </div>
      </section>
      </>}

    </main>
  );
}
