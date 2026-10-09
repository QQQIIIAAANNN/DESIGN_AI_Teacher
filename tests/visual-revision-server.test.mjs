import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { cropBounds } from "../lib/visual-revision.ts";
import { InputError, prepareMaskedEdit } from "../lib/visual-revision-server.ts";

async function png(width, height) {
  return sharp({ create: {
    width, height, channels: 3, background: "#f0f0eb"
  } }).png().toBuffer();
}

async function inputs(width, height, roi, cropSize) {
  const bounds = cropBounds(roi);
  const cropWidth = cropSize?.width ?? Math.max(1, Math.round(width * bounds.w));
  const cropHeight = cropSize?.height ?? Math.max(1, Math.round(height * bounds.h));
  const form = new FormData();
  form.set("context", new File([await png(width, height)], "context.png", { type: "image/png" }));
  form.set("crop", new File([await png(cropWidth, cropHeight)], "crop.png", { type: "image/png" }));
  return form;
}

async function checkMask(width, height, roi) {
  const form = await inputs(width, height, roi);
  const assets = await prepareMaskedEdit(form, roi);
  const frame = assets.frame;
  const expectedMask = await sharp(Buffer.from(await assets.mask.arrayBuffer()))
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const meta = await sharp(Buffer.from(await assets.mask.arrayBuffer())).metadata();
  const imageMeta = await sharp(Buffer.from(await assets.crop.arrayBuffer())).metadata();
  assert.equal(meta.width, frame.width);
  assert.equal(meta.height, frame.height);
  assert.equal(imageMeta.width, frame.width);
  assert.equal(imageMeta.height, frame.height);
  assert.equal(assets.size, frame.width + "x" + frame.height);

  const bounds = cropBounds(roi);
  const { left, top, width: contentWidth, height: contentHeight } = frame.content;
  const expected = {
    x0: Math.ceil(left + (roi.x - bounds.x0) / bounds.w * contentWidth),
    y0: Math.ceil(top + (roi.y - bounds.y0) / bounds.h * contentHeight),
    x1: Math.floor(left + (roi.x + roi.w - bounds.x0) / bounds.w * contentWidth),
    y1: Math.floor(top + (roi.y + roi.h - bounds.y0) / bounds.h * contentHeight)
  };
  const { data, info } = expectedMask;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  let cleared = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const alpha = data[(y * info.width + x) * info.channels + 3];
      assert.ok(alpha === 0 || alpha === 255, "mask must use binary alpha");
      if (alpha === 0) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x + 1);
        y1 = Math.max(y1, y + 1);
        cleared += 1;
      }
    }
  }
  assert.ok(cleared > 0, "edit area must be transparent");
  for (const edge of ["x0", "y0", "x1", "y1"]) {
    assert.ok(Math.abs(({ x0, y0, x1, y1 })[edge] - expected[edge]) <= 1, edge + " offset >1 px");
  }
  assert.equal(cleared, (x1 - x0) * (y1 - y0), "editable mask must be a solid rectangle");
}

test("server mask: landscape ROI matches the expected rectangle within 1 px", async () => {
  await checkMask(1200, 900, { x: 0.2, y: 0.25, w: 0.35, h: 0.3 });
});

test("server mask: portrait ROI matches the expected rectangle within 1 px", async () => {
  await checkMask(900, 1200, { x: 0.18, y: 0.2, w: 0.4, h: 0.35 });
});

test("server mask: ROI touching right and bottom image edges remains aligned", async () => {
  await checkMask(1200, 900, { x: 0.74, y: 0.72, w: 0.26, h: 0.28 });
});

test("server mask: crop aspect ratio inconsistent with full drawing is rejected", async () => {
  const roi = { x: 0.2, y: 0.25, w: 0.35, h: 0.3 };
  const form = await inputs(1200, 900, roi, { width: 900, height: 100 });
  await assert.rejects(prepareMaskedEdit(form, roi),
    (error) => error instanceof InputError && /長寬比/.test(error.message));
});

test("server mask: tiny selected crop reports a clear actionable error", async () => {
  const roi = { x: 0.49, y: 0.49, w: 0.02, h: 0.02 };
  const form = await inputs(1200, 900, roi);
  await assert.rejects(prepareMaskedEdit(form, roi),
    (error) => error instanceof InputError && /選取範圍太小，請放大框選範圍/.test(error.message));
});

test("server mask: invalid too-small normalized ROI is rejected", async () => {
  const roi = { x: 0.3, y: 0.3, w: 0.005, h: 0.3 };
  await assert.rejects(prepareMaskedEdit(new FormData(), roi), InputError);
});

test("server mask: full-image ROI with ineffective opaque boundary is rejected", async () => {
  const roi = { x: 0, y: 0, w: 1, h: 1 };
  const form = await inputs(1200, 900, roi);
  await assert.rejects(prepareMaskedEdit(form, roi),
    (error) => error instanceof InputError && /可編輯面積無效/.test(error.message));
});

test("server mask: invalid oversized normalized ROI is rejected", async () => {
  const roi = { x: 0.4, y: 0.2, w: 0.7, h: 0.3 };
  await assert.rejects(prepareMaskedEdit(new FormData(), roi), InputError);
});
