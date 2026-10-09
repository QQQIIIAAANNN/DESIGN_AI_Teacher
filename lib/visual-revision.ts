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

const DESIGN = /配置|空間|動線|分流|入口|廣場|戶外|中庭|景觀|植栽|綠帶|街廓|廊道|梯廳|開口|門窗|牆|鋪面|退縮|停留|採光|通風|使用關係|量體|人車/i;
const NON_VISUAL = /比例尺|圖名|圖號|指北針|標高標註|文字註記|缺(?:少|漏)(?:立面|剖面|平面|分析圖|圖紙)|未附(?:立面|剖面)|張數不足|缺圖|試題配分|計算書/i;

export function validRevisionBbox(b: NormalizedBBox): boolean {
  return [b.x, b.y, b.w, b.h].every((n) => Number.isFinite(n)) &&
    b.x >= 0 && b.y >= 0 && b.w >= 0.012 && b.h >= 0.012 &&
    b.x + b.w <= 1.00001 && b.y + b.h <= 1.00001;
}

export function rankVisualRevisionIssues(items: ReviewItem[]): ReviewItem[] {
  return items.filter((item) => {
    const text = [item.title, item.category, item.description, item.suggestion].join(" ");
    return item.kind === "issue" && item.visibilityStatus !== "illegible" &&
      Boolean(item.suggestion.trim()) && DESIGN.test(text) &&
      !NON_VISUAL.test([item.title, item.category].join(" ")) &&
      validRevisionBbox(item.bbox);
  }).sort((a, b) => priority(b) - priority(a)).slice(0, 3);
}

function priority(item: ReviewItem): number {
  const title = item.title + " " + item.category;
  const core = /配置|動線|室內外|入口|廣場|公共空間|人車分流|空間/.test(title) ? 40 : 0;
  const severity = { high: 25, medium: 16, low: 4, info: 0 }[item.severity];
  const confidence = 12 * Math.max(0, Math.min(1, item.evidenceConfidence ?? item.confidence));
  const location = item.locationUnresolved ? -22 : 8 * Math.max(0, Math.min(1, item.locationConfidence ?? 0.5));
  return core + severity + confidence + location;
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
