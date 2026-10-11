import test from "node:test";
import assert from "node:assert/strict";
import {
  validRevisionBbox, rankVisualRevisionIssues, revisionSelectionReason, createRevisionBrief, cropBounds, roiWithinCrop
} from "../lib/visual-revision.ts";

const box = { x: 0.2, y: 0.2, w: 0.3, h: 0.4 };
function issue(overrides = {}) {
  return {
    id: "design-001", kind: "issue", title: "入口廣場動線衝突",
    category: "配置與動線", severity: "medium", scoreImpact: -2,
    confidence: 0.9, visibilityStatus: "clear",
    description: "人流穿越活動區", suggestion: "調整主入口動線；設置植栽緩衝",
    bbox: { ...box }, ...overrides
  };
}

test("validRevisionBbox accepts normalized regions including exact edges", () => {
  assert.equal(validRevisionBbox(box), true);
  assert.equal(validRevisionBbox({ x: 0, y: 0, w: 1, h: 1 }), true);
  assert.equal(validRevisionBbox({ x: 0.8, y: 0.8, w: 0.2, h: 0.2 }), true);
});

test("validRevisionBbox rejects malformed and out-of-range geometry", () => {
  for (const invalid of [
    { x: -0.1, y: 0, w: 0.2, h: 0.2 },
    { x: 0, y: 0, w: 0.001, h: 0.1 },
    { x: 0.9, y: 0.4, w: 0.2, h: 0.3 },
    { x: 0, y: Infinity, w: 0.2, h: 0.2 },
    { x: NaN, y: 0, w: 0.2, h: 0.2 }
  ]) assert.equal(validRevisionBbox(invalid), false);
});

test("rankVisualRevisionIssues excludes non-visual and uncertain issues", () => {
  const items = [
    issue({ id: "scale", title: "比例尺標示問題", category: "動線", severity: "high" }),
    issue({ id: "missing", title: "缺立面圖", category: "配置", severity: "high" }),
    issue({ id: "clarity", kind: "clarity_request", title: "入口動線不明" }),
    issue({ id: "blind", visibilityStatus: "illegible" }),
    issue({ id: "bad-box", bbox: { x: 0.9, y: 0.9, w: 0.2, h: 0.2 } }),
    issue({ id: "valid" })
  ];
  assert.deepEqual(rankVisualRevisionIssues(items).map((i) => i.id), ["valid"]);
});

test("rankVisualRevisionIssues puts high-impact space planning first, max three", () => {
  const items = [
    issue({ id: "low", title: "鋪面層次", category: "景觀", severity: "low" }),
    issue({ id: "high", title: "主要入口廣場動線", severity: "high" }),
    issue({ id: "mid", title: "空間配置", severity: "medium" }),
    issue({ id: "detail", title: "門窗表現", severity: "medium" })
  ];
  const ranked = rankVisualRevisionIssues(items);
  assert.equal(ranked[0].id, "high");
  assert.equal(ranked.length, 3);
  assert.equal(new Set(ranked.map((i) => i.id)).size, 3);
});

test("createRevisionBrief keeps source meaning and explicit preserve constraints", () => {
  const brief = createRevisionBrief(issue());
  assert.equal(brief.problem, "人流穿越活動區");
  assert.equal(brief.designGoal, "入口廣場動線衝突");
  assert.deepEqual(brief.modifications, ["調整主入口動線", "設置植栽緩衝"]);
  assert.ok(brief.preserveConstraints.some((x) => x.includes("基地邊界")));
  assert.ok(brief.learningPoints.length > 0);
});

test("cropBounds adds context and clamps to image edges", () => {
  const result = cropBounds(box);
  assert.ok(result.x0 < box.x && result.y0 < box.y);
  assert.ok(result.x0 + result.w > box.x + box.w);
  assert.ok(result.y0 + result.h > box.y + box.h);
  const edge = cropBounds({ x: 0.98, y: 0, w: 0.02, h: 0.03 });
  assert.equal(edge.x0 + edge.w, 1);
  assert.equal(edge.y0, 0);
  assert.ok(edge.h > 0.03);
  assert.throws(() => cropBounds({ x: 0, y: 0, w: 1.2, h: 0.2 }));
});


