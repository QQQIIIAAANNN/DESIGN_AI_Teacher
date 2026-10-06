import type { PracticeQuestion } from "@/lib/practice-question";
import type { QuestionContext } from "@/lib/question-context";
import type {
  DrawingReview,
  ReviewAssessment,
  ReviewDimension,
  ReviewObservation,
  ReviewRubricSource,
  ReviewScoringMode
} from "@/lib/review-schema";
import { getReviewScenario } from "@/lib/review-scenario";

export type ResolvedReviewRubricItem = {
  key: string;
  section: string;
  label: string;
  criterion: string;
  maxScore: number | null;
  source: ReviewRubricSource;
};

export type ResolvedReviewRubric = {
  items: ResolvedReviewRubricItem[];
  mode: ReviewScoringMode;
  totalMaxScore: number | null;
  sourceLabel: string;
};

const platformFallbackItems: ResolvedReviewRubricItem[] = [
  { key: "site", section: "平台備用準則", label: "量體、配置、基地與街廓", criterion: "第一眼可理解建築量體與基地配置；室內外、道路、人行道、鄰地與街廓關係合理，沒有明顯不可行的總體配置。", maxScore: 30, source: "platform_reference" },
  { key: "circulation", section: "平台備用準則", label: "入口、人車與服務動線", criterion: "主要入口、步行、車道、停車／服務與無障礙主要路徑可理解，交會與轉折不造成明顯通關風險。", maxScore: 20, source: "platform_reference" },
  { key: "brief", section: "平台備用準則", label: "題意與建築計畫", criterion: "題目核心議題、機能需求、空間數量與使用者情境均有回應，且建築計畫具可行性。", maxScore: 20, source: "platform_reference" },
  { key: "spatial", section: "平台備用準則", label: "剖面、空間與環境品質", criterion: "室內外層次、剖面空間、公共性、空間序列與永續／氣候策略彼此整合，形成可使用且有意境的空間。", maxScore: 20, source: "platform_reference" },
  { key: "representation", section: "平台備用準則", label: "圖面可讀性與設計論證", criterion: "圖面足以讓評審快速理解方案；可由配置、平面、剖面、透視或立面等互補表達設計，不把比例或單一圖種本身當成主要評價。", maxScore: 10, source: "platform_reference" }
];

function uniqueKeys(items: ResolvedReviewRubricItem[]) {
  const used = new Set<string>();
  return items.map((item, index) => {
    let key = item.key || `rubric-${index + 1}`;
    while (used.has(key)) key = `${item.key || "rubric"}-${index + 1}`;
    used.add(key);
    return { ...item, key };
  });
}

export function resolveReviewRubric(questionContext?: QuestionContext | null, practiceQuestion?: PracticeQuestion | null): ResolvedReviewRubric {
  if (questionContext?.scoringItems?.length) {
    const items = uniqueKeys(questionContext.scoringItems.map((item) => ({
      key: item.key,
      section: item.section || "題目評分項目",
      label: item.label,
      criterion: item.criteria.length ? item.criteria.join("；") : item.sourceText,
      maxScore: item.maxScore,
      source: "question_explicit" as const
    })));
    const hasCompleteQuestionRubric = questionContext.confidence >= 0.6 && items.length > 0 && items.every((item) => {
      const source = questionContext.scoringItems.find((candidate) => candidate.key === item.key);
      const hasStandard = Boolean(source?.criteria.some((criterion) => criterion.trim()) ||
        source?.sourceText.trim() && source.sourceText.trim().length >= item.label.trim().length + 8);
      return item.maxScore !== null && item.maxScore > 0 && hasStandard &&
        (source?.confidence ?? 0) >= 0.55;
    });
    if (hasCompleteQuestionRubric) return { items, mode: "question_points",
      totalMaxScore: items.reduce((sum, item) => sum + (item.maxScore || 0), 0),
      sourceLabel: "題目明示的給分項目" };
  }
  const fallbackReason = questionContext?.scoringItems?.length
    ? "題目給分項、標準或配分上限未能完整抽取，已改用平台備用評分準則"
      : questionContext ? "題目 PDF 未能提供完整的動態給分項，已改用平台備用評分準則"
        : practiceQuestion ? "模擬題未設定配分，已改用平台備用評分準則"
        : "未提供可用的題目給分項，已改用平台備用評分準則";
  return { items: platformFallbackItems.map((item) => ({ ...item })), mode: "platform_fallback",
    totalMaxScore: 100, sourceLabel: fallbackReason };
}

function assessmentFromRatio(score: number, maxScore: number): ReviewAssessment {
  const ratio = maxScore > 0 ? score / maxScore : 0;
  if (ratio >= 0.85) return "excellent";
  if (ratio >= 0.7) return "good";
  if (ratio >= 0.5) return "partial";
  return "insufficient";
}

function validAssessment(value: ReviewAssessment | undefined): ReviewAssessment | undefined {
  return value === "excellent" || value === "good" || value === "partial" ||
    value === "insufficient" || value === "unverified" ? value : undefined;
}

