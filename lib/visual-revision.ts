import type { NormalizedBBox, ReviewItem } from "@/lib/review-schema";

export type RevisionBrief = {
  problem: string;
  designGoal: string;
  modifications: string[];
  preserveConstraints: string[];
  learningPoints: string[];
};

export type VisualRevisionSnapshot = {
  issueId: string;
  bbox: NormalizedBBox;
  revision: number;
  confirmedAt: string;
  brief: RevisionBrief;
};

const NON_VISUAL = /比例尺|圖名|圖號|指北針|標高標註|缺(?:少|漏)?(?:立面|剖面|平面|分析圖|圖紙)|未附(?:立面|剖面)|張數不足|缺圖|試題配分|計算書/i;
const PRESENTATION_ONLY = /註記|標註|辨讀|字跡|線條|圖面清晰度|版面|圖面不清|圖面品質/i;

export function validRevisionBbox(b: NormalizedBBox): boolean {
  return [b.x, b.y, b.w, b.h].every((n) => Number.isFinite(n)) &&
    b.x >= 0 && b.y >= 0 && b.w >= 0.012 && b.h >= 0.012 &&
    b.x + b.w <= 1.00001 && b.y + b.h <= 1.00001;
}

function confidence(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function impact(value: number | null): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.abs(value) : 0;
}

/** Severity is the primary key, never a small additive preference behind design keywords. */
export function rankVisualRevisionIssues(items: ReviewItem[]): ReviewItem[] {
  return items.filter((item) => {
    const shortText = [item.title, item.category].join(" ");
    return item.kind === "issue" && (item.severity === "high" || item.severity === "medium") &&
      item.visibilityStatus !== "illegible" && !item.locationUnresolved &&
      Boolean(item.suggestion.trim()) &&
      !NON_VISUAL.test(shortText) && !PRESENTATION_ONLY.test(shortText) &&
      validRevisionBbox(item.bbox);
  }).sort((a, b) =>
    Number(b.severity === "high") - Number(a.severity === "high") ||
    impact(b.scoreImpact) - impact(a.scoreImpact) ||
    confidence(b.evidenceConfidence ?? b.confidence) - confidence(a.evidenceConfidence ?? a.confidence) ||
    confidence(b.locationConfidence) - confidence(a.locationConfidence) ||
    a.id.localeCompare(b.id)
  ).slice(0, 3);
}

/** Short, factual explanation of why the selected problem is eligible and prioritized. */
export function revisionSelectionReason(item: ReviewItem): string {
  const label = item.severity === "high" ? "通關風險" : "核心問題";
  const score = impact(item.scoreImpact);
  return label + "優先；" +
    (score ? "關聯分數影響 " + score + " 分；" : "分數影響未量化；") +
    "證據信心 " + Math.round(confidence(item.evidenceConfidence ?? item.confidence) * 100) +
    "%、定位信心 " + Math.round(confidence(item.locationConfidence) * 100) + "%，且有可定位的設計修改建議。";
}

export function createRevisionBrief(issue: ReviewItem): RevisionBrief {
  const modifications = issue.suggestion.split(/[。；;\n]/).map((x) => x.trim()).filter(Boolean).slice(0, 4);
  return {
    problem: issue.description.trim().slice(0, 800),
    designGoal: issue.title.trim().slice(0, 160),
    modifications: modifications.length ? modifications : [issue.suggestion.trim().slice(0, 500)],
    preserveConstraints: [
      "維持原基地邊界、方位及未指定修改的建築空間。",
      "不任意改動既有結構、樓梯、必要出入口及無障礙通路。",
      "不得憑空補入尺寸、法規合格結論或未辨識的房間。"
    ],
    learningPoints: ["比較修改前後的空間組織及主要動線。", "檢查提案是否實際解決原本的設計問題。"]
  };
}

/** Normalized crop bounds with 20% context margin, shared by browser and server. */
export function cropBounds(box: NormalizedBBox) {
  if (!validRevisionBbox(box)) throw new Error("無效的 ROI 範圍。");
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  const padx = Math.max(0.015, box.w * 0.2);
  const pady = Math.max(0.015, box.h * 0.2);
  const x0 = clamp(box.x - padx);
  const y0 = clamp(box.y - pady);
  const x1 = clamp(box.x + box.w + padx);
  const y1 = clamp(box.y + box.h + pady);
  return { x0, y0, w: x1 - x0, h: y1 - y0 };
}

/** ROI coordinates normalized within the padded/clamped crop shown on the right. */
export function roiWithinCrop(box: NormalizedBBox): NormalizedBBox {
  const bounds = cropBounds(box);
  const unit = (value: number) => Math.max(0, Math.min(1, value));
  const x = unit((box.x - bounds.x0) / bounds.w);
  const y = unit((box.y - bounds.y0) / bounds.h);
  const right = unit((box.x + box.w - bounds.x0) / bounds.w);
  const bottom = unit((box.y + box.h - bounds.y0) / bounds.h);
  return { x, y, w: right - x, h: bottom - y };
}
