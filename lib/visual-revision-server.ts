import sharp from "sharp";
import type { NormalizedBBox } from "./review-schema";
import { cropBounds, validRevisionBbox } from "./visual-revision.ts";

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PIXELS = 10_000_000;

async function validatePng(file: FormDataEntryValue | null, name: string) {
  if (!(file instanceof File) || file.type !== "image/png" || file.size < 100 || file.size > MAX_BYTES) {
    throw new InputError(name + " 必須是 8 MB 以下的 PNG 圖片。");
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const info = await sharp(buffer, { limitInputPixels: MAX_PIXELS }).metadata().catch(() => {
    throw new InputError(name + " 的圖片內容無法辨識或尺寸過大。");
  });
  if (info.format !== "png" || !info.width || !info.height) {
    throw new InputError(name + " 的圖片內容不是有效 PNG。");
  }
  if ((info.width < 64 || info.height < 64) && name === "局部裁圖") {
    throw new InputError("選取範圍太小，請放大框選範圍。");
  }
  if (info.width < 64 || info.height < 64 || info.width > 4096 || info.height > 4096 ||
      info.width * info.height > MAX_PIXELS) {
    throw new InputError(name + " 的圖片尺寸超出允許範圍（64–4096px，最多一千萬像素）。");
  }
  return { buffer, width: info.width, height: info.height };
}

export type ImageEditFrame = {
  width: number;
  height: number;
  content: { left: number; top: number; width: number; height: number };
};

function outputSize(ratio: number) {
  if (ratio > 1.15) return { width: 1536, height: 1024, size: "1536x1024" };
  if (ratio < 0.87) return { width: 1024, height: 1536, size: "1024x1536" };
  return { width: 1024, height: 1024, size: "1024x1024" };
}

/** Cropping still comes from the browser; the edit mask never does. */
export async function prepareMaskedEdit(form: FormData, roi: NormalizedBBox) {
  if (!validRevisionBbox(roi)) throw new InputError("ROI 範圍無效，請重新框選。");
  const [crop, context] = await Promise.all([
    validatePng(form.get("crop"), "局部裁圖"),
    validatePng(form.get("context"), "全圖定位")
  ]);

  const bounds = cropBounds(roi);
  const expectedRatio = bounds.w * context.width / (bounds.h * context.height);
  const actualRatio = crop.width / crop.height;
  if (!Number.isFinite(expectedRatio) || Math.abs(Math.log(actualRatio / expectedRatio)) > 0.04) {
    throw new InputError("局部裁圖的長寬比與 ROI、全圖定位資訊不符，請重新確認位置。");
  }

  const target = outputSize(actualRatio);
  const factor = Math.min(target.width / crop.width, target.height / crop.height);
  const contentWidth = Math.min(target.width, Math.max(1, Math.round(crop.width * factor)));
  const contentHeight = Math.min(target.height, Math.max(1, Math.round(crop.height * factor)));
  const left = Math.floor((target.width - contentWidth) / 2);
  const top = Math.floor((target.height - contentHeight) / 2);
  const frame: ImageEditFrame = {
    width: target.width, height: target.height,
    content: { left, top, width: contentWidth, height: contentHeight }
  };

  const x0 = Math.max(0, Math.ceil(left + (roi.x - bounds.x0) / bounds.w * contentWidth));
  const y0 = Math.max(0, Math.ceil(top + (roi.y - bounds.y0) / bounds.h * contentHeight));
  const x1 = Math.min(target.width, Math.floor(left + (roi.x + roi.w - bounds.x0) / bounds.w * contentWidth));
  const y1 = Math.min(target.height, Math.floor(top + (roi.y + roi.h - bounds.y0) / bounds.h * contentHeight));
  const editableRatio = (x1 - x0) * (y1 - y0) / (target.width * target.height);
  if (x1 <= x0 || y1 <= y0 || editableRatio < 0.005 || editableRatio >= 0.95) {
    throw new InputError("ROI 遮罩可編輯面積無效，請重新框選。");
  }

  const editedBase = await sharp(crop.buffer)
    .resize(contentWidth, contentHeight, { fit: "fill" })
    .extend({ left, top, right: target.width - contentWidth - left,
      bottom: target.height - contentHeight - top, background: "#ffffff" })
    .png().toBuffer();

  const pixels = Buffer.alloc(target.width * target.height * 4);
  for (let index = 3; index < pixels.length; index += 4) pixels[index] = 255;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) pixels[(y * target.width + x) * 4 + 3] = 0;
  }
  const mask = await sharp(pixels, { raw: {
    width: target.width, height: target.height, channels: 4
  } }).png().toBuffer();

  return {
    frame, size: target.size,
    crop: new File([editedBase], "revision-crop.png", { type: "image/png" }),
    context: new File([context.buffer], "revision-context.png", { type: "image/png" }),
    mask: new File([mask], "revision-mask.png", { type: "image/png" })
  };
}
