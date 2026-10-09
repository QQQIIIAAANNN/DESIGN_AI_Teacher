import test from "node:test";
import assert from "node:assert/strict";
import {
  validRevisionBbox, rankVisualRevisionIssues, createRevisionBrief, cropBounds
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
