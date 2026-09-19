import type { DrawingReview } from "@/lib/review-schema";
import { createMockReview } from "@/lib/review-mock";

export type ReviewInput = {
  file: File;
  examType?: "design" | "site_planning";
};

export interface ReviewProvider {
  reviewDrawing(input: ReviewInput): Promise<DrawingReview>;
}

class MockReviewProvider implements ReviewProvider {
  async reviewDrawing(input: ReviewInput): Promise<DrawingReview> {
    return createMockReview(input.file.name);
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
