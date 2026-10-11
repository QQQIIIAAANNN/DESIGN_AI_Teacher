"use client";

import { useEffect, useMemo, useState } from "react";
import type { DrawingReview, NormalizedBBox, ReviewItem } from "@/lib/review-schema";
import { createRevisionBrief, rankVisualRevisionIssues, revisionSelectionReason, roiWithinCrop, validRevisionBbox, type RevisionBrief, type VisualRevisionSnapshot } from "@/lib/visual-revision";
import { compositeWithinRoi, cropPreview, prepareEditAssets, type EditFrame } from "@/lib/visual-revision-image";
import { useRoiDrag } from "./use-roi-drag";
import "./visual-revision.css";

type Props = {
  review: DrawingReview;
  imageUrl: string;
  enabled: boolean;
  staticDemo: boolean;
  authHeaders: () => Promise<HeadersInit | undefined>;
  onLocate: (issue: ReviewItem) => void;
};

type RevisionResult = {
  id: string;
  issueId: string;
  issueTitle: string;
  createdAt: string;
  before: string;
  after: string;
  model: string;
  bbox: NormalizedBBox;
  brief: RevisionBrief;
};

const initialBox: NormalizedBBox = { x: 0.35, y: 0.35, w: 0.25, h: 0.25 };
const sameBox = (a: NormalizedBBox, b: NormalizedBBox) =>
  a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

