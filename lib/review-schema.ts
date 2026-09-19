export type ReviewSeverity = "high" | "medium" | "low" | "info";

export type VisibilityStatus =
  | "clear"
  | "partially_blurry"
  | "illegible";

export type ReviewKind = "issue" | "clarity_request";

export type NormalizedBBox = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type RedlinePrimitive =
  | {
      type: "line";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    }
  | {
      type: "rect";
      x: number;
      y: number;
      w: number;
      h: number;
    }
  | {
      type: "polyline";
      points: Array<[number, number]>;
    };

export type CropRequest = {
  reason: string;
  instructions: string[];
  reviewTargets: string[];
};

export type ReviewItem = {
  id: string;
  kind: ReviewKind;
  title: string;
  category: string;
  severity: ReviewSeverity;
  scoreImpact: number | null;
  confidence: number;
  visibilityStatus: VisibilityStatus;
  description: string;
  suggestion: string;
  bbox: NormalizedBBox;
  redline?: RedlinePrimitive;
  cropRequest?: CropRequest;
};

export type ReviewDimension = {
  key: string;
  label: string;
  score: number;
  maxScore: number;
  confidence: number;
};

export type DrawingReview = {
  reviewId: string;
  drawingId: string;
  overallScore: number | null;
  dimensions: ReviewDimension[];
  issues: ReviewItem[];
  needsSupplement: boolean;
};
