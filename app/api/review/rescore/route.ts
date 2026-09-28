import { NextResponse } from "next/server";
import { normalizeItem } from "@/lib/ai-proxy-client";
import { getReviewProvider, type ReviewIntensity } from "@/lib/review-provider";
import type { ReviewDimension, ReviewItem, ReviewRubricSource } from "@/lib/review-schema";
import { reviewAuthorizationError } from "@/lib/server-auth";
import { isReviewScenarioId } from "@/lib/review-scenario";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const rubricSources = new Set<ReviewRubricSource>(["question_explicit", "question_deliverable", "practice_question", "platform_reference"]);
const intensities = new Set<ReviewIntensity>(["gentle", "standard", "strict"]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function parseJson(value: FormDataEntryValue | null): unknown {
  if (typeof value !== "string" || value.length > 256 * 1024) throw new Error("局部分項資料格式不正確或過大。");
  return JSON.parse(value);
}

function normalizeIssue(value: unknown, index: number): ReviewItem {
  const row = record(value);
  if (!row || typeof row.id !== "string" || typeof row.title !== "string" || !row.bbox) {
    throw new Error("審圖卡片資料不完整。");
  }
  return normalizeItem(row, index);
}

function normalizeDimension(value: unknown): ReviewDimension | null {
  const row = record(value);
  if (!row || typeof row.key !== "string" || !/^[a-z0-9][a-z0-9_-]{1,79}$/i.test(row.key) ||
      typeof row.label !== "string" || row.label.length > 160 ||
      !(row.maxScore === null || typeof row.maxScore === "number" && Number.isFinite(row.maxScore) && row.maxScore > 0 && row.maxScore <= 1000) ||
      !(row.score === null || typeof row.score === "number" && Number.isFinite(row.score) && row.score >= 0)) return null;
  return {
    key: row.key,
    label: row.label,
    section: typeof row.section === "string" ? row.section.slice(0, 100) : undefined,
    criterion: typeof row.criterion === "string" ? row.criterion.slice(0, 1200) : "",
    score: row.score as number | null,
    maxScore: row.maxScore as number | null,
    assessment: row.assessment === "excellent" || row.assessment === "good" || row.assessment === "partial" ||
      row.assessment === "insufficient" || row.assessment === "unverified" ? row.assessment : "unverified",
    rubricSource: typeof row.rubricSource === "string" && rubricSources.has(row.rubricSource as ReviewRubricSource)
      ? row.rubricSource as ReviewRubricSource : undefined,
    relatedIssueIds: Array.isArray(row.relatedIssueIds) ? row.relatedIssueIds.filter((id): id is string => typeof id === "string").slice(0, 20) : [],
    confidence: typeof row.confidence === "number" && Number.isFinite(row.confidence) ? Math.max(0, Math.min(1, row.confidence)) : 0.4,
    evidenceConfidence: typeof row.evidenceConfidence === "number" && Number.isFinite(row.evidenceConfidence)
      ? Math.max(0, Math.min(1, row.evidenceConfidence)) : undefined,
    rationale: typeof row.rationale === "string" ? row.rationale.slice(0, 1200) : "",
    evidence: typeof row.evidence === "string" ? row.evidence.slice(0, 900) : "",
    sourceRefs: Array.isArray(row.sourceRefs) ? row.sourceRefs.filter((ref): ref is string => typeof ref === "string").slice(0, 8) : []
  };
}

export async function POST(request: Request) {
  try {
    const denied = await reviewAuthorizationError(request);
    if (denied) return denied;
    const form = await request.formData();
    const crop = form.get("crop");
    if (!(crop instanceof File) || !["image/png", "image/jpeg", "image/webp"].includes(crop.type) || crop.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "請提供 8 MB 以下的 PNG、JPEG 或 WebP 局部圖。" }, { status: 400 });
    }
    const previousIssue = normalizeIssue(parseJson(form.get("previousIssue")), 0);
    const updatedIssue = normalizeIssue(parseJson(form.get("updatedIssue")), 1);
    if (previousIssue.id !== updatedIssue.id) return NextResponse.json({ error: "原意見與修正意見識別碼不一致。" }, { status: 400 });
    const dimensionsValue = parseJson(form.get("dimensions"));
    if (!Array.isArray(dimensionsValue) || !dimensionsValue.length || dimensionsValue.length > 12) {
      return NextResponse.json({ error: "請提供 1 至 12 個關聯給分項。" }, { status: 400 });
    }
    const dimensions = dimensionsValue.map(normalizeDimension).filter((item): item is ReviewDimension => item !== null);
    if (dimensions.length !== dimensionsValue.length) return NextResponse.json({ error: "關聯給分項格式不正確。" }, { status: 400 });
    const issueValues = parseJson(form.get("relatedIssues"));
    if (!Array.isArray(issueValues) || issueValues.length > 40) return NextResponse.json({ error: "相關意見清單格式不正確。" }, { status: 400 });
    const relatedIssues = issueValues.map((item, index) => normalizeIssue(item, index))
      .filter((item) => item.id !== previousIssue.id);
    relatedIssues.push(updatedIssue);
    const linkedKeys = new Set([...(previousIssue.rubricRefs || []), ...(updatedIssue.rubricRefs || [])]);
    const targetedDimensions = dimensions.filter((dimension) => linkedKeys.has(dimension.key) ||
      dimension.relatedIssueIds?.includes(previousIssue.id));
    if (!targetedDimensions.length || targetedDimensions.length !== dimensions.length) {
      return NextResponse.json({ error: "評分請求包含未關聯此意見的給分項。" }, { status: 400 });
    }
    const requestedIntensity = form.get("intensity");
    const scenarioValue = form.get("scenario");
    const modelValue = form.get("model");
    const result = await getReviewProvider().rescoreDimensions({
      file: crop,
      previousIssue,
      updatedIssue,
      dimensions: targetedDimensions,
      relatedIssues,
      model: typeof modelValue === "string" ? modelValue.slice(0, 200) : undefined,
      intensity: typeof requestedIntensity === "string" && intensities.has(requestedIntensity as ReviewIntensity)
        ? requestedIntensity as ReviewIntensity : "standard",
      scenario: isReviewScenarioId(scenarioValue) ? scenarioValue : "design_8h"
    });
    return NextResponse.json({ dimensions: result });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "關聯給分項局部重評失敗。" }, { status: 502 });
  }
}
