import type { ConfirmedRegion, CriticalFeature, DrawingReview, ReviewItem, ReviewObservation } from "@/lib/review-schema";

export function normalizeConfirmedRegions(value: unknown): ConfirmedRegion[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 40).flatMap((item): ConfirmedRegion[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.title !== "string" || !row.title.trim() || !row.bbox || typeof row.bbox !== "object") return [];
    const box = row.bbox as Record<string, unknown>;
    const values = [box.x, box.y, box.w, box.h];
    if (!values.every((number) => typeof number === "number" && Number.isFinite(number) && number >= 0 && number <= 1)) return [];
    const [x, y, w, h] = values as number[];
    if (w <= 0 || h <= 0 || x + w > 1.001 || y + h > 1.001) return [];
    const tags: CriticalFeature[] = ["north_arrow", "main_entrance", "basement_ramp", "outdoor_stair", "none"];
    return [{ title: row.title.trim().slice(0, 160), bbox: { x, y, w, h }, pinned: row.pinned === true,
      featureTag: tags.includes(row.featureTag as CriticalFeature) ? row.featureTag as CriticalFeature : "none" }];
  });
}

function inferredFeature(issue: ReviewItem): CriticalFeature {
  if (issue.featureTag && issue.featureTag !== "none") return issue.featureTag;
  const text = `${issue.title} ${issue.description}`;
  if (/指北|北箭|north arrow/i.test(text)) return "north_arrow";
  if (/地下室.*坡道|車道坡道|basement ramp/i.test(text)) return "basement_ramp";
  if (/戶外階梯|室外階梯|outdoor stair/i.test(text)) return "outdoor_stair";
  if (/主入口|主要入口|main entrance/i.test(text)) return "main_entrance";
  return "none";
}

export function groundReview(review: DrawingReview, observations: ReviewObservation, allowedIds: Set<string>, confirmedRegions: ConfirmedRegion[] = []): DrawingReview {
  const dimensions = review.dimensions.map((dimension) => ({
    ...dimension, sourceRefs: (dimension.sourceRefs || []).filter((id) => allowedIds.has(id))
  }));
  const coverage = review.coverage?.map((item) => {
    const sourceRefs = item.sourceRefs.filter((id) => allowedIds.has(id));
    return { ...item, sourceRefs,
      status: item.status === "reviewed" && (!item.summary.trim() || !sourceRefs.length)
        ? "needs_evidence" as const : item.status };
  });
  const issues = review.issues.filter((issue) => issue.kind !== "strength" || (
    (issue.sourceRefs || []).some((id) => allowedIds.has(id)) && !!issue.evidence?.trim() &&
    !!issue.criterion?.trim() && (issue.evidenceConfidence ?? issue.confidence) >= 0.55
  )).map((issue) => {
    const sourceRefs = (issue.sourceRefs || []).filter((id) => allowedIds.has(id));
    const featureTag = inferredFeature(issue);
    const observation = featureTag !== "none" ? observations.checks[featureTag] : null;
    const unverifiedFeature = observation !== null && observation.status !== "verified";
    const confirmedRegion = confirmedRegions.find((region) =>
      (featureTag !== "none" && region.featureTag === featureTag) || region.title.trim() === issue.title.trim());
    const confirmedBox = observation?.confirmedByUser && observation.bbox ? observation.bbox : confirmedRegion?.bbox;
    const unsupported = !sourceRefs.length || !issue.evidence?.trim() || !issue.criterion?.trim()
      || (issue.evidenceConfidence ?? issue.confidence) < 0.55;
    if (issue.kind === "issue" && (unverifiedFeature || unsupported)) {
      return { ...issue, featureTag, sourceRefs, ...(confirmedBox ? { bbox: confirmedBox, locationConfidence: 1, locationConfirmed: true, locationPinned: confirmedRegion?.pinned } : {}), kind: "clarity_request" as const, severity: "info" as const,
        scoreImpact: null, description: `${issue.description}（圖面證據或知識依據尚不足，暫不認定缺失。）`,
        cropRequest: { reason: unverifiedFeature ? "此要素在前置辨識中尚未確認。" : "缺少可核對的圖面證據或審查依據。",
          instructions: ["提供含文字、標高與周邊動線的清晰局部圖。"], reviewTargets: [issue.title] } };
    }
    return { ...issue, featureTag, sourceRefs,
      ...(confirmedBox ? { bbox: confirmedBox, locationConfidence: 1, locationConfirmed: true, locationPinned: confirmedRegion?.pinned } : {}) };
  });
  return { ...review, dimensions, coverage, issues, needsSupplement: issues.some((issue) => issue.kind === "clarity_request") };
}
