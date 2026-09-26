import { NextResponse } from "next/server";
import type { ReviewItem } from "@/lib/review-schema";
import { getReviewProvider } from "@/lib/review-provider";
import { reviewAuthorizationError } from "@/lib/server-auth";
import { isReviewScenarioId, normalizeReviewMinutes } from "@/lib/review-scenario";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export async function POST(request: Request) {
  try {
    const denied = await reviewAuthorizationError(request);
    if (denied) return denied;
    const formData = await request.formData();

    const crop = formData.get("crop");
    const reviewId = formData.get("reviewId");
    const drawingId = formData.get("drawingId");
    const issueJson = formData.get("issue");

    if (!(crop instanceof File)) {
      return NextResponse.json(
        { error: "缺少局部補圖。" },
        { status: 400 }
      );
    }

    if (!crop.type.startsWith("image/")) {
      return NextResponse.json(
        { error: "局部補圖目前只接受圖片格式。" },
        { status: 415 }
      );
    }

    if (crop.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: "局部圖片超過 15 MB。" },
        { status: 413 }
      );
    }

    if (
      typeof reviewId !== "string" ||
      typeof drawingId !== "string" ||
      typeof issueJson !== "string"
    ) {
      return NextResponse.json(
        { error: "缺少原始 review context。" },
        { status: 400 }
      );
    }

    let originalIssue: ReviewItem;

    try {
      originalIssue = JSON.parse(issueJson) as ReviewItem;
    } catch {
      return NextResponse.json(
        { error: "issue context 格式錯誤。" },
        { status: 400 }
      );
    }

    const model = (formData.get("model") as string | null) || undefined;
    const intensity = (formData.get("intensity") as "gentle" | "standard" | "strict" | null) || undefined;
    const scenarioValue = formData.get("scenario");
    const scenario = isReviewScenarioId(scenarioValue) ? scenarioValue : "design_8h";

    const provider = getReviewProvider();
    const result = await provider.reviewSupplement({
      file: crop,
      reviewId,
      drawingId,
      originalIssue,
      model,
      intensity,
      scenario,
      targetMinutes: normalizeReviewMinutes(formData.get("targetMinutes"), scenario)
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Supplement review API failed:", error);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "局部精審流程發生錯誤。" },
      { status: 502 }
    );
  }
}
