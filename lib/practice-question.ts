import type { QuestionCategory } from "@/data/question-bank";
import { normalizePracticeSitePlan, practiceSiteArea, practiceSiteConditions, type PracticeSitePlan } from "@/lib/practice-site";
import { isReviewScenarioId, type ReviewScenarioId } from "@/lib/review-scenario";

export type PracticeQuestionMode = "mock" | "forecast";

export type PracticeQuestion = {
  id: string;
  mode: PracticeQuestionMode;
  category: QuestionCategory;
  title: string;
  premise: string;
  siteConditions: string[];
  sitePlan?: PracticeSitePlan;
  specialRequirements?: string;
  program: string[];
  designTasks: string[];
  drawingRequirements: string[];
  constraints: string[];
  referenceIds: string[];
  sourceDepth: "pdf" | "catalog";
  generatedAt: string;
  durationMinutes?: number;
  generationModel?: string;
  scenarioId?: ReviewScenarioId;
  programSchedule?: { name: string; areaM2: number; quantity: number; note: string }[];
  designParameters?: { grossFloorAreaM2: number; circulationPercent: number; maxCoveragePercent: number; maxFloors: number };
  scoringCriteria?: { criterion: string; points: number; checks: string[] }[];
  forecastAnalysis?: { basis: { referenceId: string; finding: string }[]; rationale: string; uncertainty: string };
  sourceDocuments?: { id: string; depth: "pdf" | "catalog" }[];
  themeKey?: string;
};

function strings(value: unknown, limit: number) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, 350)).filter(Boolean).slice(0, limit) : [];
}

function details(record: Record<string, unknown>, site: PracticeSitePlan, referenceIds: string[]) {
  const number = (value: unknown, min: number, max: number) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error("題目的面積、數量或配分不合理，請重新生成。");
    return value;
  };
  const text = (value: unknown, max = 350) => {
    if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error("題目的量化需求或推演說明不完整。");
    return value.trim();
  };
  const rows = (value: unknown, min: number, max: number): Record<string, unknown>[] => {
    if (!Array.isArray(value) || value.length < min || value.length > max || value.some((r) => !r || typeof r !== "object" || Array.isArray(r))) throw new Error("題目缺少完整的面積表、評分項目或歷年依據。");
    return value;
  };
  const programSchedule = rows(record.programSchedule, 3, 12).map((r) => ({ name: text(r.name, 80),
    areaM2: number(r.areaM2, 5, 20000), quantity: number(r.quantity, 1, 100), note: text(r.note) }));
  if (programSchedule.some((r) => !Number.isInteger(r.quantity))) throw new Error("機能數量必須是整數。");
  const p = record.designParameters as Record<string, unknown> | undefined;
  if (!p || typeof p !== "object" || Array.isArray(p)) throw new Error("缺少規模與樓層限制。");
  const designParameters = { grossFloorAreaM2: number(p.grossFloorAreaM2, 100, 50000),
    circulationPercent: number(p.circulationPercent, 15, 50), maxCoveragePercent: number(p.maxCoveragePercent, 20, 80),
    maxFloors: number(p.maxFloors, 1, 10) };
  const net = programSchedule.reduce((sum, r) => sum + r.areaM2 * r.quantity, 0);
  if (!Number.isInteger(designParameters.maxFloors) ||
      designParameters.grossFloorAreaM2 < net * (1 + designParameters.circulationPercent / 100) ||
      designParameters.grossFloorAreaM2 > net * (1 + designParameters.circulationPercent / 100) * 1.15 ||
      designParameters.grossFloorAreaM2 > practiceSiteArea(site) * designParameters.maxCoveragePercent / 100 * designParameters.maxFloors) {
    throw new Error("機能面積、公設加成、總樓地板與基地容納量不一致，請重新生成。");
  }
  const scoringCriteria = rows(record.scoringCriteria, 3, 8).map((r) => {
    const checks = strings(r.checks, 6);
    if (!checks.length) throw new Error("配分項目缺少可檢核的圖面成果。");
    return { criterion: text(r.criterion, 100), points: number(r.points, 1, 100), checks };
  });
  if (scoringCriteria.some((r) => !Number.isInteger(r.points)) || scoringCriteria.reduce((sum, r) => sum + r.points, 0) !== 100) throw new Error("練習題配分必須合計 100 分。");
  const a = record.forecastAnalysis as Record<string, unknown> | undefined;
  if (!a || typeof a !== "object" || Array.isArray(a)) throw new Error("缺少歷年依據與新題推演理由。");
  const basis = rows(a.basis, 2, 8).map((r) => ({ referenceId: text(r.referenceId, 100), finding: text(r.finding) }));
  if (basis.some((r) => !referenceIds.includes(r.referenceId)) || new Set(basis.map((r) => r.referenceId)).size < 2) throw new Error("題目推演必須引用至少兩份提供的歷年案例。");
  const forecastAnalysis = { basis, rationale: text(a.rationale, 1000), uncertainty: text(a.uncertainty, 600) };
  return { programSchedule, designParameters, scoringCriteria, forecastAnalysis };
}