export function calibrateReview(review: DrawingReview, _brief: string, observation: ReviewObservation,
  questionConfidence?: number): DrawingReview {
  const rubric = resolveReviewRubric(review.questionContext, review.practiceQuestion);
  const validKeys = new Set(rubric.items.map((item) => item.key));
  const issueIds = new Set(review.issues.map((issue) => issue.id));
  const issues = review.issues.map((issue) => ({ ...issue,
    rubricRefs: (issue.rubricRefs || []).filter((key) => validKeys.has(key)).slice(0, 8) }));

  const dimensions: ReviewDimension[] = rubric.items.map((item) => {
    const raw = review.dimensions.find((dimension) => dimension.key === item.key) ||
      review.dimensions.find((dimension) => dimension.label.trim() === item.label.trim());
    const supported = Boolean(raw?.rationale?.trim() && raw?.evidence?.trim());
    const score = supported && item.maxScore !== null && typeof raw?.score === "number" && Number.isFinite(raw.score)
      ? Math.max(0, Math.min(item.maxScore, raw.score)) : null;
    const linkedFromScore = (raw?.relatedIssueIds || []).filter((id) => issueIds.has(id));
    const linkedFromFindings = issues.filter((issue) => issue.rubricRefs?.includes(item.key)).map((issue) => issue.id);
    const relatedIssueIds = [...new Set([...linkedFromScore, ...linkedFromFindings])].slice(0, 20);
    const evidenceConfidence = Math.min(raw?.confidence ?? 0.4, raw?.evidenceConfidence ?? raw?.confidence ?? 0.4);
    const assessment = !supported ? "unverified" : validAssessment(raw?.assessment) ||
      (score !== null && item.maxScore !== null ? assessmentFromRatio(score, item.maxScore)
        : evidenceConfidence < 0.45 ? "unverified" : "partial");
    return {
      key: item.key,
      section: item.section,
      label: item.label,
      criterion: item.criterion,
      score,
      maxScore: item.maxScore,
      assessment,
      rubricSource: item.source,
      relatedIssueIds,
      confidence: raw?.confidence ?? 0.4,
      evidenceConfidence: raw?.evidenceConfidence ?? raw?.confidence ?? 0.4,
      rationale: raw?.rationale || "尚未取得足夠的分項判讀理由。",
      evidence: raw?.evidence || "",
      sourceRefs: raw?.sourceRefs || []
    };
  });

  const fullyScored = (rubric.mode === "question_points" || rubric.mode === "platform_fallback") && dimensions.length > 0 &&
    dimensions.every((item) => item.score !== null && item.maxScore !== null);
  const overallScore = fullyScored
    ? dimensions.reduce((sum, item) => sum + (item.score || 0), 0) : null;
  const overallMaxScore = fullyScored
    ? dimensions.reduce((sum, item) => sum + (item.maxScore || 0), 0) : rubric.totalMaxScore;
  const linkedIssues = issues.map((issue) => ({ ...issue,
    rubricRefs: [...new Set([...(issue.rubricRefs || []), ...dimensions
      .filter((dimension) => dimension.relatedIssueIds?.includes(issue.id)).map((dimension) => dimension.key)])].slice(0, 8) }));
  const linkedCount = linkedIssues.filter((issue) => issue.rubricRefs?.length).length;
  const notes = [rubric.sourceLabel];
  if (rubric.mode === "question_points") notes.push(fullyScored
    ? `總分由 ${dimensions.length} 個題目配分直接加總，未從意見卡倒扣`
    : "部分給分項證據不足，暫不加總總分");
  if (rubric.mode === "platform_fallback") notes.push(fullyScored
    ? "依平台自訂考場式備用準則直接加總（30／20／20／20／10 分），優先反映量體配置與動線；非題目官方配分"
    : "平台備用準則有分項證據不足，暫不加總總分");
  if (rubric.mode === "question_mixed") notes.push("題目只有部分項目標明配分，為避免錯誤分母，本次不加總總分");
  if (rubric.mode === "question_criteria") notes.push("題目未明載各項上限，改顯示達成狀態，不自行平均配分");
  if (rubric.mode === "platform_reference") notes.push("未提供題目 rubric，不顯示假定百分制分數");
  notes.push(`${linkedCount}/${issues.length} 則審圖意見已連到給分項`);
  if (questionConfidence !== undefined && questionConfidence < 0.6) notes.push("題目判讀信心偏低，請核對原題");
  const uncertain = Object.values(observation.checks).filter((check) => check.status === "uncertain").length;
  if (uncertain) notes.push(`${uncertain} 個重要圖面要素仍待確認`);
  const context = review.scenario
    ? `${getReviewScenario(review.scenario).label} · ${review.targetMinutes || getReviewScenario(review.scenario).minutes} 分鐘` : "";

  return { ...review, issues: linkedIssues, dimensions, overallScore, overallMaxScore, scoringMode: rubric.mode,
    scoreNote: `平台練習暫評，非官方成績。${context ? `${context}；` : ""}${notes.join("；")}。` };
}
