"use client";

import { ChangeEvent, useMemo, useState } from "react";
import type {
  DrawingReview,
  ReviewItem,
  ReviewSeverity,
  SupplementReviewResult
} from "@/lib/review-schema";

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

type SupplementState = {
  name: string;
  url: string;
  status: "reviewing" | "resolved" | "error";
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

  const issues = review?.issues ?? [];
  const activeIssue = useMemo<ReviewItem | undefined>(
    () => issues.find((issue) => issue.id === activeId),
    [activeId, issues]
  );

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
  }

  async function handleReview() {
    if (!drawingFile || isReviewing) return;

    setIsReviewing(true);
    setReviewError("");

    try {
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

      const nextReview = payload as DrawingReview;
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

      const result = payload as SupplementReviewResult;

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
        <div className="status-pill">MVP v0.3 · Review + Crop API</div>
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
            {(review?.dimensions ?? defaultDimensions.map((label) => ({ label }))).map((dimension) => {
              const hasScore = "score" in dimension;

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
                  <b>{hasScore ? `${dimension.score}/${dimension.maxScore}` : "--"}</b>
                </div>
              );
            })}
          </div>
        </div>
      </section>

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
          <h2>完整圖與局部補圖都已走 Review API</h2>
        </div>
        <div className="roadmap-grid">
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
        </div>
      </section>
    </main>
  );
}
