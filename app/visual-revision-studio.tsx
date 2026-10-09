"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import type { DrawingReview, NormalizedBBox, ReviewItem } from "@/lib/review-schema";
import { createRevisionBrief, rankVisualRevisionIssues, validRevisionBbox, type VisualRevisionSnapshot } from "@/lib/visual-revision";
import "./visual-revision.css";

type Props = {
  review: DrawingReview;
  imageUrl: string;
  enabled: boolean;
  staticDemo: boolean;
  authHeaders: () => Promise<HeadersInit | undefined>;
  onLocate: (issue: ReviewItem) => void;
};

type Drag = {
  mode: "draw" | "move" | "resize";
  startX: number;
  startY: number;
  origin: NormalizedBBox;
};

const clamp = (n: number, min = 0, max = 1) => Math.max(min, Math.min(max, n));
const initialBox: NormalizedBBox = { x: 0.35, y: 0.35, w: 0.25, h: 0.25 };

function copyBox(b?: NormalizedBBox): NormalizedBBox {
  if (b && validRevisionBbox(b)) return { ...b };
  return { ...initialBox };
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

function cropBounds(box: NormalizedBBox) {
  const padx = Math.max(0.015, box.w * 0.2);
  const pady = Math.max(0.015, box.h * 0.2);
  const x0 = clamp(box.x - padx);
  const y0 = clamp(box.y - pady);
  const x1 = clamp(box.x + box.w + padx);
  const y1 = clamp(box.y + box.h + pady);
  return { x0, y0, w: x1 - x0, h: y1 - y0 };
}

async function canvasFile(canvas: HTMLCanvasElement, name: string): Promise<File> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("無法輸出圖片。")), "image/png"));
  return new File([blob], name, { type: "image/png" });
}

