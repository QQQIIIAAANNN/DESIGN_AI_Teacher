import type { QuestionCategory } from "@/data/question-bank";
import { normalizePracticeSitePlan, practiceSiteConditions, type PracticeSitePlan } from "@/lib/practice-site";

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
};

function strings(value: unknown, limit: number) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, 350)).filter(Boolean).slice(0, limit) : [];
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
  const program = strings(record.program, 12);
  const designTasks = strings(record.designTasks, 10);
  const drawingRequirements = strings(record.drawingRequirements, 10);
  const constraints = strings(record.constraints, 10);
  if (!title || !premise || !siteConditions.length || !program.length || !drawingRequirements.length) {
    throw new Error("模型未產生完整的題目、基地、機能與應交圖說，請再生成一次。");
  }
  return { id: `practice-${crypto.randomUUID()}`, ...meta, title, premise, siteConditions, sitePlan,
    program, designTasks, drawingRequirements, constraints, generatedAt: new Date().toISOString() };
}

export function practiceQuestionText(question: PracticeQuestion) {
  const section = (label: string, rows: string[]) => `${label}：\n${rows.map((row) => `- ${row}`).join("\n")}`;
  return [question.premise, question.specialRequirements ? `特殊練習需求：${question.specialRequirements}` : "",
    section("基地條件", question.siteConditions), section("機能需求", question.program),
    section("設計課題", question.designTasks), section("應交圖說", question.drawingRequirements),
    section("限制條件", question.constraints)].join("\n\n").slice(0, 16000);
}

export function isPracticeQuestion(value: unknown): value is PracticeQuestion {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && row.id.startsWith("practice-") &&
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
