export type SiteEdge = "north" | "east" | "south" | "west";
export type SiteFeatureKind = "tree" | "building" | "water" | "level";

export type PracticeSitePlan = {
  shape: "rectangle" | "trapezoid";
  southWidthM: number;
  northWidthM: number;
  depthM: number;
  roads: { edge: SiteEdge; widthM: number; name: string }[];
  contexts: { edge: SiteEdge; label: string }[];
  setbacks: { edge: SiteEdge; meters: number }[];
  features: { kind: SiteFeatureKind; x: number; y: number; label: string }[];
};

const edges: SiteEdge[] = ["north", "east", "south", "west"];
const edgeName: Record<SiteEdge, string> = { north: "北", east: "東", south: "南", west: "西" };
const featureKinds: SiteFeatureKind[] = ["tree", "building", "water", "level"];

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function bounded(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? Math.round(value * 100) / 100 : null;
}

function label(value: unknown, limit = 28): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function edge(value: unknown): SiteEdge | null {
  return edges.includes(value as SiteEdge) ? value as SiteEdge : null;
}

function uniqueByEdge<T extends { edge: SiteEdge }>(items: T[]): T[] {
  return items.filter((item, index) => items.findIndex((candidate) => candidate.edge === item.edge) === index);
}

export function normalizePracticeSitePlan(value: unknown): PracticeSitePlan {
  const input = object(value);
  if (!input || (input.shape !== "rectangle" && input.shape !== "trapezoid")) {
    throw new Error("模型未提供可繪製的基地形狀。");
  }
  const southWidthM = bounded(input.southWidthM, 20, 160);
  const northWidthM = input.shape === "rectangle" && input.northWidthM === undefined
    ? southWidthM : bounded(input.northWidthM, 20, 160);
  const depthM = bounded(input.depthM, 20, 160);
  if (!southWidthM || !northWidthM || !depthM ||
      (input.shape === "rectangle" && northWidthM !== southWidthM) ||
      northWidthM / southWidthM < 0.55 || northWidthM / southWidthM > 1.8) {
    throw new Error("基地尺寸或形狀不一致，請重新生成題目。");
  }
  const roads = uniqueByEdge((Array.isArray(input.roads) ? input.roads : []).slice(0, 4).flatMap((item) => {
    const row = object(item);
    const side = edge(row?.edge);
    const widthM = bounded(row?.widthM, 4, 50);
    return side && widthM ? [{ edge: side, widthM, name: label(row?.name, 18) || "計畫道路" }] : [];
  }));
  if (!roads.length || roads.length > 3) throw new Error("基地圖至少需要一側道路，且最多三側道路。");
  const contexts = uniqueByEdge((Array.isArray(input.contexts) ? input.contexts : []).slice(0, 4).flatMap((item) => {
    const row = object(item);
    const side = edge(row?.edge);
    const text = label(row?.label);
    return side && text ? [{ edge: side, label: text }] : [];
  }));
  const setbacks = uniqueByEdge((Array.isArray(input.setbacks) ? input.setbacks : []).slice(0, 4).flatMap((item) => {
    const row = object(item);
    const side = edge(row?.edge);
    const meters = bounded(row?.meters, 1, 15);
    return side && meters ? [{ edge: side, meters }] : [];
  }));
  const features = (Array.isArray(input.features) ? input.features : []).slice(0, 4).flatMap((item) => {
    const row = object(item);
    const kind = featureKinds.includes(row?.kind as SiteFeatureKind) ? row?.kind as SiteFeatureKind : null;
    const x = bounded(row?.x, 0.12, 0.88);
    const y = bounded(row?.y, 0.12, 0.88);
    const text = label(row?.label, 30);
    return kind && x !== null && y !== null && text ? [{ kind, x, y, label: text }] : [];
  });
  return { shape: input.shape, southWidthM, northWidthM, depthM, roads, contexts, setbacks, features };
}

export function practiceSiteConditions(site: PracticeSitePlan): string[] {
  const width = site.shape === "rectangle"
    ? `東西向面寬 ${site.southWidthM} 公尺`
    : `南側面寬 ${site.southWidthM} 公尺、北側面寬 ${site.northWidthM} 公尺`;
  const area = Math.round((site.southWidthM + site.northWidthM) / 2 * site.depthM);
  return [
    `基地為${site.shape === "rectangle" ? "矩形" : "梯形"}，${width}，南北向深度 ${site.depthM} 公尺，面積約 ${area} 平方公尺；基地圖上方為北。`,
    ...site.roads.map((road) => `基地${edgeName[road.edge]}側臨 ${road.widthM} 公尺${road.name}。`),
    ...site.contexts.map((context) => `基地${edgeName[context.edge]}側${site.roads.some((road) => road.edge === context.edge) ? "隔道路為" : "緊鄰"}${context.label}。`),
    ...site.setbacks.map((setback) => `本題指定基地${edgeName[setback.edge]}側沿地界退縮 ${setback.meters} 公尺，作為開放空間或步行緩衝。`),
    ...site.features.map((feature) => {
      const row = feature.y < 0.34 ? 0 : feature.y > 0.66 ? 2 : 1;
      const column = feature.x < 0.34 ? 0 : feature.x > 0.66 ? 2 : 1;
      const positions = [["西北", "北", "東北"], ["西", "中央", "東"], ["西南", "南", "東南"]];
      const position = positions[row][column];
      return `基地內${position}${position === "中央" ? "" : "側"}有${feature.label}。`;
    })
  ];
}

