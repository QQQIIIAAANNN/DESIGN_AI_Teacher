import type { DrawingReview, ReviewDimension, ReviewObservation } from "@/lib/review-schema";
import { getReviewScenario } from "@/lib/review-scenario";

export const reviewRubric = [
  { key: "brief", label: "題意與機能需求", maxScore: 20 },
  { key: "site", label: "基地紋理與建築計畫", maxScore: 20 },
  { key: "spatial", label: "空間層次與公共性", maxScore: 25 },
  { key: "circulation", label: "入口與動線", maxScore: 20 },
  { key: "representation", label: "圖面可讀性與論證", maxScore: 15 }
] as const;

const requiredByScenario = {
  quick_study: ["brief", "site", "program", "concept", "spatial_sequence", "entrance", "circulation"],
  site_4h: ["brief", "site", "program", "indoor_outdoor", "circulation", "environment", "representation"],
  civil_6h: ["brief", "site", "program", "concept", "privacy", "circulation", "environment", "representation"],
  design_8h: ["brief", "site", "program", "concept", "indoor_outdoor", "openness", "privacy", "spatial_sequence",
    "entrance", "circulation", "accessibility", "operation", "environment", "sustainability", "structure", "representation"]
} as const;

const dimensionTopics: Record<typeof reviewRubric[number]["key"], string[]> = {
  brief: ["brief", "program"],
  site: ["site", "environment"],
  spatial: ["indoor_outdoor", "openness", "privacy", "spatial_sequence"],
  circulation: ["entrance", "circulation", "accessibility"],
  representation: ["representation", "concept", "structure"]
};

