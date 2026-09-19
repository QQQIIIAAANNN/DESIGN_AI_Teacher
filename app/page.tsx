"use client";

import { ChangeEvent, useMemo, useState } from "react";
import type { ReviewItem, ReviewSeverity } from "@/lib/review-schema";

const mockIssues: ReviewItem[] = [
  {
    id: "issue-001",
    kind: "issue",
    title: "入口與主要廣場關係偏弱",
    category: "動線 / 戶外空間",
    severity: "high",
    scoreImpact: -4,
    confidence: 0.91,
    visibilityStatus: "clear",
    description:
      "主要人行入口與前方開放空間沒有形成清楚的導引關係，評圖時容易被判讀為空間主次不明。",
    suggestion:
      "強化入口前緩衝廣場，讓鋪面、植栽與入口軸線形成同一套構圖，並避免車行動線切過主要步行路徑。",
    bbox: { x: 0.08, y: 0.12, w: 0.28, h: 0.26 },
    redline: {
      type: "line",
      x1: 0.1,
      y1: 0.42,
      x2: 0.42,
      y2: 0.24
    }
  },
  {
    id: "issue-002",
    kind: "issue",
    title: "量體轉折造成轉角空間浪費",
    category: "空間配置",
    severity: "medium",
    scoreImpact: -2,
    confidence: 0.84,
    visibilityStatus: "clear",
    description:
      "建築轉角出現難以使用的剩餘空間，若沒有明確景觀或機能設定，會削弱平面完整性。",
    suggestion:
      "可將牆線外推並整合成完整矩形空間，或明確設定為採光庭、植栽庭，使其成為設計語彙而不是殘餘空間。",
    bbox: { x: 0.57, y: 0.31, w: 0.24, h: 0.22 },
    redline: {
      type: "rect",
      x: 0.55,
      y: 0.28,
      w: 0.29,
      h: 0.28
    }
  },
  {
    id: "issue-003",
    kind: "issue",
    title: "景觀綠帶缺乏連續性",
    category: "景觀 / 永續",
    severity: "low",
    scoreImpact: -1,
    confidence: 0.79,
    visibilityStatus: "clear",
    description:
      "植栽配置較零碎，沒有形成遮蔭、導引或基地邊界緩衝的連續系統。",
    suggestion:
      "將零散樹穴整理成一條連續綠帶，串接主要步行路徑與戶外停留空間。",
    bbox: { x: 0.16, y: 0.66, w: 0.4, h: 0.2 },
    redline: {
      type: "polyline",
      points: [
        [0.14, 0.8],
        [0.28, 0.69],
        [0.45, 0.82],
        [0.62, 0.7]
      ]
    }
  },
  {
    id: "clarity-001",
    kind: "clarity_request",
    title: "樓梯與鄰接空間需要局部補圖",
    category: "圖面清晰度",
    severity: "info",
    scoreImpact: null,
    confidence: 0.34,
    visibilityStatus: "illegible",
    description:
      "此區線條與標註在整張圖縮放後不足以可靠判讀。系統可以辨識出疑似樓梯與走道交界，但不應直接猜測尺寸、梯向或門扇關係。",
    suggestion:
      "請補上此區的高解析局部圖，再針對樓梯動線、淨寬、出入口與無障礙關係進行局部精審。",
    bbox: { x: 0.72, y: 0.57, w: 0.18, h: 0.16 },
    cropRequest: {
      reason: "局部解析度不足，牆線、樓梯線與尺寸文字互相黏連。",
      instructions: [
        "保留框選區域四周約 10%～20% 的上下文，不要只裁一個小方塊。",
        "讓牆線、門線、樓梯方向與尺寸文字可辨識。",
        "若原圖本身失焦，請重新近拍該區，而不是單純數位放大。"
      ],
      reviewTargets: ["樓梯方向", "走道與門扇關係", "淨寬", "無障礙連續性"]
    }
  }
];

const dimensions = [
  ["配置與機能", 14, 20],
  ["動線與分流", 12, 20],
  ["戶外空間", 13, 20],
  ["法規與無障礙", 15, 20],
  ["設計概念與表達", 14, 20]
] as const;

const severityLabels: Record<ReviewSeverity, string> = {
  high: "高",
  medium: "中",
  low: "低",
  info: "需補圖"
};

function svgValue(value: number) {
  return value * 100;
}