export function normalizePracticeQuestion(value: unknown, meta: Pick<PracticeQuestion,
  "mode" | "category" | "referenceIds" | "sourceDepth" | "specialRequirements">): PracticeQuestion {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("生成題目格式不完整。");
  const record = value as Record<string, unknown>;
  const title = typeof record.title === "string" ? record.title.trim().slice(0, 100) : "";
  const premise = typeof record.premise === "string" ? record.premise.trim().slice(0, 1800) : "";
  const sitePlan = normalizePracticeSitePlan(record.sitePlan);
  const environmentNotes = strings(record.environmentNotes, 4)
    .filter((item) => !/(面寬|進深|深度|臨.*道路|道路.*公尺|指北|退縮.*公尺)/.test(item));
  const siteConditions = [...practiceSiteConditions(sitePlan), ...environmentNotes].slice(0, 24);
  if (sitePlan.contexts.length < 2 || sitePlan.roads.some((road) => !sitePlan.contexts.some((c) => c.edge === road.edge && c.floors && c.heightM && c.impact))) {
    throw new Error("基地條件必須含每條臨路對側街廓的用途、樓層、高度與設計影響。");
  }
  const complete = details(record, sitePlan, meta.referenceIds);
  const program = strings(record.program, 12);
  const designTasks = strings(record.designTasks, 10);
  const drawingRequirements = strings(record.drawingRequirements, 10);
  const constraints = strings(record.constraints, 10);
  // Model prose must not reinterpret drawing edges as geographic bearings when north rotates.
  const narrative = [premise, ...environmentNotes, ...program, ...designTasks, ...drawingRequirements, ...constraints,
    ...sitePlan.contexts.flatMap((c) => [c.label, c.impact || ""]), ...sitePlan.features.map((f) => f.label),
    ...complete.scoringCriteria.flatMap((r) => r.checks), complete.forecastAnalysis.rationale];
  const ambiguous = narrative.find((line) => /(?<![真東西南北])(?:東北|西北|東南|西南|北|東|南|西)(?:側|角)/u.test(line));
  if (ambiguous) throw new Error(`方位文字未跟指北分開：${ambiguous.slice(0, 100)}。基地位置一律改用圖上/圖右/圖下/圖左側或圖面右上/左下角；若指真實地理方向請明寫真北側等，不可把道路 edge 當地理方位。`);
  if (!title || !premise || !siteConditions.length || program.length < 3 || designTasks.length < 3 || drawingRequirements.length < 3 || constraints.length < 3) {
    throw new Error("模型未產生完整的題目、基地、機能與應交圖說，請再生成一次。");
  }
  return { id: `practice-${crypto.randomUUID()}`, ...meta, ...complete, title, premise, siteConditions, sitePlan,
    program, designTasks, drawingRequirements, constraints, generatedAt: new Date().toISOString() };
}