function xml(value: string | number): string {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char] || char);
}

function n(value: number): number { return Math.round(value * 10) / 10; }

export function renderPracticeSiteSvg(site: PracticeSitePlan): string {
  const scale = Math.min(440 / Math.max(site.northWidthM, site.southWidthM), 310 / site.depthM);
  const topY = 190;
  const bottomY = topY + site.depthM * scale;
  const centerX = 500;
  const northLeft = centerX - site.northWidthM * scale / 2;
  const northRight = centerX + site.northWidthM * scale / 2;
  const southLeft = centerX - site.southWidthM * scale / 2;
  const southRight = centerX + site.southWidthM * scale / 2;
  const minX = Math.min(northLeft, southLeft);
  const maxX = Math.max(northRight, southRight);
  const atY = (fraction: number) => ({
    y: topY + (bottomY - topY) * fraction,
    left: northLeft + (southLeft - northLeft) * fraction,
    right: northRight + (southRight - northRight) * fraction
  });
  const polygon = `${n(northLeft)},${n(topY)} ${n(northRight)},${n(topY)} ${n(southRight)},${n(bottomY)} ${n(southLeft)},${n(bottomY)}`;
  const roads = site.roads.map((road) => {
    const width = Math.max(36, Math.min(66, road.widthM * scale));
    if (road.edge === "north" || road.edge === "south") {
      const y = road.edge === "north" ? topY - width - 56 : bottomY + 56;
      return `<g><rect x="${n(minX - 38)}" y="${n(y)}" width="${n(maxX - minX + 76)}" height="${n(width)}" fill="#f0f0f0" stroke="#222" stroke-width="1.4"/><line x1="${n(minX - 25)}" x2="${n(maxX + 25)}" y1="${n(y + width / 2)}" y2="${n(y + width / 2)}" stroke="#888" stroke-dasharray="13 9"/><rect x="${n(centerX - 100)}" y="${n(y + width / 2 - 12)}" width="200" height="24" fill="#fff"/><text x="500" y="${n(y + width / 2 + 5)}" text-anchor="middle" class="road">${xml(road.name)}　${road.widthM} m</text></g>`;
    }
    const x = road.edge === "west" ? minX - width - 62 : maxX + 62;
    return `<g><rect x="${n(x)}" y="${n(topY - 32)}" width="${n(width)}" height="${n(bottomY - topY + 64)}" fill="#f0f0f0" stroke="#222" stroke-width="1.4"/><line x1="${n(x + width / 2)}" x2="${n(x + width / 2)}" y1="${n(topY - 22)}" y2="${n(bottomY + 22)}" stroke="#888" stroke-dasharray="13 9"/><g transform="translate(${n(x + width / 2)} ${n((topY + bottomY) / 2)}) rotate(-90)"><rect x="-100" y="-12" width="200" height="24" fill="#fff"/><text text-anchor="middle" y="5" class="road">${xml(road.name)}　${road.widthM} m</text></g></g>`;
  }).join("");
  const setbacks = site.setbacks.map((setback) => {
    const inset = Math.min(48, setback.meters * scale);
    if (setback.edge === "north" || setback.edge === "south") {
      const y = setback.edge === "north" ? topY + inset : bottomY - inset;
      const t = (y - topY) / (bottomY - topY);
      const span = atY(t);
      return `<line x1="${n(span.left + 8)}" x2="${n(span.right - 8)}" y1="${n(y)}" y2="${n(y)}" class="setback"/>`;
    }
    const start = atY(0.04);
    const end = atY(0.96);
    const west = setback.edge === "west";
    return `<line x1="${n((west ? start.left : start.right) + (west ? inset : -inset))}" y1="${n(start.y)}" x2="${n((west ? end.left : end.right) + (west ? inset : -inset))}" y2="${n(end.y)}" class="setback"/>`;
  }).join("");
  const features = site.features.map((feature, index) => {
    const span = atY(feature.y);
    const x = span.left + (span.right - span.left) * feature.x;
    const y = span.y;
    const symbol = feature.kind === "tree"
      ? `<circle cx="${n(x)}" cy="${n(y)}" r="17" fill="#fff" stroke="#111" stroke-width="1.5"/><circle cx="${n(x)}" cy="${n(y)}" r="9" fill="none" stroke="#555"/>`
      : feature.kind === "building"
        ? `<rect x="${n(x - 21)}" y="${n(y - 14)}" width="42" height="28" fill="url(#hatch)" stroke="#111" stroke-width="1.5"/>`
        : feature.kind === "water"
          ? `<path d="M${n(x - 23)} ${n(y - 7)} q8 -6 16 0 t16 0 t16 0 M${n(x - 23)} ${n(y + 3)} q8 -6 16 0 t16 0 t16 0" fill="none" stroke="#333" stroke-width="1.5"/>`
          : `<path d="M${n(x)} ${n(y - 20)} v34 m-7 -8 7 8 7 -8" fill="none" stroke="#111" stroke-width="1.6"/>`;
    return `<g>${symbol}<circle cx="${n(x + 23)}" cy="${n(y - 18)}" r="10" fill="#fff" stroke="#111"/><text x="${n(x + 23)}" y="${n(y - 14)}" text-anchor="middle" class="index">${index + 1}</text></g>`;
  }).join("");
  const contexts = site.contexts.map((context) => {
    const text = xml(context.label);
    const hasRoad = site.roads.some((road) => road.edge === context.edge);
    if (context.edge === "north") return `<text x="500" y="${n(topY - (hasRoad ? 135 : 75))}" text-anchor="middle" class="context">${text}</text>`;
    if (context.edge === "south") return `<text x="500" y="${n(bottomY + (hasRoad ? 133 : 90))}" text-anchor="middle" class="context">${text}</text>`;
    if (context.edge === "west") return `<text x="${n(minX - (hasRoad ? 152 : 100))}" y="${n((topY + bottomY) / 2 - 26)}" text-anchor="middle" class="context">${text}</text>`;
    return `<text x="${n(maxX + (hasRoad ? 152 : 100))}" y="${n((topY + bottomY) / 2 - 26)}" text-anchor="middle" class="context">${text}</text>`;
  }).join("");
  const legend = [
    ...site.features.map((feature, index) => `${index + 1}　${feature.label}`),
    ...site.setbacks.map((setback) => `${edgeName[setback.edge]}側退縮 ${setback.meters} m（虛線）`)
  ].slice(0, 8).map((entry, index) => `<text x="${index < 4 ? 60 : 510}" y="${711 + index % 4 * 22}" class="legend">${xml(entry)}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 850" role="img" aria-label="基地條件示意圖，北方朝上">
<defs><pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line y2="8" stroke="#aaa"/></pattern></defs>
<style>text{font-family:'Noto Sans TC','Microsoft JhengHei',sans-serif;fill:#171717}.title{font-size:25px;font-weight:700}.subtitle,.legend{font-size:15px}.road{font-size:16px;font-weight:600}.context{font-size:15px}.dimension{font-size:15px;font-weight:600}.index{font-size:11px;font-weight:700}.setback{stroke:#333;stroke-width:1.6;stroke-dasharray:8 6}</style>
<rect width="1000" height="850" fill="#fff"/><rect x="26" y="22" width="948" height="806" fill="none" stroke="#222" stroke-width="1.5"/>
<text x="60" y="67" class="title">基地條件示意圖</text><text x="60" y="94" class="subtitle">圖上方為北 · 單位：公尺</text>
<g transform="translate(866 74)"><text x="0" y="0" text-anchor="middle" class="title">N</text><path d="M0 12 L-11 48 L0 40 L11 48 Z" fill="#111"/><line y1="40" y2="77" stroke="#111" stroke-width="2"/></g>
${roads}${contexts}
<polygon points="${polygon}" fill="#fff" stroke="#111" stroke-width="3"/>
${setbacks}${features}
<text x="500" y="${n((topY + bottomY) / 2 + 8)}" text-anchor="middle" class="subtitle">設計基地</text>
<line x1="${n(northLeft)}" x2="${n(northRight)}" y1="${n(topY - 17)}" y2="${n(topY - 17)}" stroke="#111"/><text x="500" y="${n(topY - 25)}" text-anchor="middle" class="dimension">${site.northWidthM} m</text>
<line x1="${n(southLeft)}" x2="${n(southRight)}" y1="${n(bottomY + 17)}" y2="${n(bottomY + 17)}" stroke="#111"/><text x="500" y="${n(bottomY + 38)}" text-anchor="middle" class="dimension">${site.southWidthM} m</text>
<line x1="${n(minX - 18)}" x2="${n(minX - 18)}" y1="${n(topY)}" y2="${n(bottomY)}" stroke="#111"/><text x="${n(minX - 27)}" y="${n((topY + bottomY) / 2)}" transform="rotate(-90 ${n(minX - 27)} ${n((topY + bottomY) / 2)})" text-anchor="middle" class="dimension">${site.depthM} m</text>
<line x1="60" y1="678" x2="940" y2="678" stroke="#bbb"/>${legend}
<text x="60" y="811" class="subtitle">新編練習題 · 非官方試題 · 圖面示意，標註尺寸與題目文字為準</text></svg>`;
}