test("high severity wins even if medium contains prominent design keywords", () => {
  const ranked = rankVisualRevisionIssues([
    issue({ id: "medium-keywords", title: "空間配置入口廣場動線失衡", severity: "medium", scoreImpact: -40 }),
    issue({ id: "high-no-keywords", title: "重大缺陷需修正", category: "其他問題", description: "嚴重衝突", suggestion: "修正主要衝突", severity: "high", scoreImpact: -1 })
  ]);
  assert.deepEqual(ranked.map((item) => item.id), ["high-no-keywords", "medium-keywords"]);
  assert.match(revisionSelectionReason(ranked[0]), /通關風險/);
});

test("presentation-only notes and low severity never enter design improvement candidates", () => {
  const ranked = rankVisualRevisionIssues([
    issue({ id: "low-notes", title: "整張圖面註記密集，快速辨讀較吃力", category: "空間配置", severity: "low" }),
    issue({ id: "high-layout", title: "配置線條過密，字跡不清晰", severity: "high" }),
    issue({ id: "medium-layout", title: "圖面版面設計標註密集", severity: "medium" }),
    issue({ id: "access", title: "道路寬度與基地條件不一致", category: "基地條件", severity: "medium" })
  ]);
  assert.deepEqual(ranked.map((item) => item.id), ["access"]);
});

test("scoreImpact magnitude decides within severity before evidence/location confidence", () => {
  const ranked = rankVisualRevisionIssues([
    issue({ id: "small", scoreImpact: -2, evidenceConfidence: 1, locationConfidence: 1 }),
    issue({ id: "large", scoreImpact: -9, evidenceConfidence: .1, locationConfidence: .1 }),
    issue({ id: "positive", scoreImpact: 6, evidenceConfidence: .9, locationConfidence: .9 }),
    issue({ id: "no-impact", scoreImpact: null, evidenceConfidence: 1, locationConfidence: 1 })
  ]);
  assert.deepEqual(ranked.map((item) => item.id), ["large", "positive", "small"]);
});

test("tie breakers prefer evidenceConfidence and then locationConfidence", () => {
  const ranked = rankVisualRevisionIssues([
    issue({ id: "less-evidence", scoreImpact: -3, evidenceConfidence: .4, locationConfidence: 1 }),
    issue({ id: "less-location", scoreImpact: -3, evidenceConfidence: .9, locationConfidence: .4 }),
    issue({ id: "more-location", scoreImpact: -3, evidenceConfidence: .9, locationConfidence: .8 })
  ]);
  assert.deepEqual(ranked.map((item) => item.id), ["more-location", "less-location", "less-evidence"]);
});

test("no high/medium candidate returns an empty list, never padding with low", () => {
  assert.deepEqual(rankVisualRevisionIssues([
    issue({ severity: "low" }), issue({ severity: "info" }),
    issue({ kind: "clarity_request", severity: "high" }),
    issue({ title: "版面圖面清晰度", severity: "high" })
  ]), []);
});

test("roiWithinCrop reconstructs the same normalized coordinates on normal, clamped and edge ROIs", () => {
  const examples = [
    { x: .2, y: .2, w: .3, h: .4 },
    { x: 0, y: 0, w: .4, h: .3 },
    { x: .78, y: .83, w: .22, h: .17 },
    { x: .975, y: .015, w: .025, h: .02 },
    { x: 0, y: .9, w: .018, h: .1 }
  ];
  for (const roi of examples) {
    const crop = cropBounds(roi), inside = roiWithinCrop(roi);
    for (const value of Object.values(inside)) assert.ok(value >= 0 && value <= 1);
    assert.ok(inside.x + inside.w <= 1 + 1e-10);
    assert.ok(inside.y + inside.h <= 1 + 1e-10);
    for (const [actual, wanted] of [
      [crop.x0 + inside.x * crop.w, roi.x], [crop.y0 + inside.y * crop.h, roi.y],
      [inside.w * crop.w, roi.w], [inside.h * crop.h, roi.h]
    ]) assert.ok(Math.abs(actual - wanted) < 1e-9, "ROI-to-crop mapping drift");
  }
  const nearEdge = roiWithinCrop({ x: 0, y: 0, w: .3, h: .2 });
  assert.equal(nearEdge.x, 0);
  assert.equal(nearEdge.y, 0);
  assert.throws(() => roiWithinCrop({ x: -.01, y: 0, w: .3, h: .2 }));
});