export function calibrateReview(review: DrawingReview, brief: string, observation: ReviewObservation, questionConfidence?: number): DrawingReview {
  const notes: string[] = [];
  const required = review.scenario ? new Set<string>(requiredByScenario[review.scenario]) : new Set<string>();
  let dimensions: ReviewDimension[] = reviewRubric.map((rubric) => {
    const raw = review.dimensions.find((item) => item.key === rubric.key);
    if (!raw) {
      notes.push(`${rubric.label}未完成評分`);
      return { ...rubric, score: 0, confidence: 0, rationale: "缺少模型評估", evidence: "" };
    }
    let score = Math.max(0, Math.min(rubric.maxScore, Math.round(raw.score / raw.maxScore * rubric.maxScore)));
    if (!raw.evidence?.trim() || !raw.rationale?.trim() || !raw.sourceRefs?.length) {
      score = Math.min(score, Math.floor(rubric.maxScore * 0.5));
      notes.push(`${rubric.label}缺少可核對的理由、圖面證據或知識依據`);
    }
    const evidenceConfidence = Math.min(raw.confidence, raw.evidenceConfidence ?? raw.confidence);
    if (evidenceConfidence < 0.5) {
      score = Math.min(score, Math.floor(rubric.maxScore * 0.5));
      notes.push(`${rubric.label}證據信心偏低`);
    } else if (evidenceConfidence < 0.7) {
      score = Math.min(score, Math.floor(rubric.maxScore * 0.7));
      notes.push(`${rubric.label}證據信心未達高分門檻`);
    }
    const expectedTopics = dimensionTopics[rubric.key].filter((key) => required.has(key));
    const missingTopics = expectedTopics.filter((key) =>
      !review.coverage?.some((item) => item.key === key && item.status === "reviewed")).length;
    if (missingTopics) {
      score = Math.min(score, Math.floor(rubric.maxScore * (missingTopics >= 2 ? 0.6 : 0.75)));
      notes.push(`${rubric.label}有 ${missingTopics} 項核心主題缺少可核對的圖面證據`);
    }
    if (rubric.key === "brief" && !brief.trim()) score = Math.min(score, 8);
    if (rubric.key === "site" && !observation.siteEvidence.length && !brief.trim()) score = Math.min(score, 8);
    return { ...rubric, score, confidence: raw.confidence, evidenceConfidence: raw.evidenceConfidence,
      rationale: raw.rationale, evidence: raw.evidence, sourceRefs: raw.sourceRefs };
  });
  let scoreCap = 100;
  if (!brief.trim()) {
    scoreCap = Math.min(scoreCap, 59);
    notes.push("未提供完整題目條件，題意項上限 8 分、總分暫評上限 59");
  }
  if (questionConfidence !== undefined && questionConfidence < 0.6) {
    scoreCap = Math.min(scoreCap, 64);
    notes.push("題目 PDF 判讀信心偏低，總分暫評上限 64，請核對題目內容");
  }
  const uncertain = Object.values(observation.checks).filter((check) => check.status === "uncertain").length;
  if (uncertain >= 2) {
    scoreCap = Math.min(scoreCap, 79);
    notes.push("多項重要圖面要素仍待辨識，暫評上限 79，請依待確認項目補局部圖");
  }
  const supportedIssues = review.issues.filter((issue) => issue.kind === "issue" && !issue.locationUnresolved &&
    (issue.evidenceConfidence ?? issue.confidence) >= 0.7 && !!issue.evidence?.trim() &&
    !!issue.criterion?.trim() && !!issue.sourceRefs?.length);
  const highIssues = supportedIssues.filter((issue) => issue.severity === "high").length;
  if (highIssues >= 2) {
    scoreCap = Math.min(scoreCap, 49);
    notes.push("至少兩項有證據的重大問題，暫評上限 49");
  } else if (highIssues === 1) {
    scoreCap = Math.min(scoreCap, 59);
    notes.push("一項有證據的重大問題，暫評上限 59");
  }
  const mediumIssues = supportedIssues.filter((issue) => issue.severity === "medium").length;
  if (mediumIssues >= 3) {
    scoreCap = Math.min(scoreCap, 69);
    notes.push("至少三項有證據的中度問題，暫評上限 69");
  } else if (mediumIssues >= 2) {
    scoreCap = Math.min(scoreCap, 74);
    notes.push("至少兩項有證據的中度問題，暫評上限 74");
  }
  const lackingEvidence = [...required].filter((key) =>
    !review.coverage?.some((item) => item.key === key && item.status === "reviewed")).length;
  if (lackingEvidence >= 5) {
    scoreCap = Math.min(scoreCap, 59);
    notes.push(`${lackingEvidence} 項本情境核心主題仍缺圖面證據，總分暫評上限 59`);
  } else if (lackingEvidence >= 3) {
    scoreCap = Math.min(scoreCap, 69);
    notes.push(`${lackingEvidence} 項本情境核心主題仍缺圖面證據，總分暫評上限 69`);
  } else if (lackingEvidence > 0) {
    scoreCap = Math.min(scoreCap, 79);
    notes.push(`${lackingEvidence} 項本情境核心主題仍缺圖面證據，總分暫評上限 79`);
  }
  const supportedStrengths = review.issues.filter((issue) => issue.kind === "strength" &&
    !issue.locationUnresolved && (issue.evidenceConfidence ?? issue.confidence) >= 0.7 &&
    !!issue.evidence?.trim() && !!issue.criterion?.trim() && !!issue.sourceRefs?.length).length;
  if (supportedStrengths < 2) {
    scoreCap = Math.min(scoreCap, 79);
    notes.push("缺少至少兩項可核對的優點，高分尚無足夠正面證據，暫評上限 79");
  }
  const unresolvedLocations = review.issues.filter((issue) => issue.locationUnresolved).length;
  if (unresolvedLocations >= 3) {
    scoreCap = Math.min(scoreCap, 69);
    notes.push(`${unresolvedLocations} 項意見尚未能在原圖定位，暫評上限 69`);
  } else if (unresolvedLocations > 0) {
    scoreCap = Math.min(scoreCap, 84);
    notes.push(`${unresolvedLocations} 項意見尚未能在原圖定位，暫評上限 84`);
  }
  const rawTotal = dimensions.reduce((sum, item) => sum + item.score, 0);
  if (rawTotal > scoreCap) {
    const scaled = dimensions.map((item, index) => ({ index, exact: item.score * scoreCap / rawTotal,
      score: Math.floor(item.score * scoreCap / rawTotal) }));
    let remaining = scoreCap - scaled.reduce((sum, item) => sum + item.score, 0);
    for (const item of [...scaled].sort((a, b) => (b.exact - b.score) - (a.exact - a.score))) {
      if (remaining <= 0) break;
      item.score += 1;
      remaining -= 1;
    }
    dimensions = dimensions.map((item, index) => ({ ...item, score: scaled[index].score }));
    notes.push("暫評上限已按比例反映在五項分數");
  }
  const overallScore = dimensions.reduce((sum, item) => sum + item.score, 0);
  const context = review.scenario ? `${getReviewScenario(review.scenario).label} · ${review.targetMinutes || getReviewScenario(review.scenario).minutes} 分鐘；` : "";
  return { ...review, dimensions, overallScore, scoreNote: `平台練習暫評，非官方成績。${context}${notes.join("；") || "依五項評分與圖面證據計算。"}` };
}