export default function VisualRevisionStudio({ review, imageUrl, enabled, staticDemo, authHeaders, onLocate }: Props) {
  const choices = useMemo(() => rankVisualRevisionIssues(review.issues), [review.issues]);
  const [issueId, setIssueId] = useState(() => choices[0]?.id || "");
  const issue = choices.find((candidate) => candidate.id === issueId) || choices[0];
  const [roi, setRoi] = useState<NormalizedBBox>(() =>
    issue && validRevisionBbox(issue.bbox) ? { ...issue.bbox } : { ...initialBox });
  const [version, setVersion] = useState(0);
  const [confirmed, setConfirmed] = useState<VisualRevisionSnapshot | null>(null);
  const [preview, setPreview] = useState("");
  const [locatorAspect, setLocatorAspect] = useState<number | null>(null);
  const [status, setStatus] = useState<"idle" | "generating" | "error">("idle");
  const [error, setError] = useState("");
  const [history, setHistory] = useState<RevisionResult[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState("");

  const frozen = status === "generating";
  const brief = issue ? createRevisionBrief(issue) : null;
  const cropRoi = roiWithinCrop(roi);
  const confirmedCurrent = Boolean(issue && confirmed && confirmed.issueId === issue.id &&
    confirmed.revision === version && sameBox(confirmed.bbox, roi));
  const chosenResult = history.find((entry) => entry.id === selectedHistoryId) || history[0];
  const drag = useRoiDrag({
    roi,
    disabled: frozen,
    onChange: setRoi,
    onCommit: () => {
      setVersion((n) => n + 1);
      setConfirmed(null);
      setStatus("idle");
      setError("");
    }
  });

  useEffect(() => {
    let mounted = true;
    if (!imageUrl || !issue) return;
    cropPreview(imageUrl, roi).then((dataUrl) => {
      if (mounted) setPreview(dataUrl);
    }).catch(() => { if (mounted) setPreview(""); });
    return () => { mounted = false; };
  }, [imageUrl, issue, roi]);

  function changeIssue(value: string) {
    const next = choices.find((candidate) => candidate.id === value);
    if (!next || !issue || next.id === issue.id || frozen) return;
    setIssueId(next.id);
    setRoi(validRevisionBbox(next.bbox) ? { ...next.bbox } : { ...initialBox });
    setVersion((n) => n + 1);
    setConfirmed(null);
    setStatus("idle");
    setError("");
  }

  function confirm() {
    if (!issue || !brief || !validRevisionBbox(roi) || frozen) return;
    setConfirmed({ issueId: issue.id, bbox: { ...roi }, revision: version,
      confirmedAt: new Date().toISOString(), brief });
    setError("");
  }

  async function generate() {
    if (!confirmedCurrent || !confirmed || !enabled || frozen || !issue) return;
    const snapshot = confirmed;
    const title = issue.title;
    setStatus("generating");
    setError("");
    try {
      const assets = await prepareEditAssets(imageUrl, snapshot.bbox);
      const form = new FormData();
      form.append("crop", assets.cropFile);
      form.append("context", assets.contextFile);
      form.append("snapshot", JSON.stringify(snapshot));
      const response = await fetch("/api/visual-revision", {
        method: "POST", body: form, headers: await authHeaders()
      });
      const payload = await response.json() as {
        error?: string; dataUrl?: string; model?: string; frame?: EditFrame;
      };
      if (!response.ok) throw new Error(payload.error || "生成圖片失敗。");
      if (!payload.dataUrl || !payload.frame) throw new Error("模型沒有回傳可安全合成的圖片。");
      const after = await compositeWithinRoi(assets.preview, payload.dataUrl, snapshot.bbox, payload.frame);
      const id = crypto.randomUUID();
      const entry: RevisionResult = {
        id, issueId: snapshot.issueId, issueTitle: title,
        createdAt: new Date().toISOString(), before: assets.preview, after,
        model: payload.model || "image-edit", bbox: { ...snapshot.bbox }, brief: snapshot.brief
      };
      setHistory((current) => [entry, ...current]);
      setSelectedHistoryId(id);
      setStatus("idle");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "生成圖片失敗。");
      setStatus("error");
    }
  }

  return <details className="issue-severity-group group-demo visual-revision" aria-label="AI 設計改善示範">
    <summary>
      <span><strong>AI 設計改善示範</strong><small>先確認修改位置，再生成 AI 視覺改善建議</small></span>
      <b>{choices.length} 項</b>
    </summary>
    {!issue || !brief ? <div className="vr-content">
      <p className="vr-message">目前沒有可可靠定位的高／中嚴重度設計問題可供示範，不會拿低嚴重度或純標註問題湊數。</p>
    </div> : <div className="vr-content">
    <label className="vr-selector">最嚴重的設計問題
      <select value={issue.id} onChange={(event) => changeIssue(event.target.value)} disabled={frozen}>
        {choices.map((candidate) => <option key={candidate.id} value={candidate.id}>
          {candidate.severity === "high" ? "【通關風險】" : "【核心問題】"}{candidate.title}
        </option>)}
      </select>
    </label>
    <p className="vr-problem">{brief.problem}</p>
    <p className="vr-selection-reason"><strong>入選理由：</strong>{revisionSelectionReason(issue)}</p>
    <div className="vr-preview-grid">
      <div>
        <strong>全圖定位與修改範圍</strong>
        <div className="vr-locator" style={locatorAspect ? { aspectRatio: locatorAspect } : undefined}>
          <img src={imageUrl} alt="完整建築圖面，供確認 AI 選取的位置"
            onLoad={(event) => {
              const image = event.currentTarget;
              if (image.naturalWidth > 0 && image.naturalHeight > 0) {
                setLocatorAspect(image.naturalWidth / image.naturalHeight);
              }
            }} />
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img"
            aria-label="可拖曳、調整右下角或重畫修改範圍的 ROI 框"
            onPointerDown={drag.onPointerDown} onPointerMove={drag.onPointerMove}
            onPointerUp={drag.onPointerUp} onPointerCancel={drag.onPointerCancel}
            style={{ touchAction: "none" }}>
            <rect x="0" y="0" width="100" height="100" fill="transparent" />
            <rect x={roi.x * 100} y={roi.y * 100} width={roi.w * 100} height={roi.h * 100}
              fill="#d66441" fillOpacity=".16" stroke="#d66441" strokeWidth=".7" strokeDasharray="1.7 1.1" />
            <circle cx={(roi.x + roi.w) * 100} cy={(roi.y + roi.h) * 100} r="1.5" fill="#d66441" stroke="white" strokeWidth=".5" />
          </svg>
        </div>
        <small>拖曳框內可移動，拉右下角可縮放，從框外拖曳可重畫。單純點擊不會取消確認。</small>
      </div>
      <div>
        <strong>局部裁切預覽</strong>
        <div className="vr-crop">{preview ? <div className="vr-crop-image">
          <img src={preview} alt="含周邊脈絡的局部裁切預覽，虛線框內才是實際修改範圍" />
          <div className="vr-crop-roi" aria-hidden="true" style={{
            left: `${cropRoi.x * 100}%`, top: `${cropRoi.y * 100}%`,
            width: `${cropRoi.w * 100}%`, height: `${cropRoi.h * 100}%`
          }} />
        </div> : <span>準備局部圖…</span>}</div>
        <small>虛線為修改範圍，外圈為 20% 周邊脈絡（貼圖邊緣時自動裁齊）。ROI 外會在前端合成時還原為原始像素。</small>
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
      <button type="button" className="practice-action" onClick={() => onLocate(issue)} disabled={frozen}>在審圖大圖定位</button>
      <button type="button" className="practice-action" onClick={confirm} disabled={frozen || !validRevisionBbox(roi)}>
        {confirmedCurrent ? "✓ 已確認修改位置" : "確認修改位置"}
      </button>
      <button type="button" className="focus-drawing-action" onClick={() => void generate()}
        disabled={!confirmedCurrent || !enabled || frozen}>
        {frozen ? "AI 正在生成示範…" : "生成 AI 改圖示範"}
      </button>
    </div>
    {!enabled && <p className="vr-message">{staticDemo ? "GitHub Pages 為靜態展示版，無法呼叫生圖 API；請在完整版本測試。" : "請先連接具圖片編修能力的 CLIProxyAPI 模型。"}</p>}
    {status === "error" && <p className="vr-error" role="alert">{error}</p>}
    {history.length > 0 && <div className="vr-teaching">
      <h4>Before / After｜設計改善教學卡</h4>
      <label className="vr-selector">歷史版本（本次審圖）
        <select value={chosenResult.id} onChange={(event) => setSelectedHistoryId(event.target.value)}>
          {history.map((entry, index) =>
            <option key={entry.id} value={entry.id}>#{history.length - index}｜{entry.issueTitle}｜{new Date(entry.createdAt).toLocaleTimeString("zh-TW")}</option>)}
        </select>
      </label>
      <div className="vr-preview-grid">
        <figure><img src={chosenResult.before} alt="原始裁切圖" /><figcaption>Before｜原始設計</figcaption></figure>
        <figure><img src={chosenResult.after} alt="僅修改 ROI 範圍的建築設計示意圖" />
          <figcaption>After｜AI 改圖示範（{chosenResult.model}）</figcaption></figure>
      </div>
      <p><b>Revision Brief：</b>{chosenResult.brief.designGoal}。{chosenResult.brief.modifications.join("；")}。</p>
      <p className="vr-message">此為概念性示意，尚未經 Vision Critic 驗證；ROI 以外為原始裁切像素，仍需人工核對尺寸與法規。</p>
    </div>}
    </div>}
  </details>;
}