export function practiceQuestionText(question: PracticeQuestion) {
  const section = (label: string, rows: string[]) => `${label}：\n${rows.map((row) => `- ${row}`).join("\n")}`;
  const parameters = question.designParameters;
  return [question.premise, question.durationMinutes ? `作圖時間：${question.durationMinutes} 分鐘` : "", question.specialRequirements ? `特殊練習需求：${question.specialRequirements}` : "",
    section("基地條件", question.siteConditions), section("機能需求", question.program),
    question.programSchedule ? section("機能面積表", question.programSchedule.map((r) => `${r.name}：每處 ${r.areaM2} m² × ${r.quantity} = ${r.areaM2 * r.quantity} m²；${r.note}`)) : "",
    parameters ? `本題規模限制（練習設定）：總樓地板 ${parameters.grossFloorAreaM2} m²；動線與公設以機能淨面積加 ${parameters.circulationPercent}% 計入；建蔽率上限 ${parameters.maxCoveragePercent}%；最高 ${parameters.maxFloors} 層。` : "",
    section("設計課題", question.designTasks), section("應交圖說", question.drawingRequirements),
    section("限制條件", question.constraints),
    question.scoringCriteria ? section("本題練習配分（非官方）", question.scoringCriteria.map((r) => `${r.criterion} ${r.points} 分：${r.checks.join("；")}`)) : "",
    question.forecastAnalysis ? section("歷年依據與推演", [...question.forecastAnalysis.basis.map((r) => `${r.referenceId}：${r.finding}`), question.forecastAnalysis.rationale, question.forecastAnalysis.uncertainty]) : ""
  ].filter(Boolean).join("\n\n").slice(0, 24000);
}

export function isPracticeQuestion(value: unknown): value is PracticeQuestion {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const optionalValid = (() => {
    try {
      if ([row.programSchedule, row.designParameters, row.scoringCriteria, row.forecastAnalysis].some((v) => v !== undefined)) {
        details(row, normalizePracticeSitePlan(row.sitePlan), row.referenceIds as string[]);
      }
      if (row.durationMinutes !== undefined && (typeof row.durationMinutes !== "number" || !Number.isFinite(row.durationMinutes) || row.durationMinutes < 60 || row.durationMinutes > 600)) return false;
      if (row.scenarioId !== undefined && !isReviewScenarioId(row.scenarioId)) return false;
      if (row.sourceDocuments !== undefined && (!Array.isArray(row.sourceDocuments) || row.sourceDocuments.length > 24 || row.sourceDocuments.some((s) => !s || typeof s.id !== "string" || !["pdf", "catalog"].includes(s.depth)))) return false;
      return true;
    } catch { return false; }
  })();
  return optionalValid && (row.sourceDepth === "pdf" || row.sourceDepth === "catalog") &&
    typeof row.generatedAt === "string" && Number.isFinite(Date.parse(row.generatedAt)) && typeof row.id === "string" && row.id.startsWith("practice-") &&
    (row.mode === "mock" || row.mode === "forecast") &&
    ["architectural_design", "site_planning", "civil_service_grade_3"].includes(String(row.category)) &&
    typeof row.title === "string" && row.title.length <= 100 && typeof row.premise === "string" && row.premise.length <= 1800 &&
    (row.specialRequirements === undefined || typeof row.specialRequirements === "string" && row.specialRequirements.length <= 800) &&
    (row.sitePlan === undefined || (() => {
      try {
        const plan = normalizePracticeSitePlan(row.sitePlan);
        return typeof (row.sitePlan as Record<string, unknown>).northWidthM === "number" &&
          plan.roads.length > 0;
      } catch { return false; }
    })()) &&
    [row.siteConditions, row.program, row.designTasks, row.drawingRequirements, row.constraints, row.referenceIds]
      .every((items) => Array.isArray(items) && items.length <= 24 && items.every((item) => typeof item === "string" && item.length <= 350));
}


