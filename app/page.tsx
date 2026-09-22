"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import type {
  DrawingReview,
  ReviewItem,
  ReviewSeverity,
  SupplementReviewResult
} from "@/lib/review-schema";
import type { ProjectQuestion } from "@/data/question-bank";
import {
  createMockReview,
  createMockSupplementReview
} from "@/lib/review-mock";
import QuestionBank, { QuestionSelector } from "./question-bank";
import CliProxyOAuthPanel from "./cli-proxy-oauth";
import {
  isImageSuggestionConfigured,
  isLiveReviewConfigured,
  isSupabaseConfigured,
  persistReviewSession,
  saveSuggestionImage,
  updatePersistedReviewFinding,
  updatePersistedReviewPayload
} from "@/lib/supabase-browser";
import {
  generateIssueSuggestionImage,
  reviewDrawingWithAi,
  reviewSupplementWithAi
} from "@/lib/ai-proxy-client";

const defaultDimensions = [
  "配置與機能",
  "動線與分流",
  "戶外空間",
  "法規與無障礙",
  "設計概念與表達"
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

type SupplementState = {
  name: string;
  url: string;
  status: "reviewing" | "resolved" | "error";
  message?: string;
};

type SuggestionGraphicState = {
  status: "generating" | "ready" | "error";
  url?: string;
  message?: string;
};

type PersistedReviewState = {
  sessionId: string;
  findingIds: Record<string, string>;
};

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
  const [supplements, setSupplements] = useState<Record<string, SupplementState>>({});
  const [suggestionGraphics, setSuggestionGraphics] = useState<Record<string, SuggestionGraphicState>>({});
  const [aiSuggestionGraphics, setAiSuggestionGraphics] = useState<Record<string, SuggestionGraphicState>>({});
  const [aiConsent, setAiConsent] = useState(false);
  const [persistedReview, setPersistedReview] = useState<PersistedReviewState | null>(null);
  const [persistenceNotice, setPersistenceNotice] = useState("");
  const suggestionGraphicUrls = useRef<string[]>([]);
  const aiSuggestionGraphicUrls = useRef<string[]>([]);

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
      confidence: 0
    }));

  const activeIssue = useMemo<ReviewItem | undefined>(
    () => issues.find((issue) => issue.id === activeId),
    [activeId, issues]
  );

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

    const previousUrl = suggestionGraphics[issue.id]?.url;
    if (previousUrl) {
      URL.revokeObjectURL(previousUrl);
      suggestionGraphicUrls.current = suggestionGraphicUrls.current.filter(
        (url) => url !== previousUrl
      );
    }
    setSuggestionGraphics((current) => ({
      ...current,
      [issue.id]: { status: "generating" }
    }));

    try {
      const source = new Image();
      source.src = imageUrl;
      await source.decode();

      const canvas = document.createElement("canvas");
      canvas.width = 1600;
      canvas.height = 1300;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("此瀏覽器無法建立圖像畫布。");

      context.fillStyle = "#f7f4ee";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#201e1b";
      context.font = "700 44px 'Noto Sans TC', 'Microsoft JhengHei', sans-serif";
      context.fillText("單項改善建議圖", 64, 76);
      context.fillStyle = "#716b63";
      context.font = "24px 'Noto Sans TC', 'Microsoft JhengHei', sans-serif";
      context.fillText("保留原圖脈絡，聚焦目前選取的 SVG 定位區域", 64, 122);

      const frame = { x: 64, y: 164, w: 1472, h: 676 };
      context.fillStyle = "#ffffff";
      context.fillRect(frame.x, frame.y, frame.w, frame.h);
      context.strokeStyle = "#ded8cf";
      context.lineWidth = 2;
      context.strokeRect(frame.x, frame.y, frame.w, frame.h);

      const clamp = (value: number) => Math.max(0, Math.min(1, value));
      const boxX = clamp(issue.bbox.x);
      const boxY = clamp(issue.bbox.y);
      const boxW = Math.max(0.005, Math.min(1 - boxX, issue.bbox.w));
      const boxH = Math.max(0.005, Math.min(1 - boxY, issue.bbox.h));
      const padX = Math.max(boxW * 0.35, 0.03);
      const padY = Math.max(boxH * 0.35, 0.03);
      const cropLeft = clamp(boxX - padX);
      const cropTop = clamp(boxY - padY);
      const cropRight = clamp(boxX + boxW + padX);
      const cropBottom = clamp(boxY + boxH + padY);
      const cropWidth = Math.max(0.01, cropRight - cropLeft);
      const cropHeight = Math.max(0.01, cropBottom - cropTop);

      const sourceX = cropLeft * source.naturalWidth;
      const sourceY = cropTop * source.naturalHeight;
      const sourceW = cropWidth * source.naturalWidth;
      const sourceH = cropHeight * source.naturalHeight;
      const scale = Math.min(frame.w / sourceW, frame.h / sourceH);
      const renderedW = sourceW * scale;
      const renderedH = sourceH * scale;
      const renderedX = frame.x + (frame.w - renderedW) / 2;
      const renderedY = frame.y + (frame.h - renderedH) / 2;

      context.drawImage(
        source,
        sourceX,
        sourceY,
        sourceW,
        sourceH,
        renderedX,
        renderedY,
        renderedW,
        renderedH
      );

      const mapX = (value: number) =>
        renderedX + ((clamp(value) - cropLeft) / cropWidth) * renderedW;
      const mapY = (value: number) =>
        renderedY + ((clamp(value) - cropTop) / cropHeight) * renderedH;

      context.save();
      context.beginPath();
      context.rect(renderedX, renderedY, renderedW, renderedH);
      context.clip();
      context.strokeStyle = "#a63830";
      context.lineWidth = 7;
      context.setLineDash([18, 12]);
      context.strokeRect(
        mapX(boxX),
        mapY(boxY),
        (boxW / cropWidth) * renderedW,
        (boxH / cropHeight) * renderedH
      );
      context.setLineDash([]);

      if (issue.redline) {
        context.strokeStyle = "#d28b17";
        context.fillStyle = "#d28b17";
        context.lineWidth = 7;
        context.lineCap = "round";
        context.lineJoin = "round";
        if (issue.redline.type === "line") {
          context.beginPath();
          context.moveTo(mapX(issue.redline.x1), mapY(issue.redline.y1));
          context.lineTo(mapX(issue.redline.x2), mapY(issue.redline.y2));
          context.stroke();
        } else if (issue.redline.type === "rect") {
          context.setLineDash([16, 10]);
          context.strokeRect(
            mapX(issue.redline.x),
            mapY(issue.redline.y),
            (issue.redline.w / cropWidth) * renderedW,
            (issue.redline.h / cropHeight) * renderedH
          );
          context.setLineDash([]);
        } else {
          context.beginPath();
          issue.redline.points.forEach(([x, y], index) => {
            if (index === 0) context.moveTo(mapX(x), mapY(y));
            else context.lineTo(mapX(x), mapY(y));
          });
          context.stroke();
        }
      }
      context.restore();

      context.fillStyle = "#a63830";
      context.font = "700 26px 'Noto Sans TC', 'Microsoft JhengHei', sans-serif";
      context.fillText("紅框：問題定位　橘線：修改提示", 64, 888);
      context.fillStyle = "#201e1b";
      context.font = "700 34px 'Noto Sans TC', 'Microsoft JhengHei', sans-serif";
      context.fillText(issue.title, 64, 952, 1472);
      context.fillStyle = "#746f68";
      context.font = "600 23px 'Noto Sans TC', 'Microsoft JhengHei', sans-serif";
      context.fillText(issue.category + " · " + severityLabels[issue.severity] + "風險", 64, 991);

      context.fillStyle = "#201e1b";
      context.font = "700 25px 'Noto Sans TC', 'Microsoft JhengHei', sans-serif";
      context.fillText("修改方向", 64, 1038);
      context.fillStyle = "#504b45";
      context.font = "24px 'Noto Sans TC', 'Microsoft JhengHei', sans-serif";
      const lines: string[] = [];
      let currentLine = "";
      for (const character of issue.suggestion) {
        const nextLine = currentLine + character;
        if (currentLine && context.measureText(nextLine).width > 1472) {
          lines.push(currentLine);
          currentLine = character;
        } else {
          currentLine = nextLine;
        }
      }
      if (currentLine) lines.push(currentLine);
      lines.slice(0, 3).forEach((line, index) => {
        context.fillText(line, 64, 1080 + index * 34);
      });

      context.fillStyle = "#817b74";
      context.font = "18px 'Noto Sans TC', 'Microsoft JhengHei', sans-serif";
      context.fillText(
        "本圖由原圖局部、SVG 定位與審圖文字在本機組成；不會自動改畫平面，也不是 AI 生成圖。",
        64,
        1225,
        1472
      );

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => {
          if (result) resolve(result);
          else reject(new Error("圖像匯出失敗，請稍後重試。"));
        }, "image/png");
      });
      const url = URL.createObjectURL(blob);
      suggestionGraphicUrls.current.push(url);
      setSuggestionGraphics((current) => ({
        ...current,
        [issue.id]: {
          status: "ready",
          url,
          message: "已在此瀏覽器完成單項圖卡，沒有額外上傳原圖。"
        }
      }));
    } catch (error) {
      setSuggestionGraphics((current) => ({
        ...current,
        [issue.id]: {
          status: "error",
          message: error instanceof Error ? error.message : "建議圖產生失敗。"
        }
      }));
    }
  }

  async function handleGenerateAiSuggestion(issue: ReviewItem) {
    if (!imageUrl || issue.kind !== "issue") return;
    if (!aiConsent) {
      setReviewError("請先勾選 AI 資料傳送說明，再產生建議圖。");
      return;
    }

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

    setDrawingFile(file);
    setImageUrl(URL.createObjectURL(file));
    setImageSize(null);
    setReview(null);
    setActiveId("");
    setReviewError("");
    setSupplements({});
    setAiConsent(false);
    setPersistedReview(null);
    setPersistenceNotice("");
    clearSuggestionGraphics();
  }

  async function handleReview() {
    if (!drawingFile || isReviewing) return;

    setIsReviewing(true);
    setReviewError("");
    setPersistenceNotice("");
    setPersistedReview(null);
    clearSuggestionGraphics();

    try {
      let nextReview: DrawingReview;

      if (liveReviewEnabled) {
        if (!aiConsent) throw new Error("請先勾選 AI 資料傳送說明，再開始正式審圖。");
        nextReview = await reviewDrawingWithAi(drawingFile);
      } else if (isStaticDemo) {
        nextReview = createMockReview(drawingFile.name);
      } else {
        const formData = new FormData();
        formData.append("drawing", drawingFile);
        if (selectedQuestion) formData.append("question", JSON.stringify(selectedQuestion));

        const response = await fetch("/api/review", {
          method: "POST",
          body: formData
        });

        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload?.error ?? "審圖失敗");
        }

        nextReview = payload as DrawingReview;
      }

      setReview(nextReview);
      setActiveId(nextReview.issues[0]?.id ?? "");

      if (liveReviewEnabled && supabaseConnected) {
        try {
          const saved = await persistReviewSession(
            nextReview,
            selectedQuestion
              ? `${selectedQuestion.year}年-${selectedQuestion.title}-${drawingFile.name}`
              : drawingFile.name,
            (process.env.NEXT_PUBLIC_REVIEW_MODEL || "").trim()
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
    if (!file || !review) return;

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

      if (liveReviewEnabled) {
        if (!aiConsent) throw new Error("請先勾選 AI 資料傳送說明，再進行局部精審。");
        result = await reviewSupplementWithAi(file, issue);
      } else if (isStaticDemo) {
        result = createMockSupplementReview(issue);
      } else {
        const formData = new FormData();
        formData.append("crop", file);
        formData.append("reviewId", review.reviewId);
        formData.append("drawingId", review.drawingId);
        formData.append("issue", JSON.stringify(issue));

        const response = await fetch("/api/review/supplement", {
          method: "POST",
          body: formData
        });

        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload?.error ?? "局部精審失敗");
        }

        result = payload as SupplementReviewResult;
      }

      const nextIssues = review.issues.map((currentIssue) =>
        currentIssue.id === issue.id ? result.issue : currentIssue
      );
      const nextReview: DrawingReview = {
        ...review,
        issues: nextIssues,
        needsSupplement: nextIssues.some(
          (currentIssue) => currentIssue.kind === "clarity_request"
        )
      };
      setReview(nextReview);

      if (liveReviewEnabled && persistedReview?.findingIds[issue.id]) {
        try {
          await updatePersistedReviewFinding(
            persistedReview.sessionId,
            persistedReview.findingIds[issue.id],
            result.issue
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
          status: result.status === "resolved" ? "resolved" : "reviewing",
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
          <CliProxyOAuthPanel />
          <div className="status-pill">
            {liveReviewEnabled ? "AI 服務已連線" : isStaticDemo ? "本機審圖模式" : "審圖服務已就緒"}
          </div>
        </div>
      </header>

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
            <input type="file" accept="image/*" onChange={handleUpload} />
            <strong>{imageUrl ? "更換圖面" : "選擇作答圖"}</strong>
            <span>{drawingFile ? drawingFile.name : "建議使用完整掃描或正拍"}</span>
          </label>

          {(liveReviewEnabled || aiSuggestionEnabled) && (
            <label className="ai-consent">
              <input
                type="checkbox"
                checked={aiConsent}
                onChange={(event) => setAiConsent(event.target.checked)}
              />
              <span>
                我已瞭解：按下正式審圖會傳送完整圖面；產生單項 AI 建議圖會傳送該問題附近的裁圖與建議文字，資料經 Supabase / 私有 CLIProxyAPI 送至所設定的上游模型處理。
              </span>
            </label>
          )}

          {selectedQuestion && (
            <div className="selected-question-note">
              <span>本次檢討題目</span>
              <strong>{selectedQuestion.year} 年 · {selectedQuestion.title}</strong>
            </div>
          )}

          <button
            className="primary-btn"
            disabled={!drawingFile || isReviewing || (liveReviewEnabled && !aiConsent)}
            onClick={handleReview}
          >
            {isReviewing
              ? "AI 審圖中…"
              : liveReviewEnabled
                ? "開始正式 AI 審圖"
                : "開始示範審圖"}
          </button>

          {reviewError && <p className="error-text">{reviewError}</p>}
          {persistenceNotice && <p className="status-note" role="status">{persistenceNotice}</p>}
        </div>




        <QuestionSelector onSelect={setSelectedQuestion} />
      </section>

      <QuestionBank />

      <section className="workspace">
        <div className="canvas-card">
          <div className="section-head">
            <div>
              <span className="step">03</span>
              <h2>圖面診斷 + SVG 紅線</h2>
            </div>
            <div className="legend">
              <span><i className="dot high" /> 高風險</span>
              <span><i className="dot mid" /> 可改善</span>
              <span><i className="dot low" /> 微調</span>
              <span><i className="dot clarity" /> 需補圖</span>
            </div>
          </div>

          <div
            className={`drawing-stage ${imageUrl ? "has-image" : ""}`}
            style={
              imageSize
                ? { aspectRatio: `${imageSize.width} / ${imageSize.height}` }
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
                  <svg className="overlay" viewBox="0 0 100 100" preserveAspectRatio="none">
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
                          <rect
                            x={svgValue(issue.bbox.x)}
                            y={svgValue(issue.bbox.y)}
                            width={svgValue(issue.bbox.w)}
                            height={svgValue(issue.bbox.h)}
                            rx="1"
                            className={`issue-box ${cls} ${issue.kind === "clarity_request" ? "clarity-box" : ""}`}
                          />
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

          {activeIssue && (
            <div className="active-region-note">
              <strong>目前選取：</strong>
              <span>{activeIssue.title}</span>
              <small>模型信心 {Math.round(activeIssue.confidence * 100)}%</small>
            </div>
          )}
        </div>

        <aside className="review-panel">
          <div className="section-head">
            <div>
              <span className="step">04</span>
              <h2>審圖意見</h2>
            </div>
            <span className="issue-count">
              {review ? `${issues.length} 項` : "尚未分析"}
            </span>
          </div>

          <div className="issue-list">
            {review ? (
              issues.map((issue, index) => {
                const supplement = supplements[issue.id];
                const graphic = suggestionGraphics[issue.id];
                const aiGraphic = aiSuggestionGraphics[issue.id];

                return (
                  <article
                    key={issue.id}
                    className={`issue-card ${activeId === issue.id ? "active" : ""} ${issue.kind === "clarity_request" ? "clarity-card" : ""}`}
                    onClick={() => setActiveId(issue.id)}
                  >
                    <div className="issue-top">
                      <span className={`severity severity-${issue.severity}`}>
                        {severityLabels[issue.severity]}
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
                          <strong>修改方向</strong>
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
                          disabled={graphic?.status === "generating"}
                          onClick={() => void handleGenerateSuggestion(issue)}
                        >
                          {graphic?.status === "generating"
                            ? "正在製作本機圖卡…"
                            : graphic?.status === "ready"
                              ? "重新製作本機圖卡"
                              : "製作本機文字紅線圖卡"}
                        </button>
                        {aiSuggestionEnabled && (
                          <button
                            className="suggestion-generate-button ai-suggestion-button"
                            type="button"
                            disabled={aiGraphic?.status === "generating" || !aiConsent}
                            onClick={() => void handleGenerateAiSuggestion(issue)}
                          >
                            {aiGraphic?.status === "generating"
                              ? "AI 正在產生局部示意圖…"
                              : aiGraphic?.status === "ready"
                                ? "重新產生 AI 局部示意圖"
                                : "AI 產生此項局部示意圖"}
                          </button>
                        )}
                        <p className="suggestion-graphic-note">
                          依此項 SVG 定位、紅線與修改方向，個別整理成可下載圖卡；目前為本機圖面說明，不會自動改畫平面。
                        </p>
                        {graphic?.status === "error" && (
                          <p className="suggestion-graphic-error" role="alert">
                            {graphic.message}
                          </p>
                        )}
                        {graphic?.status === "ready" && graphic.url && (
                          <figure className="suggestion-graphic-preview">
                            <img src={graphic.url} alt={issue.title + " 的本機文字紅線圖卡"} />
                            <figcaption>
                              <span>{graphic.message}</span>
                              <a
                                href={graphic.url}
                                download={"本機圖卡-" + issue.id + ".png"}
                                onClick={(event) => event.stopPropagation()}
                              >
                                下載 PNG
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
                上傳圖面並執行審圖後，這裡會顯示結構化問題、SVG 定位與需要補拍的局部區域。
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
          <span className="issue-count">{review ? "本次審圖" : "等待審圖"}</span>
        </div>
        <div className="score-summary-body">
          <div className="score-big">
            <strong>{review?.overallScore ?? "--"}</strong>
            <span>/ 100</span>
          </div>

          <div className="dimension-list">
            {displayDimensions.map((dimension) => {
              const hasScore =
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
                </div>
              );
            })}
          </div>
        </div>
      </section>

    </main>
  );
}
