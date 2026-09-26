import type { DrawingReview, ReviewDimension, ReviewObservation } from "@/lib/review-schema";
import { getReviewScenario } from "@/lib/review-scenario";

export const reviewRubric = [
  { key: "brief", label: "題意與機能需求", maxScore: 20 },
  { key: "site", label: "基地紋理與建築計畫", maxScore: 20 },
  { key: "spatial", label: "空間層次與公共性", maxScore: 25 },
  { key: "circulation", label: "入口與動線", maxScore: 20 },
  { key: "representation", label: "圖面可讀性與論證", maxScore: 15 }
] as const;

export function calibrateReview(review: DrawingReview, brief: string, observation: ReviewObservation, questionConfidence?: number): DrawingReview {
  const notes: string[] = [];
  const dimensions: ReviewDimension[] = reviewRubric.map((rubric) => {
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
    if (raw.confidence < 0.5 || (raw.evidenceConfidence ?? raw.confidence) < 0.5) {
      score = Math.min(score, Math.floor(rubric.maxScore * 0.6));
      notes.push(`${rubric.label}證據信心偏低`);
    }
    if (rubric.key === "brief" && !brief.trim()) score = Math.min(score, 8);
    if (rubric.key === "site" && !observation.siteEvidence.length && !brief.trim()) score = Math.min(score, 8);
    return { ...rubric, score, confidence: raw.confidence, evidenceConfidence: raw.evidenceConfidence,
      rationale: raw.rationale, evidence: raw.evidence, sourceRefs: raw.sourceRefs };
  });
  let overallScore: number | null = dimensions.reduce((sum, item) => sum + item.score, 0);
  if (!brief.trim()) {
    overallScore = Math.min(overallScore, 69);
    notes.push("未提供完整題目條件，題意項上限 8 分、總分暫評上限 69");
  }
  if (questionConfidence !== undefined && questionConfidence < 0.6) {
    overallScore = Math.min(overallScore, 69);
    notes.push("題目 PDF 判讀信心偏低，總分暫評上限 69，請核對題目內容");
  }
  const uncertain = Object.values(observation.checks).filter((check) => check.status === "uncertain").length;
  if (uncertain >= 2) notes.push("多項重要圖面要素仍待辨識，請依待確認項目補局部圖");
  const highIssues = review.issues.filter((issue) => issue.kind === "issue" && issue.severity === "high" && issue.confidence >= 0.7).length;
  if (highIssues >= 2) {
    overallScore = Math.min(overallScore, 59);
    notes.push("至少兩項具高信心的重大問題，暫評上限 59");
  } else if (highIssues === 1) {
    overallScore = Math.min(overallScore, 69);
    notes.push("一項具高信心的重大問題，暫評上限 69");
  }
  const mediumIssues = review.issues.filter((issue) => issue.kind === "issue" && issue.severity === "medium" && issue.confidence >= 0.7).length;
  if (mediumIssues >= 3) {
    overallScore = Math.min(overallScore, 79);
    notes.push("至少三項具高信心的中度問題，暫評上限 79");
  }
  const requiredByScenario = {
    quick_study: ["brief", "site", "program", "concept", "spatial_sequence", "entrance", "circulation"],
    site_4h: ["brief", "site", "program", "indoor_outdoor", "circulation", "environment", "representation"],
    civil_6h: ["brief", "site", "program", "concept", "privacy", "circulation", "environment", "representation"],
    design_8h: ["brief", "site", "program", "concept", "indoor_outdoor", "openness", "privacy", "spatial_sequence",
      "entrance", "circulation", "accessibility", "operation", "environment", "sustainability", "structure", "representation"]
  } as const;
  const required = review.scenario ? new Set<string>(requiredByScenario[review.scenario]) : new Set<string>();
  const lackingEvidence = [...required].filter((key) =>
    !review.coverage?.some((item) => item.key === key && item.status !== "needs_evidence")).length;
  if (lackingEvidence >= 5) {
    overallScore = Math.min(overallScore, 69);
    notes.push(`${lackingEvidence} 項本情境核心主題仍缺圖面證據，總分暫評上限 69`);
  } else if (lackingEvidence >= 3) {
    overallScore = Math.min(overallScore, 79);
    notes.push(`${lackingEvidence} 項本情境核心主題仍缺圖面證據，總分暫評上限 79`);
  }
  const context = review.scenario ? `${getReviewScenario(review.scenario).label} · ${review.targetMinutes || getReviewScenario(review.scenario).minutes} 分鐘；` : "";
  return { ...review, dimensions, overallScore, scoreNote: `平台練習暫評，非官方成績。${context}${notes.join("；") || "依五項評分與圖面證據計算。"}` };
}
