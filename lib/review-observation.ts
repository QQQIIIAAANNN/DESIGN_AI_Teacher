import type { ReviewObservation, FeatureObservation } from "@/lib/review-schema";

const featureKeys = ["north_arrow", "main_entrance", "basement_ramp", "outdoor_stair"] as const;

export const observationPrompt = [
  "你是建築圖面辨識員。先做純視覺事實盤點，不評分、不下設計結論。只輸出 JSON。",
  "逐一檢查指北針、主要入口、地下室車道坡道、戶外階梯。每項填入 cues：至少兩個獨立、可指認的圖面線索（例如標字及相應幾何），才可標 verified；看不清或只有相似輪廓標 uncertain；完全不見標 not_seen。",
  "指北須辨識 N/北 與箭頭方向；車道坡道須辨識車行、坡度/標高或 B1/地下室標示；樓梯須辨識重複踏階或標高變化；入口須辨識門、進入路徑與室內外界線。不可把車道坡道當戶外平台或把相似入口直接判為地下室坡道。",
  "記下圖面可讀文字、基地資訊、機能需求與空間證據。區分戶外/半戶外/室內、開放/半開放/半封閉/封閉、公共/中介/私密；只記看得到的，不補想像。",
  '格式：{"summary":"","visibleText":[],"siteEvidence":[],"programEvidence":[],"spatialEvidence":[],"checks":{"north_arrow":{"status":"verified|uncertain|not_seen","evidence":"","cues":[],"confidence":0.0,"locationConfidence":0.0,"bbox":{"x":0.0,"y":0.0,"w":0.1,"h":0.1}},"main_entrance":{"status":"verified|uncertain|not_seen","evidence":"","cues":[],"confidence":0.0,"locationConfidence":0.0,"bbox":null},"basement_ramp":{"status":"verified|uncertain|not_seen","evidence":"","cues":[],"confidence":0.0,"locationConfidence":0.0,"bbox":null},"outdoor_stair":{"status":"verified|uncertain|not_seen","evidence":"","cues":[],"confidence":0.0,"locationConfidence":0.0,"bbox":null}},"uncertainties":[]}'
].join("\n");

function strings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 240)).slice(0, 12)
    : [];
}

function bbox(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const coordinates = [row.x, row.y, row.w, row.h];
  if (!coordinates.every((item) => typeof item === "number" && Number.isFinite(item) && item >= 0 && item <= 1)) return undefined;
  const [x, y, w, h] = coordinates as number[];
  if (w <= 0 || h <= 0 || x + w > 1.001 || y + h > 1.001) return undefined;
  return { x, y, w, h };
}

export function normalizeObservation(value: unknown): ReviewObservation {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawChecks = row.checks && typeof row.checks === "object" ? row.checks as Record<string, unknown> : {};
  const checks = {} as ReviewObservation["checks"];
  for (const key of featureKeys) {
    const raw = rawChecks[key] && typeof rawChecks[key] === "object" ? rawChecks[key] as Record<string, unknown> : {};
    const evidence = typeof raw.evidence === "string" ? raw.evidence.slice(0, 400) : "";
    const cues = strings(raw.cues).slice(0, 4);
    const status: FeatureObservation["status"] = raw.status === "not_seen" ? "not_seen"
      : raw.status === "verified" && evidence.trim() && cues.length >= 2 ? "verified" : "uncertain";
    const confidence = typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
      ? Math.min(1, Math.max(0, raw.confidence)) : status === "verified" ? 0.65 : 0.3;
    const locationConfidence = typeof raw.locationConfidence === "number" && Number.isFinite(raw.locationConfidence)
      ? Math.min(1, Math.max(0, raw.locationConfidence)) : 0.4;
    checks[key] = { status, evidence, cues, confidence, locationConfidence, bbox: bbox(raw.bbox) };
  }
  return {
    summary: typeof row.summary === "string" ? row.summary.slice(0, 700) : "圖面辨識資訊不足。",
    visibleText: strings(row.visibleText),
    siteEvidence: strings(row.siteEvidence),
    programEvidence: strings(row.programEvidence),
    spatialEvidence: strings(row.spatialEvidence),
    checks,
    uncertainties: strings(row.uncertainties)
  };
}

export type ObservationOverrides = Partial<Record<typeof featureKeys[number], {
  status?: "verified" | "uncertain" | "not_seen";
  bbox?: FeatureObservation["bbox"];
}>>;

export function applyObservationOverrides(observation: ReviewObservation, overrides: ObservationOverrides = {}): ReviewObservation {
  const checks = { ...observation.checks };
  for (const key of featureKeys) {
    const override = overrides[key];
    if (!override || typeof override !== "object") continue;
    const status = override.status;
    const correctedBox = bbox(override.bbox);
    if (status && !["verified", "uncertain", "not_seen"].includes(status)) continue;
    if (!status && !correctedBox) continue;
    checks[key] = { ...checks[key], status: status || checks[key].status, confirmedByUser: true,
      confidence: status === "uncertain" ? 0.3 : status ? 1 : checks[key].confidence,
      locationConfidence: status === "not_seen" ? 0 : correctedBox ? 1 : checks[key].locationConfidence,
      bbox: status === "not_seen" ? undefined : correctedBox || checks[key].bbox,
      evidence: `${checks[key].evidence}（使用者確認${status ? `：${status}` : "位置"}）`.trim(),
      cues: status === "verified" ? [...(checks[key].cues || []), "使用者確認圖面位置"] : checks[key].cues };
  }
  return { ...observation, checks };
}