function drawCrop(image: HTMLImageElement, box: NormalizedBBox, size = 1280) {
  const crop = cropBounds(box);
  const sx = crop.x0 * image.naturalWidth;
  const sy = crop.y0 * image.naturalHeight;
  const sw = crop.w * image.naturalWidth;
  const sh = crop.h * image.naturalHeight;
  const scale = Math.min(1, size / Math.max(sw, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("無法建立局部預覽。");
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return { canvas, crop };
}

async function prepareEditAssets(imageUrl: string, roi: NormalizedBBox) {
  const image = await loadImage(imageUrl);
  const { canvas, crop } = drawCrop(image, roi);
  const mask = document.createElement("canvas");
  mask.width = canvas.width;
  mask.height = canvas.height;
  const maskCtx = mask.getContext("2d");
  if (!maskCtx) throw new Error("無法建立修改遮罩。");
  maskCtx.fillStyle = "#000";
  maskCtx.fillRect(0, 0, mask.width, mask.height);
  const px = (roi.x - crop.x0) / crop.w * mask.width;
  const py = (roi.y - crop.y0) / crop.h * mask.height;
  const pw = roi.w / crop.w * mask.width;
  const ph = roi.h / crop.h * mask.height;
  maskCtx.clearRect(px, py, pw, ph);

  const context = document.createElement("canvas");
  const contextScale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
  context.width = Math.max(1, Math.round(image.naturalWidth * contextScale));
  context.height = Math.max(1, Math.round(image.naturalHeight * contextScale));
  const contextCtx = context.getContext("2d");
  if (!contextCtx) throw new Error("無法建立全圖定位圖。");
  contextCtx.drawImage(image, 0, 0, context.width, context.height);
  contextCtx.strokeStyle = "#d65b42";
  contextCtx.lineWidth = Math.max(3, Math.min(context.width, context.height) / 200);
  contextCtx.setLineDash([12, 7]);
  contextCtx.strokeRect(roi.x * context.width, roi.y * context.height, roi.w * context.width, roi.h * context.height);
  const [cropFile, maskFile, contextFile] = await Promise.all([
    canvasFile(canvas, "revision-crop.png"),
    canvasFile(mask, "revision-mask.png"),
    canvasFile(context, "revision-context.png")
  ]);
  return { cropFile, maskFile, contextFile, preview: canvas.toDataURL("image/png") };
}

export default function VisualRevisionStudio({ review, imageUrl, enabled, staticDemo, authHeaders, onLocate }: Props) {
  const choices = useMemo(() => rankVisualRevisionIssues(review.issues), [review.issues]);
  const [issueId, setIssueId] = useState(() => choices[0]?.id || "");
  const issue = choices.find((candidate) => candidate.id === issueId) || choices[0];
  const [roi, setRoi] = useState<NormalizedBBox>(() => copyBox(issue?.bbox));
  const [version, setVersion] = useState(0);
  const [confirmed, setConfirmed] = useState<VisualRevisionSnapshot | null>(null);
  const [preview, setPreview] = useState("");
  const [status, setStatus] = useState<"idle" | "generating" | "complete" | "error">("idle");
  const [result, setResult] = useState<{ url: string; model: string } | null>(null);
  const [error, setError] = useState("");
  const drag = useRef<Drag | null>(null);

  useEffect(() => {
    let mounted = true;
    if (!imageUrl || !issue) return;
    loadImage(imageUrl).then((image) => {
      const next = drawCrop(image, roi, 1000).canvas.toDataURL("image/png");
      if (mounted) setPreview(next);
    }).catch(() => { if (mounted) setPreview(""); });
    return () => { mounted = false; };
  }, [imageUrl, issue, roi]);

  if (!issue) return <section className="visual-revision visual-revision-empty">
    <h3>AI 改圖教學</h3>
    <p>這次沒有可可靠定位、且適合視覺化改善的設計問題。缺圖、比例尺及純標註問題不會強行觸發生圖。</p>
  </section>;

  const brief = createRevisionBrief(issue);
  const frozen = status === "generating";
  const confirmedCurrent = Boolean(confirmed && confirmed.issueId === issue.id && confirmed.revision === version &&
    JSON.stringify(confirmed.bbox) === JSON.stringify(roi));

  function invalidate() {
    setConfirmed(null);
    setResult(null);
    setStatus("idle");
    setError("");
  }

  function changeIssue(value: string) {
    const next = choices.find((candidate) => candidate.id === value);
    if (!next || frozen) return;
    setIssueId(next.id);
    setRoi(copyBox(next.bbox));
    setVersion((n) => n + 1);
    invalidate();
  }

  function point(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / Math.max(1, rect.width)),
      y: clamp((event.clientY - rect.top) / Math.max(1, rect.height))
    };
  }

  function pointerDown(event: PointerEvent<SVGSVGElement>) {
    if (frozen) return;
    event.preventDefault();
    const p = point(event);
    const nearCorner = Math.abs(p.x - roi.x - roi.w) < 0.035 && Math.abs(p.y - roi.y - roi.h) < 0.035;
    const inside = p.x >= roi.x && p.x <= roi.x + roi.w && p.y >= roi.y && p.y <= roi.y + roi.h;
    drag.current = { mode: nearCorner ? "resize" : inside ? "move" : "draw",
      startX: p.x, startY: p.y, origin: { ...roi } };
    event.currentTarget.setPointerCapture(event.pointerId);
    invalidate();
  }

  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    const active = drag.current;
    if (!active || frozen) return;
    const p = point(event);
    if (active.mode === "move") {
      const next = { ...active.origin,
        x: clamp(active.origin.x + p.x - active.startX, 0, 1 - active.origin.w),
        y: clamp(active.origin.y + p.y - active.startY, 0, 1 - active.origin.h) };
      setRoi(next);
    } else if (active.mode === "resize") {
      setRoi({ ...active.origin,
        w: clamp(p.x - active.origin.x, 0.02, 1 - active.origin.x),
        h: clamp(p.y - active.origin.y, 0.02, 1 - active.origin.y) });
    } else {
      const x = Math.min(active.startX, p.x);
      const y = Math.min(active.startY, p.y);
      setRoi({ x: clamp(x, 0, 0.98), y: clamp(y, 0, 0.98),
        w: clamp(Math.abs(p.x - active.startX), 0.02, 1 - x),
        h: clamp(Math.abs(p.y - active.startY), 0.02, 1 - y) });
    }
  }

  function pointerUp(event: PointerEvent<SVGSVGElement>) {
    if (!drag.current) return;
    drag.current = null;
    setVersion((n) => n + 1);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function confirm() {
    if (!validRevisionBbox(roi) || frozen) return;
    setConfirmed({ issueId: issue.id, bbox: { ...roi }, revision: version,
      confirmedAt: new Date().toISOString(), brief });
    setError("");
  }

  async function generate() {
    if (!confirmedCurrent || !confirmed || !enabled || frozen) return;
    setStatus("generating");
    setError("");
    try {
      const assets = await prepareEditAssets(imageUrl, confirmed.bbox);
      const form = new FormData();
      form.append("crop", assets.cropFile);
      form.append("mask", assets.maskFile);
      form.append("context", assets.contextFile);
      form.append("snapshot", JSON.stringify(confirmed));
      const response = await fetch("/api/visual-revision", {
        method: "POST", body: form, headers: await authHeaders()
      });
      const payload = await response.json() as { error?: string; dataUrl?: string; remoteUrl?: string; model?: string };
      if (!response.ok) throw new Error(payload.error || "生成圖片失敗。");
      const url = payload.dataUrl || payload.remoteUrl;
      if (!url) throw new Error("模型沒有回傳圖片。");
      setResult({ url, model: payload.model || "image-edit" });
      setStatus("complete");
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成圖片失敗。");
      setStatus("error");
    }
  }

  return <section className="visual-revision" aria-label="設計改善示範">
    <div className="vr-title">
      <div><p className="vr-eyebrow">DESIGN IMPROVEMENT</p><h3>AI 設計改善示範</h3></div>
      <span>先確認位置，再生成</span>
    </div>
    <label className="vr-selector">最值得示範的設計問題
      <select value={issue.id} onChange={(event) => changeIssue(event.target.value)} disabled={frozen}>
        {choices.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.title}</option>)}
      </select>
    </label>
    <p className="vr-problem">{brief.problem}</p>
    <div className="vr-preview-grid">
      <div>
        <strong>全圖定位與修改範圍</strong>
        <div className="vr-locator">
          <img src={imageUrl} alt="完整建築圖面，供確認 AI 選取的位置" />
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img"
            aria-label="可拖曳、調整右下角或重畫修改範圍的 ROI 框"
            onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}
            onPointerCancel={pointerUp} style={{ touchAction: "none" }}>
            <rect x="0" y="0" width="100" height="100" fill="transparent" />
            <rect x={roi.x * 100} y={roi.y * 100} width={roi.w * 100} height={roi.h * 100}
              fill="#d66441" fillOpacity=".16" stroke="#d66441" strokeWidth=".7" strokeDasharray="1.7 1.1" />
            <circle cx={(roi.x + roi.w) * 100} cy={(roi.y + roi.h) * 100} r="1.5" fill="#d66441" stroke="white" strokeWidth=".5" />
          </svg>
        </div>
        <small>拖曳框內可移動，拉右下角可縮放，從框外拖曳可重畫。</small>
      </div>
      <div>
        <strong>局部裁切預覽</strong>
        <div className="vr-crop">{preview ? <img src={preview} alt="目前 ROI 的局部裁切預覽" /> : <span>準備局部圖…</span>}</div>
        <small>裁切保留周邊脈絡；透明遮罩僅開放所選 ROI 編修。</small>
      </div>
    </div>
    <div className="vr-brief">
      <h4>Revision Brief｜修改策略</h4>
      <p><b>目標：</b>{brief.designGoal}</p>
      <ul>{brief.modifications.map((item, index) => <li key={index}>{item}</li>)}</ul>
      <details><summary>編修時必須保留的條件</summary>
        <ul>{brief.preserveConstraints.map((item, index) => <li key={index}>{item}</li>)}</ul>
      </details>
    </div>
    <div className="vr-actions">
      <button type="button" onClick={() => onLocate(issue)} disabled={frozen}>在審圖大圖定位</button>
      <button type="button" onClick={confirm} disabled={frozen || !validRevisionBbox(roi)}>
        {confirmedCurrent ? "✓ 已確認修改位置" : "確認修改位置"}
      </button>
      <button type="button" className="vr-primary" onClick={() => void generate()}
        disabled={!confirmedCurrent || !enabled || frozen}>
        {frozen ? "AI 正在生成示範…" : result ? "重新生成修改示範" : "生成 AI 改圖示範"}
      </button>
    </div>
    {!enabled && <p className="vr-message">{staticDemo ? "GitHub Pages 是靜態展示版，無法直接呼叫生圖 API；請在本機完整版本測試。" : "請先連接具圖片編修能力的 CLIProxyAPI 模型。"}</p>}
    {status === "error" && <p className="vr-error" role="alert">{error}</p>}
    {result && <div className="vr-teaching">
      <h4>Before / After｜設計改善教學卡</h4>
      <div className="vr-preview-grid">
        <figure><img src={preview} alt="AI 修改前的原始局部圖" /><figcaption>Before｜原始設計</figcaption></figure>
        <figure><img src={result.url} alt="AI 圖片編修後的設計示意圖" /><figcaption>After｜AI 改圖示範（{result.model}）</figcaption></figure>
      </div>
      <p><b>設計理由：</b>{brief.problem} 修改方向為：{brief.modifications.join("；")}。</p>
      <p className="vr-message">此為概念性示意，尚未經 Vision Critic 驗證，請自行核對結構、尺寸、動線及法規。</p>
    </div>}
  </section>;
}
