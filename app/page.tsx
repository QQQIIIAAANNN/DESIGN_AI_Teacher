"use client";

import { ChangeEvent, useMemo, useState } from "react";

type Severity = "高" | "中" | "低";

type ReviewItem = {
  id: number;
  title: string;
  category: string;
  severity: Severity;
  scoreImpact: number;
  description: string;
  suggestion: string;
  box: { x: number; y: number; w: number; h: number };
  redline?: {
    type: "line" | "rect" | "path";
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    d?: string;
  };
};

const mockIssues: ReviewItem[] = [
  {
    id: 1,
    title: "入口與主要廣場關係偏弱",
    category: "動線 / 戶外空間",
    severity: "高",
    scoreImpact: -4,
    description:
      "主要人行入口與前方開放空間沒有形成清楚的導引關係，評圖時容易被判讀為空間主次不明。",
    suggestion:
      "強化入口前緩衝廣場，讓鋪面、植栽與入口軸線形成同一套構圖，並避免車行動線切過主要步行路徑。",
    box: { x: 8, y: 12, w: 28, h: 26 },
    redline: { type: "line", x1: 10, y1: 42, x2: 42, y2: 24 },
  },
  {
    id: 2,
    title: "量體轉折造成轉角空間浪費",
    category: "空間配置",
    severity: "中",
    scoreImpact: -2,
    description:
      "建築轉角出現難以使用的剩餘空間，若沒有明確景觀或機能設定，會削弱平面完整性。",
    suggestion:
      "可將牆線外推並整合成完整矩形空間，或明確設定為採光庭、植栽庭，使其成為設計語彙而不是殘餘空間。",
    box: { x: 57, y: 31, w: 24, h: 22 },
    redline: { type: "rect", x: 55, y: 28, w: 29, h: 28 },
  },
  {
    id: 3,
    title: "景觀綠帶缺乏連續性",
    category: "景觀 / 永續",
    severity: "低",
    scoreImpact: -1,
    description:
      "植栽配置較零碎，沒有形成遮蔭、導引或基地邊界緩衝的連續系統。",
    suggestion:
      "將零散樹穴整理成一條連續綠帶，串接主要步行路徑與戶外停留空間。",
    box: { x: 16, y: 66, w: 40, h: 20 },
    redline: {
      type: "path",
      d: "M 14 80 C 28 66, 45 86, 62 70",
    },
  },
];

const dimensions = [
  ["配置與機能", 14, 20],
  ["動線與分流", 12, 20],
  ["戶外空間", 13, 20],
  ["法規與無障礙", 15, 20],
  ["設計概念與表達", 14, 20],
];

export default function Home() {
  const [imageUrl, setImageUrl] = useState<string>("");
  const [activeId, setActiveId] = useState<number>(1);
  const [reviewed, setReviewed] = useState(false);

  const total = useMemo(
    () => dimensions.reduce((sum, item) => sum + Number(item[1]), 0),
    []
  );

  function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImageUrl(URL.createObjectURL(file));
    setReviewed(false);
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
        <div className="status-pill">MVP · SVG Review</div>
      </header>

      <section className="hero-grid">
        <div className="upload-card">
          <div>
            <span className="step">01</span>
            <h2>上傳你的練習圖</h2>
            <p>
              第一版先支援 JPG / PNG。後續可擴充 PDF 題目、掃描圖校正與考題自動辨識。
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
              <div key={String(label)} className="dimension-row">
                <span>{label}</span>
                <div className="meter">
                  <i
                    style={{
                      width: reviewed
                        ? `${(Number(score) / Number(max)) * 100}%`
                        : "0%",
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
            </div>
          </div>

          <div className="drawing-stage">
            {imageUrl ? (
              <>
                <img src={imageUrl} alt="上傳的建築師考試作答圖" />
                {reviewed && (
                  <svg
                    className="overlay"
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                  >
                    {mockIssues.map((issue) => {
                      const active = issue.id === activeId;
                      const cls =
                        issue.severity === "高"
                          ? "svg-high"
                          : issue.severity === "中"
                          ? "svg-mid"
                          : "svg-low";

                      return (
                        <g
                          key={issue.id}
                          className={active ? "svg-active" : ""}
                          onClick={() => setActiveId(issue.id)}
                        >
                          <rect
                            x={issue.box.x}
                            y={issue.box.y}
                            width={issue.box.w}
                            height={issue.box.h}
                            rx="1"
                            className={`issue-box ${cls}`}
                          />
                          <circle
                            cx={issue.box.x + 2}
                            cy={issue.box.y + 2}
                            r="2.4"
                            className={`issue-pin ${cls}`}
                          />
                          <text
                            x={issue.box.x + 2}
                            y={issue.box.y + 2.8}
                            className="issue-number"
                          >
                            {issue.id}
                          </text>

                          {issue.redline?.type === "line" && (
                            <line
                              x1={issue.redline.x1}
                              y1={issue.redline.y1}
                              x2={issue.redline.x2}
                              y2={issue.redline.y2}
                              className="redline"
                            />
                          )}
                          {issue.redline?.type === "rect" && (
                            <rect
                              x={issue.redline.x}
                              y={issue.redline.y}
                              width={issue.redline.w}
                              height={issue.redline.h}
                              className="redline dashed"
                            />
                          )}
                          {issue.redline?.type === "path" && (
                            <path d={issue.redline.d} className="redline" />
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
                <span>上傳後即可疊加 AI 批註與紅線修改建議</span>
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
              mockIssues.map((issue) => (
                <button
                  key={issue.id}
                  className={`issue-card ${activeId === issue.id ? "active" : ""}`}
                  onClick={() => setActiveId(issue.id)}
                >
                  <div className="issue-top">
                    <span className={`severity severity-${issue.severity}`}>
                      {issue.severity}
                    </span>
                    <span className="category">{issue.category}</span>
                    <b>{issue.scoreImpact} 分</b>
                  </div>
                  <h3>{issue.id}. {issue.title}</h3>
                  <p>{issue.description}</p>
                  <div className="suggestion">
                    <strong>修改方向</strong>
                    <span>{issue.suggestion}</span>
                  </div>
                </button>
              ))
            ) : (
              <div className="panel-empty">
                上傳圖面並執行審圖後，這裡會依嚴重度列出問題、扣分風險與修改方向。
              </div>
            )}
          </div>
        </aside>
      </section>

      <section className="roadmap">
        <div>
          <span className="step">NEXT</span>
          <h2>這版之後真正要接上的能力</h2>
        </div>
        <div className="roadmap-grid">
          <article>
            <strong>Vision Review</strong>
            <p>用多模態模型拆解基地、量體、動線、空間與圖面表達。</p>
          </article>
          <article>
            <strong>Rubric + RAG</strong>
            <p>導師講義、歷屆高分圖、法規與你的批改經驗轉成審圖依據。</p>
          </article>
          <article>
            <strong>SVG Edit Engine</strong>
            <p>讓模型回傳標準化座標與圖形指令，而不是只吐一段玄學建議。</p>
          </article>
          <article>
            <strong>Progress Tracking</strong>
            <p>記錄每次常犯錯誤，找出「總是死在同一個地方」的模式。</p>
          </article>
        </div>
      </section>
    </main>
  );
}
