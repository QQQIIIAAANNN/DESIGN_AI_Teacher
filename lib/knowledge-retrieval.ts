import { readFile } from "node:fs/promises";
import path from "node:path";
import type { RetrievedKnowledge, ReviewObservation } from "@/lib/review-schema";
import { searchPrivateKnowledge } from "@/lib/private-knowledge";

export type KnowledgeUnit = RetrievedKnowledge & {
  examType: string;
  topics: string[];
  conditions: string[];
  exceptions: string[];
  evidenceTargets: string[];
  remediation: string[];
};

const anchors = ["K-SYS-0001", "K-SYS-0008"];

function tokens(text: string) {
  const normalized = text.toLowerCase();
  const latin = normalized.match(/[a-z][a-z0-9_-]{2,}/g) ?? [];
  const han = normalized.match(/[\u3400-\u9fff]+/g) ?? [];
  const grams = han.flatMap((run) => run.length <= 2 ? [run] : Array.from({ length: run.length - 1 }, (_, i) => run.slice(i, i + 2)));
  return new Set([...latin, ...grams]);
}

export async function retrieveKnowledge(query: string, examType: "design" | "site_planning" = "design", limit = 14,
  focusKeys: string[] = []): Promise<KnowledgeUnit[]> {
  const manifest = path.join(process.cwd(), "knowledge", "manifests", "knowledge_units.jsonl");
  const expanded = path.join(process.cwd(), "knowledge", "manifests", "review_coverage_units.jsonl");
  const lines = [await readFile(manifest, "utf8"), await readFile(expanded, "utf8")].flatMap((content) => content.split(/\r?\n/).filter(Boolean));
  const queryTokens = tokens(query);
  const units = lines.map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((row) => row.curation_status === "canonical" && (row.exam_type === "both" || row.exam_type === examType))
    .map((row): KnowledgeUnit => ({
      id: String(row.knowledge_id), sourceTitle: String(row.source_title), sourceType: String(row.source_type),
      knowledgeType: String(row.knowledge_type), statement: String(row.statement), examType: String(row.exam_type),
      imageRefs: Array.isArray(row.image_refs) ? row.image_refs.map(String) : [],
      topics: Array.isArray(row.topics) ? row.topics.map(String) : [],
      conditions: Array.isArray(row.conditions) ? row.conditions.map(String) : [],
      exceptions: Array.isArray(row.exceptions) ? row.exceptions.map(String) : [],
      evidenceTargets: Array.isArray(row.evidence_targets) ? row.evidence_targets.map(String) : [],
      remediation: Array.isArray(row.remediation) ? row.remediation.map(String) : []
    }));
  const scored = units.filter((unit) => !anchors.includes(unit.id)).map((unit) => {
    const haystack = tokens([unit.statement, ...unit.topics, ...unit.conditions, ...unit.evidenceTargets, ...unit.remediation].join(" "));
    const overlap = [...queryTokens].reduce((sum, token) => sum + (haystack.has(token) ? 1 : 0), 0);
    return { unit, score: overlap };
  });
  const core = anchors.flatMap((id) => units.find((unit) => unit.id === id) || []);
  const related = scored.sort((a, b) => b.score - a.score || a.unit.id.localeCompare(b.unit.id)).map(({ unit }) => unit);
  const privateMatches = (await searchPrivateKnowledge(query, Math.max(3, Math.floor(limit / 2)), focusKeys)).map((item): KnowledgeUnit => ({
    ...item, examType: "both", topics: [], conditions: ["課程資料摘錄，尚未人工確認為評分規則"],
    exceptions: [], evidenceTargets: [], remediation: []
  }));
  const publicQuota = privateMatches.length ? Math.max(core.length, limit - privateMatches.length) : limit;
  return [...core, ...related].slice(0, publicQuota).concat(privateMatches).slice(0, limit);
}

export function knowledgeQuery(observation: ReviewObservation, questionTitle: string, brief: string) {
  return [questionTitle, brief, observation.summary, ...observation.visibleText,
    ...observation.siteEvidence, ...observation.programEvidence, ...observation.spatialEvidence,
    ...observation.uncertainties].join(" ").slice(0, 12000);
}

export function knowledgePrompt(units: KnowledgeUnit[]) {
  return units.map((unit) => JSON.stringify({ id: unit.id, source: unit.sourceTitle, sourceType: unit.sourceType,
    knowledgeType: unit.knowledgeType, rule: unit.statement, conditions: unit.conditions,
    exceptions: unit.exceptions, evidenceTargets: unit.evidenceTargets, remediation: unit.remediation,
    imageRefs: unit.imageRefs })).join("\n");
}
