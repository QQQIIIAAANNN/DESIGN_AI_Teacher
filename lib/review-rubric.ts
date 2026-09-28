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

const platformReferenceItems: ResolvedReviewRubricItem[] = [
  { key: "brief", section: "平台參考", label: "題意與機能需求", criterion: "核對題目目標、空間計畫與必要需求。", maxScore: null, source: "platform_reference" },
  { key: "site", section: "平台參考", label: "基地紋理與建築計畫", criterion: "核對基地條件、鄰里界面與配置策略。", maxScore: null, source: "platform_reference" },
  { key: "spatial", section: "平台參考", label: "空間層次與公共性", criterion: "核對室內外、開放程度及公共與私密層次。", maxScore: null, source: "platform_reference" },
  { key: "circulation", section: "平台參考", label: "入口與動線", criterion: "核對主要到達、入口辨識與人車服務動線。", maxScore: null, source: "platform_reference" },
  { key: "representation", section: "平台參考", label: "圖面可讀性與論證", criterion: "核對應交圖說、標註與設計論證是否可讀。", maxScore: null, source: "platform_reference" }
];

function groupedItem(key: string, section: string, label: string, criteria: string[], source: ReviewRubricSource): ResolvedReviewRubricItem | null {
  const filtered = criteria.map((item) => item.trim()).filter(Boolean).slice(0, 20);
  if (!filtered.length) return null;
  return { key, section, label, criterion: filtered.join("；"), maxScore: null, source };
}

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
    const scoredCount = items.filter((item) => item.maxScore !== null).length;
    const mode: ReviewScoringMode = scoredCount === items.length
      ? "question_points" : scoredCount ? "question_mixed" : "question_criteria";
    return { items, mode,
      totalMaxScore: mode === "question_points"
        ? items.reduce((sum, item) => sum + (item.maxScore || 0), 0) : null,
      sourceLabel: "題目明示的給分項目" };
  }

  if (questionContext) {
    const items = [
      groupedItem("question-program", "題目要求", "建築計畫與需求", questionContext.requirements, "question_deliverable"),
      groupedItem("question-drawings", "題目要求", "應交圖說", questionContext.drawingRequirements, "question_deliverable"),
      groupedItem("question-constraints", "題目要求", "限制條件", questionContext.constraints, "question_deliverable")
    ].filter((item): item is ResolvedReviewRubricItem => item !== null);
    if (items.length) return { items, mode: "question_criteria", totalMaxScore: null,
      sourceLabel: "題目未列配分，依題目要求檢核" };
  }

  if (practiceQuestion) {
    const items = [
      groupedItem("practice-program", "模擬題", "建築計畫與機能", practiceQuestion.program, "practice_question"),
      groupedItem("practice-tasks", "模擬題", "設計課題", practiceQuestion.designTasks, "practice_question"),
      groupedItem("practice-drawings", "模擬題", "應交圖說", practiceQuestion.drawingRequirements, "practice_question")
    ].filter((item): item is ResolvedReviewRubricItem => item !== null);
    if (items.length) return { items, mode: "question_criteria", totalMaxScore: null,
      sourceLabel: "模擬題要求（未設定配分）" };
  }

  return { items: platformReferenceItems.map((item) => ({ ...item })), mode: "platform_reference",
    totalMaxScore: null, sourceLabel: "未提供題目評分項目，僅作平台檢核" };
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

  const fullyScored = rubric.mode === "question_points" && dimensions.length > 0 &&
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
