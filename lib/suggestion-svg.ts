export type SuggestionRole = "wall" | "column" | "window" | "door" | "furniture" | "paving" | "planting" | "annotation";
export type SuggestionAction = "add" | "remove";
export type SuggestionElement = {
  type: "line" | "rect" | "circle" | "polyline" | "label";
  role: SuggestionRole;
  action: SuggestionAction;
  x: number; y: number;
  x2?: number; y2?: number;
  w?: number; h?: number; r?: number;
  points?: Array<[number, number]>;
  text?: string;
};
export type SuggestionPlan = { summary: string; elements: SuggestionElement[] };

const roles = new Set<SuggestionRole>(["wall", "column", "window", "door", "furniture", "paving", "planting", "annotation"]);
const types = new Set<SuggestionElement["type"]>(["line", "rect", "circle", "polyline", "label"]);
const colors: Record<SuggestionRole, string> = {
  wall: "#e23b36", column: "#b63234", window: "#028bb2", door: "#b95014",
  furniture: "#6542b1", paving: "#d47d00", planting: "#23804b", annotation: "#ad244b"
};
const coordinate = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
const escapeXml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export function normalizeSuggestionPlan(value: unknown): SuggestionPlan {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const raw = Array.isArray(row.elements) ? row.elements.slice(0, 30) : [];
  const elements = raw.flatMap((value): SuggestionElement[] => {
    if (!value || typeof value !== "object") return [];
    const entry = value as Record<string, unknown>;
    if (!types.has(entry.type as SuggestionElement["type"]) || !roles.has(entry.role as SuggestionRole)) return [];
    const x = coordinate(entry.x), y = coordinate(entry.y);
    if (x === null || y === null) return [];
    const type = entry.type as SuggestionElement["type"];
    const element: SuggestionElement = { type, role: entry.role as SuggestionRole,
      action: entry.action === "remove" ? "remove" : "add", x, y };
    if (type === "line") {
      const x2 = coordinate(entry.x2), y2 = coordinate(entry.y2);
      if (x2 === null || y2 === null) return [];
      element.x2 = x2; element.y2 = y2;
    } else if (type === "rect") {
      const w = coordinate(entry.w), h = coordinate(entry.h);
      if (w === null || h === null || w < 0.005 || h < 0.005) return [];
      element.w = Math.min(w, 1 - x); element.h = Math.min(h, 1 - y);
      if (element.w < 0.005 || element.h < 0.005) return [];
    } else if (type === "circle") {
      const r = coordinate(entry.r);
      if (r === null || r < 0.004) return [];
      element.r = Math.min(r, x, y, 1 - x, 1 - y);
      if (element.r < 0.004) return [];
    } else if (type === "polyline") {
      const points = Array.isArray(entry.points) ? entry.points.slice(0, 40).flatMap((point): Array<[number, number]> => {
        if (!Array.isArray(point) || point.length !== 2) return [];
        const px = coordinate(point[0]), py = coordinate(point[1]);
        return px === null || py === null ? [] : [[px, py]];
      }) : [];
      if (points.length < 2) return [];
      element.points = points;
    } else {
      const label = typeof entry.text === "string" ? entry.text.trim().slice(0, 48) : "";
      if (!label) return [];
      element.text = label;
    }
    return [element];
  });
  if (!elements.length) throw new Error("模型沒有產生可繪製的建築元素；請補上清楚的局部圖後再試。");
  return { summary: typeof row.summary === "string" ? row.summary.slice(0, 300) : "局部修改示意", elements };
}

export function renderSuggestionSvg(imageDataUrl: string, width: number, height: number, plan: SuggestionPlan, title: string) {
  if (!/^data:image\/png;base64,[a-z0-9+/=]+$/i.test(imageDataUrl)) throw new Error("局部圖格式無效。");
  const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
  const scale = Math.max(2, w / 260);
  const shapes = plan.elements.map((entry) => {
    const color = entry.action === "remove" ? "#9c47aa" : colors[entry.role];
    const dash = entry.action === "remove" ? ` stroke-dasharray="${scale * 2} ${scale}"` : "";
    const stroke = `stroke="${color}" stroke-width="${entry.role === "wall" ? scale * 2 : scale}" stroke-linecap="round" stroke-linejoin="round"${dash}`;
    const x = entry.x * w, y = entry.y * h;
    if (entry.type === "line") return `<line x1="${x}" y1="${y}" x2="${entry.x2! * w}" y2="${entry.y2! * h}" ${stroke}/>`;
    if (entry.type === "rect") return `<rect x="${x}" y="${y}" width="${entry.w! * w}" height="${entry.h! * h}" fill="${color}" fill-opacity="0.12" ${stroke}/>`;
    if (entry.type === "circle") return `<circle cx="${x}" cy="${y}" r="${entry.r! * Math.min(w, h)}" fill="${color}" fill-opacity="0.12" ${stroke}/>`;
    if (entry.type === "polyline") return `<polyline points="${entry.points!.map(([px, py]) => `${px * w},${py * h}`).join(" ")}" fill="none" ${stroke}/>`;
    return `<text x="${x}" y="${y}" fill="${color}" font-size="${scale * 5}" font-family="sans-serif" font-weight="700" paint-order="stroke" stroke="white" stroke-width="${scale}">${escapeXml(entry.text || "")}</text>`;
  }).join("\n");
  const footer = Math.max(62, Math.round(w / 12));
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${w} ${h + footer}" width="${w}" height="${h + footer}"><title>${escapeXml(title)}</title><rect width="${w}" height="${h + footer}" fill="#fff"/><image x="0" y="0" width="${w}" height="${h}" xlink:href="${imageDataUrl}"/><g>${shapes}</g><rect x="0" y="${h}" width="${w}" height="${footer}" fill="#17232a"/><text x="${scale * 3}" y="${h + footer * 0.38}" fill="white" font-size="${scale * 4}" font-family="sans-serif">${escapeXml(title.slice(0, 60))}</text><text x="${scale * 3}" y="${h + footer * 0.72}" fill="#ccd5d8" font-size="${scale * 2.5}" font-family="sans-serif">紅/彩色＝新增建議 · 紫色虛線＝移除建議 · 依原圖局部人工確認</text></svg>`;
}
