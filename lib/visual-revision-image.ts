import type { NormalizedBBox } from "./review-schema";
import { cropBounds } from "./visual-revision";

/** Browser-only drawing helpers. The server owns mask creation. */
async function imageFromUrl(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

async function canvasFile(canvas: HTMLCanvasElement, name: string): Promise<File> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("無法輸出 PNG 圖片。")), "image/png");
  });
  return new File([blob], name, { type: "image/png" });
}

function renderCrop(image: HTMLImageElement, box: NormalizedBBox, maxSize: number) {
  const bounds = cropBounds(box);
  const sx = bounds.x0 * image.naturalWidth;
  const sy = bounds.y0 * image.naturalHeight;
  const sw = bounds.w * image.naturalWidth;
  const sh = bounds.h * image.naturalHeight;
  const scale = Math.min(1, maxSize / Math.max(sw, sh));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("無法建立局部圖。");
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function cropPreview(imageUrl: string, box: NormalizedBBox): Promise<string> {
  return renderCrop(await imageFromUrl(imageUrl), box, 1000).toDataURL("image/png");
}

export async function prepareEditAssets(imageUrl: string, roi: NormalizedBBox) {
  const image = await imageFromUrl(imageUrl);
  const crop = renderCrop(image, roi, 1280);
  const context = document.createElement("canvas");
  const scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
  context.width = Math.max(1, Math.round(image.naturalWidth * scale));
  context.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const ctx = context.getContext("2d");
  if (!ctx) throw new Error("無法建立全圖定位參考。");
  ctx.drawImage(image, 0, 0, context.width, context.height);
  ctx.strokeStyle = "#d65b42";
  ctx.lineWidth = Math.max(2, Math.min(context.width, context.height) / 200);
  ctx.setLineDash([10, 6]);
  ctx.strokeRect(roi.x * context.width, roi.y * context.height, roi.w * context.width, roi.h * context.height);
  const [cropFile, contextFile] = await Promise.all([
    canvasFile(crop, "revision-crop.png"),
    canvasFile(context, "revision-context.png")
  ]);
  return { cropFile, contextFile, preview: crop.toDataURL("image/png") };
}

export type EditFrame = {
  width: number;
  height: number;
  content: { left: number; top: number; width: number; height: number };
};

/** Never trust a generated image outside the ROI. Composite only inside an integer-aligned clip. */
export async function compositeWithinRoi(
  originalCrop: string, generated: string, roi: NormalizedBBox, frame: EditFrame
): Promise<string> {
  const [original, edited] = await Promise.all([imageFromUrl(originalCrop), imageFromUrl(generated)]);
  if (edited.naturalWidth !== frame.width || edited.naturalHeight !== frame.height) {
    throw new Error("生成圖片尺寸與要求不符，無法安全合成。");
  }
  const { left, top, width, height } = frame.content;
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0 ||
      left < 0 || top < 0 || left + width > frame.width || top + height > frame.height) {
    throw new Error("生成圖片的位置資訊無效。");
  }
  const bounds = cropBounds(roi);
  const canvas = document.createElement("canvas");
  canvas.width = original.naturalWidth;
  canvas.height = original.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("無法合成改圖結果。");
  ctx.drawImage(original, 0, 0);
  const x0 = Math.ceil((roi.x - bounds.x0) / bounds.w * canvas.width);
  const y0 = Math.ceil((roi.y - bounds.y0) / bounds.h * canvas.height);
  const x1 = Math.floor((roi.x + roi.w - bounds.x0) / bounds.w * canvas.width);
  const y1 = Math.floor((roi.y + roi.h - bounds.y0) / bounds.h * canvas.height);
  if (x1 <= x0 || y1 <= y0) throw new Error("ROI 範圍太小，無法安全合成。");
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, x1 - x0, y1 - y0);
  ctx.clip();
  ctx.drawImage(edited, left, top, width, height, 0, 0, canvas.width, canvas.height);
  ctx.restore();
  return canvas.toDataURL("image/png");
}
