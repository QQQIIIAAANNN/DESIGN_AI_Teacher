"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import type {
  DrawingReview,
  ReviewItem,
  ReviewSeverity,
  SupplementReviewResult
} from "@/lib/review-schema";
import {
  createMockReview,
  createMockSupplementReview
} from "@/lib/review-mock";
import QuestionBank from "./question-bank";

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
  const [supplements, setSupplements] = useState<Record<string, SupplementState>>({});
  const [suggestionGraphics, setSuggestionGraphics] = useState<Record<string, SuggestionGraphicState>>({});
  const suggestionGraphicUrls = useRef<string[]>([]);

  useEffect(() => {
    return () => suggestionGraphicUrls.current.forEach((url) => URL.revokeObjectURL(url));
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
    setSuggestionGraphics({});
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
    clearSuggestionGraphics();
  }

  async function handleReview() {
    if (!drawingFile || isReviewing) return;

    setIsReviewing(true);
    setReviewError("");
    clearSuggestionGraphics();

    try {
      let nextReview: DrawingReview;

      if (isStaticDemo) {
        nextReview = createMockReview(drawingFile.name);
      } else {
        const formData = new FormData();
        formData.append("drawing", drawingFile);

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

      if (isStaticDemo) {
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

      setReview((current) => {
        if (!current) return current;

        const nextIssues = current.issues.map((currentIssue) =>
          currentIssue.id === issue.id ? result.issue : currentIssue
        );

        return {
          ...current,
          issues: nextIssues,
          needsSupplement: nextIssues.some(
            (currentIssue) => currentIssue.kind === "clarity_request"
          )
        };
      });

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
        <div className={`status-pill ${isStaticDemo ? "demo-status" : ""}`}>
          {isStaticDemo ? "GitHub Pages 測試版 · Mock 評圖" : "MVP v0.3 · Review + Crop API"}
        </div>
      </header>

      {isStaticDemo && (
        <p className="demo-notice" role="status">
          這是靜態測試版：回饋為固定示範內容，不代表實際 AI 判讀。上傳圖面及題目 PDF 只在此瀏覽器預覽，不會傳到伺服器或保存。
        </p>
      )}

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

          <button
            className="primary-btn"
            disabled={!drawingFile || isReviewing}
            onClick={handleReview}
          >
            {isReviewing ? "AI 審圖中…" : "開始 AI 審圖"}
          </button>

          {reviewError && <p className="error-text">{reviewError}</p>}
        </div>

        <div className="score-card">
          <span className="step">02</span>
          <h2>結構化評分</h2>
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
                            ? "正在產生此項建議圖…"
                            : graphic?.status === "ready"
                              ? "重新產生此項建議圖"
                              : "產生此項建議圖"}
                        </button>
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
                            <img src={graphic.url} alt={issue.title + " 的單項建議圖"} />
                            <figcaption>
                              <span>{graphic.message}</span>
                              <a
                                href={graphic.url}
                                download={"建議圖-" + issue.id + ".png"}
                                onClick={(event) => event.stopPropagation()}
                              >
                                下載 PNG
                              </a>
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

      <section className="roadmap">
        <div>
          <span className="step">ARCHITECTURE</span>
          <h2>{isStaticDemo ? "GitHub Pages 互動測試" : "完整圖與局部補圖都已走 Review API"}</h2>
        </div>
        <div className="roadmap-grid">
          {isStaticDemo ? (
            <>
              <article>
                <strong>Mock 評圖</strong>
                <p>按下開始後顯示固定示範回饋，不會呼叫 AI 模型。</p>
              </article>
              <article>
                <strong>瀏覽器本機預覽</strong>
                <p>原圖與補圖只用於目前頁面的預覽，不會上傳到網站。</p>
              </article>
              <article>
                <strong>互動流程</strong>
                <p>可切換問題、檢查 SVG 紅線，並體驗補圖後更新示範意見。</p>
              </article>
              <article>
                <strong>靜態限制</strong>
                <p>此測試版未連接伺服器 API、資料庫或正式 AI Provider。</p>
              </article>
            </>
          ) : (
            <>
              <article>
                <strong>/api/review</strong>
                <p>完整圖進入全局審圖流程，產生問題、信心值與 clarity request。</p>
              </article>
              <article>
                <strong>/api/review/supplement</strong>
                <p>局部圖帶著原 issue context 回傳，避免失去整體配置關係。</p>
              </article>
              <article>
                <strong>Patch Same Issue</strong>
                <p>補圖結果回寫同一個 issue，保留完整的推理與修正歷程。</p>
              </article>
              <article>
                <strong>Provider Adapter</strong>
                <p>目前是 mock，下一步只需要接真正的 vision provider。</p>
              </article>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