export default function Home() {
  const [imageUrl, setImageUrl] = useState("");
  const [activeId, setActiveId] = useState(mockIssues[0].id);
  const [reviewed, setReviewed] = useState(false);
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [supplements, setSupplements] = useState<Record<string, { name: string; url: string }>>({});

  const total = useMemo(
    () => dimensions.reduce((sum, item) => sum + Number(item[1]), 0),
    []
  );

  function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setImageUrl(URL.createObjectURL(file));
    setImageSize(null);
    setReviewed(false);
    setSupplements({});
  }

  function handleSupplementUpload(issueId: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setSupplements((current) => ({
      ...current,
      [issueId]: {
        name: file.name,
        url: URL.createObjectURL(file)
      }
    }));
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
        <div className="status-pill">MVP v0.2 · SVG + 補圖精審</div>
      </header>

      <section className="hero-grid">
        <div className="upload-card">
          <div>
            <span className="step">01</span>
            <h2>上傳你的練習圖</h2>
            <p>
              先用完整圖判讀整體，再由系統主動找出需要高解析局部圖的區域。
            </p>
          </div>

          <label className="dropzone">
            <input type="file" accept="image/*" onChange={handleUpload} />
            <strong>{imageUrl ? "更換圖面" : "選擇作答圖"}</strong>
            <span>建議使用完整掃描或正拍、避免裁切題目邊界</span>
          </label>

          <button
            className="primary-btn"
            disabled={!imageUrl}
            onClick={() => setReviewed(true)}
          >
            開始 AI 審圖
          </button>
        </div>

        <div className="score-card">
          <span className="step">02</span>
          <h2>結構化評分</h2>
          <div className="score-big">
            <strong>{reviewed ? total : "--"}</strong>
            <span>/ 100</span>
          </div>
          <div className="dimension-list">
            {dimensions.map(([label, score, max]) => (
              <div key={label} className="dimension-row">
                <span>{label}</span>
                <div className="meter">
                  <i
                    style={{
                      width: reviewed ? `${(Number(score) / Number(max)) * 100}%` : "0%"
                    }}
                  />
                </div>
                <b>{reviewed ? `${score}/${max}` : "--"}</b>
              </div>
            ))}
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
                {reviewed && (
                  <svg className="overlay" viewBox="0 0 100 100" preserveAspectRatio="none">
                    {mockIssues.map((issue, index) => {
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
        </div>

        <aside className="review-panel">
          <div className="section-head">
            <div>
              <span className="step">04</span>
              <h2>審圖意見</h2>
            </div>
            <span className="issue-count">
              {reviewed ? `${mockIssues.length} 項` : "尚未分析"}
            </span>
          </div>

          <div className="issue-list">
            {reviewed ? (
              mockIssues.map((issue, index) => {
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
                        {issue.scoreImpact === null ? `${Math.round(issue.confidence * 100)}% 信心` : `${issue.scoreImpact} 分`}
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

                        <label className="crop-upload" onClick={(event) => event.stopPropagation()}>
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(event) => handleSupplementUpload(issue.id, event)}
                          />
                          <strong>{supplement ? "更換局部圖" : "補上局部高解析圖"}</strong>
                          <span>{supplement ? supplement.name : "重新近拍或上傳裁切圖"}</span>
                        </label>

                        {supplement && (
                          <div className="supplement-preview">
                            <img src={supplement.url} alt="使用者補上的局部圖" />
                            <div>
                              <strong>局部圖已補上</strong>
                              <span>下一步會只針對此區重跑精審，並回寫原始框選位置。</span>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="suggestion">
                        <strong>修改方向</strong>
                        <span>{issue.suggestion}</span>
                      </div>
                    )}
                  </article>
                );
              })
            ) : (
              <div className="panel-empty">
                上傳圖面並執行審圖後，這裡會依嚴重度列出問題、扣分風險、修改方向，以及需要補拍的局部區域。
              </div>
            )}
          </div>
        </aside>
      </section>

      <section className="roadmap">
        <div>
          <span className="step">NEXT</span>
          <h2>從一次性審圖，變成會追問的數位審圖老師</h2>
        </div>
        <div className="roadmap-grid">
          <article>
            <strong>Vision Review</strong>
            <p>先做完整圖的整體判讀，再標記可能需要局部精審的位置。</p>
          </article>
          <article>
            <strong>Clarity Gate</strong>
            <p>模型看不清楚時必須停止硬猜，輸出補圖範圍、原因與審查目標。</p>
          </article>
          <article>
            <strong>Crop Re-review</strong>
            <p>局部圖補上後沿用原始圖 context，只重跑該區並回寫同一個 issue。</p>
          </article>
          <article>
            <strong>Rubric + RAG</strong>
            <p>將導師講義、歷屆案例與法規作為可追溯的審圖依據。</p>
          </article>
        </div>
      </section>
    </main>
  );
}
