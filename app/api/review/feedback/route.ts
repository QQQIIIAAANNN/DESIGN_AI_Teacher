import { NextResponse } from "next/server";
import { appendReviewMemory } from "@/lib/review-memory";
import type {
  NormalizedBBox,
  ReviewFeedbackDraft,
  ReviewFeedbackVerdict,
  ReviewItem,
  ReviewMisjudgmentType
} from "@/lib/review-schema";
import { reviewAuthorizationError } from "@/lib/server-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const verdicts = new Set<ReviewFeedbackVerdict>([
  "correct", "partially_correct", "misjudged", "wrong_location", "helpful", "unhelpful"
]);
const misjudgmentTypes = new Set<ReviewMisjudgmentType>([
  "observation_error", "criterion_mismatch", "reasoning_error", "severity_error", "missing_context", "other"
]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function bbox(value: unknown): NormalizedBBox | undefined {
  const item = record(value);
  if (!item) return undefined;
  const values = [item.x, item.y, item.w, item.h];
  if (!values.every((entry) => typeof entry === "number" && Number.isFinite(entry) && entry >= 0 && entry <= 1)) return undefined;
  const normalized = { x: item.x as number, y: item.y as number, w: item.w as number, h: item.h as number };
  return normalized.w > 0 && normalized.h > 0 && normalized.x + normalized.w <= 1.001 && normalized.y + normalized.h <= 1.001
    ? normalized : undefined;
}

export async function POST(request: Request) {
  try {
    const denied = await reviewAuthorizationError(request);
    if (denied) return denied;
    const raw = await request.text();
    if (raw.length > 64 * 1024) {
      return NextResponse.json({ error: "回饋資料過大。" }, { status: 413 });
    }
    const body = record(JSON.parse(raw));
    const issueValue = record(body?.issue);
    const feedbackValue = record(body?.feedback);
    const verdict = feedbackValue?.verdict;
    const issueBbox = bbox(issueValue?.bbox);
    if (!body || !issueValue || !feedbackValue || typeof verdict !== "string" ||
        !verdicts.has(verdict as ReviewFeedbackVerdict) || !issueBbox ||
        typeof issueValue.id !== "string" || typeof issueValue.title !== "string") {
      return NextResponse.json({ error: "回饋格式不正確。" }, { status: 400 });
    }

    const misjudgmentType = feedbackValue.misjudgmentType;
    if (verdict === "misjudged" && misjudgmentType !== undefined &&
        (typeof misjudgmentType !== "string" || !misjudgmentTypes.has(misjudgmentType as ReviewMisjudgmentType))) {
      return NextResponse.json({ error: "誤判類型格式不正確。" }, { status: 400 });
    }
    const correctedBbox = bbox(feedbackValue.correctedBbox);
    if (verdict === "wrong_location" && !correctedBbox) {
      return NextResponse.json({ error: "請先在圖面標記修改後位置。" }, { status: 400 });
    }

    const feedback: ReviewFeedbackDraft & { verdict: ReviewFeedbackVerdict } = {
      verdict: verdict as ReviewFeedbackVerdict,
      misjudgmentType: typeof misjudgmentType === "string" && misjudgmentTypes.has(misjudgmentType as ReviewMisjudgmentType)
        ? misjudgmentType as ReviewMisjudgmentType : undefined,
      note: typeof feedbackValue.note === "string" ? feedbackValue.note.slice(0, 2000) : "",
      originalBbox: bbox(feedbackValue.originalBbox) || issueBbox,
      correctedBbox
    };
    const issue: Parameters<typeof appendReviewMemory>[0]["issue"] = {
      id: issueValue.id.slice(0, 160),
      kind: issueValue.kind === "strength" || issueValue.kind === "clarity_request" ? issueValue.kind : "issue",
      title: issueValue.title.slice(0, 400),
      category: typeof issueValue.category === "string" ? issueValue.category.slice(0, 160) : "未分類",
      severity: issueValue.severity === "high" || issueValue.severity === "medium" || issueValue.severity === "low"
        ? issueValue.severity : "info",
      evidence: typeof issueValue.evidence === "string" ? issueValue.evidence.slice(0, 2000) : "",
      criterion: typeof issueValue.criterion === "string" ? issueValue.criterion.slice(0, 2000) : "",
      description: typeof issueValue.description === "string" ? issueValue.description.slice(0, 2000) : "",
      suggestion: typeof issueValue.suggestion === "string" ? issueValue.suggestion.slice(0, 2000) : "",
      sourceRefs: Array.isArray(issueValue.sourceRefs)
        ? issueValue.sourceRefs.filter((value): value is string => typeof value === "string").slice(0, 12) : [],
      rubricRefs: Array.isArray(issueValue.rubricRefs)
        ? issueValue.rubricRefs.filter((value): value is string => typeof value === "string").slice(0, 12) : [],
      bbox: issueBbox
    } satisfies Parameters<typeof appendReviewMemory>[0]["issue"];

    const saved = await appendReviewMemory({
      reviewId: typeof body.reviewId === "string" ? body.reviewId.slice(0, 160) : "unknown",
      drawingId: typeof body.drawingId === "string" ? body.drawingId.slice(0, 300) : "unknown",
      questionTitle: typeof body.questionTitle === "string" ? body.questionTitle.slice(0, 300) : undefined,
      scenario: typeof body.scenario === "string" ? body.scenario.slice(0, 80) : undefined,
      issue,
      feedback
    });
    return NextResponse.json({ feedback: saved });
  } catch (error) {
    console.error("Review feedback persistence failed:", error);
    return NextResponse.json({ error: error instanceof SyntaxError ? "回饋 JSON 格式不正確。" :
      error instanceof Error ? error.message : "無法儲存回饋。" }, { status: 500 });
  }
}
