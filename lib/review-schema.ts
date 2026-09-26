export type ReviewSeverity = "high" | "medium" | "low" | "info";

export type VisibilityStatus =
  | "clear"
  | "partially_blurry"
  | "illegible";

export type ReviewKind = "issue" | "clarity_request" | "strength";

export type DiscussionMessage = {
  role: "user" | "assistant";
  text: string;
  verdict?: "upheld" | "revised" | "needs_evidence";
};

export type CriticalFeature = "north_arrow" | "main_entrance" | "basement_ramp" | "outdoor_stair" | "none";

export type FeatureObservation = {
  status: "verified" | "uncertain" | "not_seen";
  evidence: string;
  cues?: string[];
  confidence?: number;
  locationConfidence?: number;
  bbox?: NormalizedBBox;
  confirmedByUser?: boolean;
};

export type ReviewObservation = {
  summary: string;
  visibleText: string[];
  siteEvidence: string[];
  programEvidence: string[];
  spatialEvidence: string[];
  checks: Record<Exclude<CriticalFeature, "none">, FeatureObservation>;
  uncertainties: string[];
};

export type RetrievedKnowledge = {
  id: string;
  sourceTitle: string;
  sourceType: string;
  knowledgeType: string;
  statement: string;
  imageRefs?: string[];
};

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
  evidenceConfidence?: number;
  locationConfidence?: number;
  locationConfirmed?: boolean;
  locationPinned?: boolean;
  visibilityStatus: VisibilityStatus;
  description: string;
  suggestion: string;
  evidence?: string;
  criterion?: string;
  sourceRefs?: string[];
  featureTag?: CriticalFeature;
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
  evidenceConfidence?: number;
  rationale?: string;
  evidence?: string;
  sourceRefs?: string[];
};

export type ConfirmedRegion = {
  title: string;
  featureTag?: CriticalFeature;
  bbox: NormalizedBBox;
  pinned?: boolean;
};

export type ReviewCoverage = {
  key: string;
  label: string;
  status: "reviewed" | "needs_evidence" | "not_applicable";
  summary: string;
  sourceRefs: string[];
};

export type DrawingReview = {
  reviewId: string;
  drawingId: string;
  overallScore: number | null;
  dimensions: ReviewDimension[];
  issues: ReviewItem[];
  coverage?: ReviewCoverage[];
  needsSupplement: boolean;
  model?: string;
  intensity?: "gentle" | "standard" | "strict";
  scenario?: import("@/lib/review-scenario").ReviewScenarioId;
  targetMinutes?: number;
  practiceQuestion?: import("@/lib/practice-question").PracticeQuestion | null;
  observations?: ReviewObservation;
  retrievedKnowledge?: RetrievedKnowledge[];
  scoreNote?: string;
  scoreStale?: boolean;
  questionContext?: import("@/lib/question-context").QuestionContext | null;
};

export type SupplementReviewStatus = "resolved" | "still_uncertain";

export type SupplementReviewResult = {
  status: SupplementReviewStatus;
  issue: ReviewItem;
};
