import type {
  DrawingReview,
  ReviewItem,
  SupplementReviewResult
} from "@/lib/review-schema";
import {
  createMockReview,
  createMockSupplementReview
} from "@/lib/review-mock";

export type ReviewInput = {
  file: File;
  examType?: "design" | "site_planning";
};

export type SupplementReviewInput = {
  file: File;
  reviewId: string;
  drawingId: string;
  originalIssue: ReviewItem;
};

export interface ReviewProvider {
  reviewDrawing(input: ReviewInput): Promise<DrawingReview>;
  reviewSupplement(input: SupplementReviewInput): Promise<SupplementReviewResult>;
}

class MockReviewProvider implements ReviewProvider {
  async reviewDrawing(input: ReviewInput): Promise<DrawingReview> {
    return createMockReview(input.file.name);
  }

  async reviewSupplement(
    input: SupplementReviewInput
  ): Promise<SupplementReviewResult> {
    return createMockSupplementReview(input.originalIssue);
  }
}

export function getReviewProvider(): ReviewProvider {
  const provider = process.env.REVIEW_PROVIDER ?? "mock";

  if (provider === "mock") {
    return new MockReviewProvider();
  }

  throw new Error(
    `Unsupported REVIEW_PROVIDER "${provider}". Add a provider adapter before enabling it.`
  );
}
