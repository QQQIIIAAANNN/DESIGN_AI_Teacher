export type SiteEdge = "north" | "east" | "south" | "west";
export type SiteFeatureKind = "tree" | "building" | "water" | "level";
export const siteBuildingFootprints = ["rectangle", "l_shape", "chamfered", "irregular", "u_shape"] as const;
export type SiteBuildingFootprint = typeof siteBuildingFootprints[number];
export const siteBuildingFootprintLabels: Record<SiteBuildingFootprint, string> = {
  rectangle: "矩形", l_shape: "L 形", chamfered: "切角形", irregular: "不規則形", u_shape: "ㄇ字形"
};
export const siteShapes = ["rectangle", "trapezoid", "l_shape", "chamfered", "irregular"] as const;
export type SiteShape = typeof siteShapes[number];
export const siteShapeLabels: Record<SiteShape, string> = {
  rectangle: "矩形", trapezoid: "梯形", l_shape: "L 形", chamfered: "切角基地", irregular: "不規則多邊形"
};
export type PracticeSitePlan = {
  shape: SiteShape;
  southWidthM: number;
  northWidthM: number;
  depthM: number;
  /** North bearing, clockwise from drawing top. Legacy files default to 0. */
  northAngleDeg?: number;
  roads: { edge: SiteEdge; segmentIndex?: number; widthM: number; name: string }[];
  contexts: { edge: SiteEdge; segmentIndex?: number; label: string; floors?: number; heightM?: number; impact?: string; footprintShape: SiteBuildingFootprint }[];
  setbacks: { edge: SiteEdge; segmentIndex?: number; meters: number }[];
  features: { kind: SiteFeatureKind; x: number; y: number; label: string; footprintShape?: SiteBuildingFootprint; widthM?: number; depthM?: number; rotationDeg?: number }[];
};
type Point = { x: number; y: number };
const edges: SiteEdge[] = ["north", "east", "south", "west"];
const diagramEdge: Record<SiteEdge, string> = { north: "圖上", east: "圖右", south: "圖下", west: "圖左" };
const kinds: SiteFeatureKind[] = ["tree", "building", "water", "level"];
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function bounded(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? Math.round(value * 100) / 100 : null;
}
function label(value: unknown, limit = 80) { return typeof value === "string" ? value.trim().slice(0, limit) : ""; }
function edge(value: unknown) { return edges.includes(value as SiteEdge) ? value as SiteEdge : null; }

/** Clockwise polygon in metres. Dimensions, area and drawing share these vertices. */
export function practiceSiteVertices(site: PracticeSitePlan): Point[] {
  const w = Math.max(site.northWidthM, site.southWidthM), d = site.depthM;
  const presets: Record<SiteShape, number[][]> = {
    rectangle: [[0,0],[1,0],[1,1],[0,1]],
    trapezoid: [[(w-site.northWidthM)/2/w,0],[(w+site.northWidthM)/2/w,0],[(w+site.southWidthM)/2/w,1],[(w-site.southWidthM)/2/w,1]],
    l_shape: [[0,0],[.6,0],[.6,.4],[1,.4],[1,1],[0,1]],
    chamfered: [[.18,0],[1,0],[1,.82],[.82,1],[0,1],[0,.18]],
    irregular: [[.12,0],[.85,.06],[1,.55],[.72,1],[0,.85]]
  };
  return presets[site.shape].map(([x,y]) => ({ x:x*w, y:y*d }));
}
export function practiceSiteArea(site: PracticeSitePlan) {
  const points = practiceSiteVertices(site);
  return Math.abs(points.reduce((sum,a,i) => {
    const b=points[(i+1)%points.length]; return sum+a.x*b.y-b.x*a.y;
  },0))/2;
}
export function practiceSiteBoundaries(site: PracticeSitePlan) {
  const points = practiceSiteVertices(site);
  return points.map((a, index) => {
    const b = points[(index + 1) % points.length], dx = b.x-a.x, dy = b.y-a.y, length = Math.hypot(dx,dy);
    const edge: SiteEdge = Math.abs(dx/Math.max(site.northWidthM,site.southWidthM))>=Math.abs(dy/site.depthM) ? dx>0?"north":"south" : dy>0?"east":"west";
    return { index, a, b, length, edge, normal: {x:dy/length,y:-dx/length} };
  });
}
export function practiceBoundaryFor(site: PracticeSitePlan, item: {edge: SiteEdge; segmentIndex?: number}) {
  const boundaries=practiceSiteBoundaries(site);
  if (item.segmentIndex!==undefined) return boundaries[item.segmentIndex];
  // Legacy side-only data attaches to the longest boundary facing that side.
  return boundaries.filter((b)=>b.edge===item.edge).sort((a,b)=>b.length-a.length)[0];
}
function uniqueBoundaries<T extends {edge:SiteEdge;segmentIndex?:number}>(items:T[],site:PracticeSitePlan) {
  return items.filter((item,i)=>items.findIndex(other=>practiceBoundaryFor(site,other)?.index===practiceBoundaryFor(site,item)?.index)===i);
}
export function practiceSiteBoundaryCount(shape: SiteShape) {
  const vertices=practiceSiteVertices({shape,southWidthM:80,northWidthM:80,depthM:60,roads:[],contexts:[],setbacks:[],features:[]});
  return vertices.length;
}
/** A new generated plan must describe every polygon boundary so no side is visually or verbally ambiguous. */
export function practiceSiteCoverageComplete(site:PracticeSitePlan) {
  const boundaries=practiceSiteBoundaries(site);
  if(site.contexts.length!==boundaries.length)return false;
  const contextSegments=site.contexts.map(c=>practiceBoundaryFor(site,c)?.index);
  if(new Set(contextSegments).size!==boundaries.length||boundaries.some(b=>!contextSegments.includes(b.index)))return false;
  if(site.contexts.some(c=>!c.label||!c.floors||!c.heightM||!c.impact?.trim()||!siteBuildingFootprints.includes(c.footprintShape)))return false;
  const roadSegments=site.roads.map(r=>practiceBoundaryFor(site,r)?.index);
  return new Set(roadSegments).size===site.roads.length&&site.contexts.every(c=>{
    const boundary=practiceBoundaryFor(site,c);
    const road=site.roads.find(r=>practiceBoundaryFor(site,r)?.index===boundary.index);
    return road ? Boolean(c.impact?.trim()) : true;
  });
}
const footprintVertices: Record<SiteBuildingFootprint, number[][]> = {
  rectangle: [[.08,.12],[.92,.12],[.92,.88],[.08,.88]],
  l_shape: [[.08,.12],[.92,.12],[.92,.42],[.48,.42],[.48,.88],[.08,.88]],
  chamfered: [[.22,.12],[.82,.12],[.92,.24],[.92,.76],[.82,.88],[.08,.88],[.08,.24]],
  irregular: [[.18,.12],[.78,.16],[.92,.48],[.73,.86],[.18,.77],[.08,.34]],
  u_shape: [[.08,.12],[.92,.12],[.92,.88],[.67,.88],[.67,.42],[.33,.42],[.33,.88],[.08,.88]]
};
function buildingFootprint(center:Point,width:number,depth:number,shape:SiteBuildingFootprint,rotationDeg=0):Point[] {
  const angle=rotationDeg*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle);
  return footprintVertices[shape].map(([x,y])=>{
    const lx=(x-.5)*width,ly=(y-.5)*depth;
    return {x:center.x+lx*cos-ly*sin,y:center.y+lx*sin+ly*cos};
  });
}
function offset(p:Point, normal:Point, distance:number):Point { return {x:p.x+normal.x*distance,y:p.y+normal.y*distance}; }
function intersect(a:Point, b:Point, c:Point, d:Point) {
  const ux=b.x-a.x,uy=b.y-a.y,vx=d.x-c.x,vy=d.y-c.y,den=ux*vy-uy*vx;
  if(Math.abs(den)<1e-8)return b;
  const t=((c.x-a.x)*vy-(c.y-a.y)*vx)/den;
  return {x:a.x+t*ux,y:a.y+t*uy};
}
/** True-width strips parallel to the actual boundary, with shared road corners. */
export function practiceRoadBands(site: PracticeSitePlan) {
  const boundaries=practiceSiteBoundaries(site);
  const widths=boundaries.map(b=>site.roads.find(r=>practiceBoundaryFor(site,r)?.index===b.index)?.widthM||0);
  const outer=boundaries.map((b,i)=>{
    const j=(i+boundaries.length-1)%boundaries.length,previous=boundaries[j];
    return intersect(offset(previous.a,previous.normal,widths[j]),offset(previous.b,previous.normal,widths[j]),
      offset(b.a,b.normal,widths[i]),offset(b.b,b.normal,widths[i]));
  });
  return site.roads.map(road=>{
    const boundary=practiceBoundaryFor(site,road);
    return {road,boundary,points:[boundary.a,boundary.b,outer[(boundary.index+1)%outer.length],outer[boundary.index]]};
  });
}
export function siteBoundaryLabel(site: PracticeSitePlan, item:{edge:SiteEdge;segmentIndex?:number}) {
  const b=practiceBoundaryFor(site,item);
  const bearing=(Math.atan2(b.normal.x,-b.normal.y)*180/Math.PI-(site.northAngleDeg||0)+720)%360;
  const cardinal=["北","東北","東","東南","南","西南","西","西北"][Math.round(bearing/45)%8];
  return `地界 ${String.fromCharCode(65+b.index)}–${String.fromCharCode(65+(b.index+1)%practiceSiteVertices(site).length)}（${diagramEdge[item.edge]}側，約${cardinal}向）`;
}
function inside(p: Point, polygon: Point[]) {
  let result=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
    const a=polygon[i],b=polygon[j];
    if((a.y>p.y)!==(b.y>p.y) && p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) result=!result;
  }
  return result;
}
function featurePoint(site: PracticeSitePlan, feature: {x:number;y:number}): Point {
  const w=Math.max(site.northWidthM,site.southWidthM);
  // Preserve the interpolation of legacy trapezoid files.
  const span=site.northWidthM+(site.southWidthM-site.northWidthM)*feature.y;
  return {x:site.shape==="trapezoid"?(w-span)/2+span*feature.x:w*feature.x,y:site.depthM*feature.y};
}
export function siteEdgeLabel(site: PracticeSitePlan, side: SiteEdge) {
  const bearing=(edges.indexOf(side)*90-(site.northAngleDeg||0)+360)%360;
  const cardinal=["北","東北","東","東南","南","西南","西","西北"][Math.round(bearing/45)%8];
  return `${diagramEdge[side]}側（約${cardinal}側）`;
}
export function normalizePracticeSitePlan(value: unknown): PracticeSitePlan {
  const input=object(value);
  if(!input||!siteShapes.includes(input.shape as SiteShape)) throw new Error("模型未提供可繪製的基地形狀。");
  const shape=input.shape as SiteShape;
  const southWidthM=bounded(input.southWidthM,20,160);
  const northWidthM=shape==="rectangle"&&input.northWidthM===undefined?southWidthM:bounded(input.northWidthM,20,160);
  const depthM=bounded(input.depthM,20,160);
  const northAngleDeg=input.northAngleDeg===undefined?0:bounded(input.northAngleDeg,0,359);
  if(!southWidthM||!northWidthM||!depthM||northAngleDeg===null||
    (shape!=="trapezoid"&&northWidthM!==southWidthM)||northWidthM/southWidthM<.55||northWidthM/southWidthM>1.8)
    throw new Error("基地尺寸或指北角度不一致，請重新生成題目。");
  const geometry={shape,southWidthM,northWidthM,depthM} as PracticeSitePlan;
  const segment=(row:Record<string,unknown>|null)=>{
    if(row?.segmentIndex===undefined)return undefined;
    const index=row.segmentIndex;
    if(typeof index!=="number"||!Number.isInteger(index)||!practiceSiteBoundaries(geometry)[index])
      throw new Error("道路或鄰地指定的地界線段不存在。");
    return index;
  };
  const resolvedSide=(row:Record<string,unknown>|null)=>{
    const segmentIndex=segment(row);
    const segmentSide=segmentIndex===undefined?undefined:practiceSiteBoundaries(geometry)[segmentIndex].edge;
    const suppliedSide=edge(row?.edge);
    if(segmentSide&&suppliedSide&&segmentSide!==suppliedSide) throw new Error("指定的地界線段與邊別不一致，請依圖面線段修正。");
    return {segmentIndex,side:segmentSide||suppliedSide};
  };
  const roads=uniqueBoundaries((Array.isArray(input.roads)?input.roads:[]).slice(0,6).flatMap(item=>{
    const row=object(item),resolved=resolvedSide(row),widthM=bounded(row?.widthM,4,50);
    return resolved.side&&widthM?[{edge:resolved.side,segmentIndex:resolved.segmentIndex,widthM,name:label(row?.name,18).replace(/^\d+(?:\.\d+)?\s*(?:公尺|米|m)\s*/i, "")||"計畫道路"}]:[];
  }),geometry);
  if(!roads.length||roads.length>3) throw new Error("基地圖需要一至三側道路。");
  const contexts=uniqueBoundaries((Array.isArray(input.contexts)?input.contexts:[]).slice(0,6).flatMap(item=>{
    const row=object(item),resolved=resolvedSide(row),text=label(row?.label,36);
    const floors=row?.floors===undefined?undefined:bounded(row.floors,1,40);
    const heightM=row?.heightM===undefined?undefined:bounded(row.heightM,3,150);
    if(floors===null||heightM===null||(floors!==undefined&&!Number.isInteger(floors))) throw new Error("周邊量體樓層或高度不完整。");
    const boundaryIndex=resolved.segmentIndex??(resolved.side?practiceSiteBoundaries(geometry).filter(b=>b.edge===resolved.side).sort((a,b)=>b.length-a.length)[0]?.index:undefined);
    const shapeIndex=siteBuildingFootprints.includes(row?.footprintShape as SiteBuildingFootprint)
      ?siteBuildingFootprints.indexOf(row!.footprintShape as SiteBuildingFootprint)
      :((boundaryIndex||0)+(northAngleDeg||0)/45)%siteBuildingFootprints.length;
    const footprintShape=siteBuildingFootprints[Math.floor(shapeIndex)];
    return resolved.side&&text?[{edge:resolved.side,segmentIndex:resolved.segmentIndex,label:text,floors,heightM,impact:label(row?.impact,160)||undefined,footprintShape}]:[];
  }),geometry);
  const setbacks=uniqueBoundaries((Array.isArray(input.setbacks)?input.setbacks:[]).slice(0,6).flatMap(item=>{
    const row=object(item),resolved=resolvedSide(row),meters=bounded(row?.meters,1,15);
    if(meters&&meters*2>=Math.min(northWidthM,southWidthM,depthM)) throw new Error("退縮過大，無法形成合理可建築範圍。");
    return resolved.side&&meters?[{edge:resolved.side,segmentIndex:resolved.segmentIndex,meters}]:[];
  }),geometry);
  const features=(Array.isArray(input.features)?input.features:[]).slice(0,4).flatMap(item=>{
    const row=object(item),kind=kinds.includes(row?.kind as SiteFeatureKind)?row?.kind as SiteFeatureKind:null;
    const x=bounded(row?.x,.12,.88),y=bounded(row?.y,.12,.88),text=label(row?.label,60);
    if(!kind||x===null||y===null||!text)return [];
    const rawFootprint=row?.footprintShape;
    const widthM=row?.widthM===undefined?undefined:bounded(row.widthM,4,40);
    const depthM=row?.depthM===undefined?undefined:bounded(row.depthM,4,40);
    const rotationDeg=row?.rotationDeg===undefined?0:bounded(row.rotationDeg,0,359);
    if(widthM===null||depthM===null||rotationDeg===null)throw new Error("基地內既有建築的外框尺寸或角度無效。");
    const footprintShape=siteBuildingFootprints.includes(rawFootprint as SiteBuildingFootprint)?rawFootprint as SiteBuildingFootprint:undefined;
    if(kind==="building"&&(footprintShape||widthM!==undefined||depthM!==undefined)&&(!footprintShape||widthM===undefined||depthM===undefined))
      throw new Error("基地內既有建築須完整提供外框形狀、寬度及深度。");
    return [{kind,x,y,label:text,...(footprintShape?{footprintShape,widthM,depthM,rotationDeg}: {})}];
  });
  const site: PracticeSitePlan={shape,southWidthM,northWidthM,depthM,northAngleDeg,roads,contexts,setbacks,features};
  if(features.some(f=>!inside(featurePoint(site,f),practiceSiteVertices(site)))) throw new Error("基地原有物落在地界之外，請重新生成題目。");
  for(const feature of features) {
    if(feature.kind!=="building"||!feature.footprintShape||!feature.widthM||!feature.depthM)continue;
    const footprint=buildingFootprint(featurePoint(site,feature),feature.widthM,feature.depthM,feature.footprintShape,feature.rotationDeg);
    if(footprint.some((p,i)=>{
      const next=footprint[(i+1)%footprint.length];
      return [0,.25,.5,.75,1].some(t=>!inside({x:p.x+(next.x-p.x)*t,y:p.y+(next.y-p.y)*t},practiceSiteVertices(site)));
    })) throw new Error("基地內既有建築輪廓超出基地邊界，請調整位置或縮小外框。");
  }
  return site;
}
export function practiceSiteConditions(site: PracticeSitePlan): string[] {
  const p=practiceSiteVertices(site);
  const lengths=p.map((a,i)=>{
    const b=p[(i+1)%p.length];
    return `${String.fromCharCode(65+i)}–${String.fromCharCode(65+(i+1)%p.length)} ${Math.round(Math.hypot(b.x-a.x,b.y-a.y)*100)/100} m`;
  }).join("、");
  return [
    `基地為${siteShapeLabels[site.shape]}，外接範圍 ${Math.max(site.southWidthM,site.northWidthM)} × ${site.depthM} m，面積約 ${Math.round(practiceSiteArea(site))} 平方公尺；指北自圖上方順時針 ${site.northAngleDeg||0}°。`,
    `地界邊長：${lengths}。頂點位置及凹角依基地圖。`,
    ...site.roads.map(r=>`基地${siteBoundaryLabel(site,r)}臨 ${r.widthM} 公尺${r.name}。`),
    ...site.contexts.map(c=>`基地${siteBoundaryLabel(site,c)}${site.roads.some(r=>practiceBoundaryFor(site,r).index===practiceBoundaryFor(site,c).index)?"道路對側街廓為":"直接鄰地為"}${c.label}${c.floors?`，${c.floors} 層`:""}${c.heightM?`，高 ${c.heightM} m`:""}，建築外框為${siteBuildingFootprintLabels[c.footprintShape]}${c.impact?`；${c.impact}`:""}。`),
    ...site.setbacks.map(s=>`本題指定${siteBoundaryLabel(site,s)}朝向地界退縮 ${s.meters} m；虛線為退縮提示，轉角交集仍須檢核。`),
    ...site.features.map((f,i)=>`基地內編號 ${i+1}：${f.label}${f.kind==="building"&&f.footprintShape?`，${siteBuildingFootprintLabels[f.footprintShape]}外框 ${f.widthM} × ${f.depthM} m，旋轉 ${f.rotationDeg||0}°`:""}（位置依基地圖）。`)
  ];
}
export function escapeHtml(value: string|number): string {
  return String(value).replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]||char);
}
function n(v:number) { return Math.round(v*10)/10; }
export function renderPracticeSiteSvg(site: PracticeSitePlan): string {
  site = normalizePracticeSitePlan(site);
  const vertices=practiceSiteVertices(site),w=Math.max(site.northWidthM,site.southWidthM);
  const bands=practiceRoadBands(site);
  const blocks=site.contexts.map((context,i)=>{
    const boundary=practiceBoundaryFor(site,context);
    const band=bands.find(b=>b.boundary.index===boundary.index);
    const gap=band?.road.widthM||0,depth=14;
    const a=band?band.points[3]:boundary.a,b=band?band.points[2]:boundary.b;
    const points=[a,b,offset(b,boundary.normal,depth),offset(a,boundary.normal,depth)];
    const midpoint={x:(boundary.a.x+boundary.b.x)/2,y:(boundary.a.y+boundary.b.y)/2};
    const footprintCenter=offset(midpoint,boundary.normal,gap+depth*.52);
    const boundaryAngle=Math.atan2(boundary.b.y-boundary.a.y,boundary.b.x-boundary.a.x)*180/Math.PI;
    const footprint=buildingFootprint(footprintCenter,boundary.length*.7,depth*.62,context.footprintShape,boundaryAngle);
    return {context,index:i,boundary,band,points,footprint,
      labelCenter:offset(midpoint,boundary.normal,gap+depth*.1)};
  });
  // Fit the entire neighbourhood, not only the site's bounding rectangle.
  const world=[...vertices,...bands.flatMap(b=>b.points),...blocks.flatMap(b=>b.points)];
  const minX=Math.min(...world.map(p=>p.x))-5,maxX=Math.max(...world.map(p=>p.x))+5;
  const minY=Math.min(...world.map(p=>p.y))-5,maxY=Math.max(...world.map(p=>p.y))+5;
  const scale=Math.min(850/(maxX-minX),550/(maxY-minY));
  const left=500-(maxX-minX)*scale/2-minX*scale,top=205-minY*scale;
  const bottom=205+(maxY-minY)*scale;
  const transform=(p:Point)=>({x:left+p.x*scale,y:top+p.y*scale});
  const coords=(ps:Point[])=>ps.map(transform).map(p=>`${n(p.x)},${n(p.y)}`).join(" ");
  const points=vertices.map(transform),polygon=coords(vertices);
  const angleOf=(a:Point,b:Point)=>{
    let angle=Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI;
    if(angle>90||angle< -90)angle+=180;return n(angle);
  };
  const roads=bands.map(({road,boundary,points})=>{
    const a=transform(offset(boundary.a,boundary.normal,road.widthM/2));
    const b=transform(offset(boundary.b,boundary.normal,road.widthM/2));
    return `<g data-road-segment="${boundary.index}"><polygon points="${coords(points)}" fill="#eee" stroke="#777"/><line x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}" y2="${n(b.y)}" stroke="#999" stroke-dasharray="12 9"/><g transform="translate(${n((a.x+b.x)/2)} ${n((a.y+b.y)/2)}) rotate(${angleOf(a,b)})"><rect x="-88" y="-10" width="176" height="20" fill="#fff"/><text text-anchor="middle" y="5" class="road">${escapeHtml(road.name)} ${road.widthM} m</text></g></g>`;
  }).join("");
  const contexts=blocks.map(({context:c,index:i,boundary,band,points,footprint,labelCenter})=>{
    const p=transform(labelCenter),a=transform(boundary.a),b=transform(boundary.b);
    const relationship=band?"對側":"鄰地";
    return `<g data-context-segment="${boundary.index}"><polygon points="${coords(points)}" fill="url(#hatch)" stroke="#888"/><polygon class="context-building" points="${coords(footprint)}"/><g transform="translate(${n(p.x)} ${n(p.y)}) rotate(${angleOf(a,b)})"><rect x="-67" y="-10" width="134" height="20" fill="#fff" fill-opacity=".94"/><text text-anchor="middle" y="5" class="context">街廓 ${i+1} · ${relationship} · ${siteBuildingFootprintLabels[c.footprintShape]}${c.floors?` · ${c.floors}F`:""}</text></g></g>`;
  }).join("");
  const dimensions=points.map((a,i)=>{
    const b=points[(i+1)%points.length],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy),nx=dy/length,ny=-dx/length;
    // Keep dimensions inside the site so narrow roads and directly adjacent blocks remain readable.
    const ax=a.x-nx*21,ay=a.y-ny*21,bx=b.x-nx*21,by=b.y-ny*21;
    let angle=Math.atan2(dy,dx)*180/Math.PI;if(angle>90||angle< -90) angle+=180;
    return `<line x1="${n(ax)}" y1="${n(ay)}" x2="${n(bx)}" y2="${n(by)}" stroke="#111"/><g transform="translate(${n((ax+bx)/2)} ${n((ay+by)/2)}) rotate(${n(angle)})"><rect x="-36" y="-10" width="72" height="20" fill="#fff"/><text text-anchor="middle" y="5" class="dimension">${n(length/scale)} m</text></g><circle cx="${n(a.x)}" cy="${n(a.y)}" r="3" fill="#111"/><text x="${n(a.x-nx*13)}" y="${n(a.y-ny*13+5)}" class="index">${String.fromCharCode(65+i)}</text>`;
  }).join("");
  const setbacks=site.setbacks.map(s=>{
    const boundary=practiceBoundaryFor(site,s);
    const a=transform(offset(boundary.a,boundary.normal,-s.meters)),b=transform(offset(boundary.b,boundary.normal,-s.meters));
    return `<line x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}" y2="${n(b.y)}" stroke="#555" stroke-width="1.5" stroke-dasharray="7 5" clip-path="url(#siteClip)"/>`;
  }).join("");
  const features=site.features.map((f,i)=>{
    const p=transform(featurePoint(site,f));
    const existingBuilding=f.kind==="building"&&f.footprintShape&&f.widthM&&f.depthM
      ?`<polygon points="${coords(buildingFootprint(featurePoint(site,f),f.widthM,f.depthM,f.footprintShape,f.rotationDeg))}" fill="url(#hatch)" stroke="#222" stroke-width="2"/>`
      :`<rect x="${n(p.x-14)}" y="${n(p.y-10)}" width="28" height="20" fill="url(#hatch)" stroke="#222"/>`;
    const mark=f.kind==="tree"?`<circle cx="${n(p.x)}" cy="${n(p.y)}" r="12" fill="#fff" stroke="#222"/>`:f.kind==="building"?existingBuilding:f.kind==="water"?`<path d="M${n(p.x-14)} ${n(p.y)}q7 -8 14 0t14 0" fill="none" stroke="#222"/>`:`<path d="M${n(p.x)} ${n(p.y-12)}v24m-5 -5 5 5 5 -5" fill="none" stroke="#222"/>`;
    return `<g>${mark}<text x="${n(p.x+17)}" y="${n(p.y-10)}" class="index">${i+1}</text></g>`;
  }).join("");
  const wrap=(text:string)=>{const c=Array.from(text);return Array.from({length:Math.ceil(c.length/52)},(_,i)=>c.slice(i*52,(i+1)*52).join(""));};
  const rows=[
    ...site.contexts.map((c,i)=>`街廓 ${i+1}｜${siteBoundaryLabel(site,c)}：${c.label}${c.floors?` ${c.floors}層`:""}${c.heightM?` 高${c.heightM}m`:""}｜建築外框 ${siteBuildingFootprintLabels[c.footprintShape]}${c.impact?`；${c.impact}`:""}`),
    ...site.features.map((f,i)=>`原有物 ${i+1}｜${f.label}${f.kind==="building"&&f.footprintShape?`｜${siteBuildingFootprintLabels[f.footprintShape]} ${f.widthM}×${f.depthM}m`:""}`),
    ...site.setbacks.map(s=>`退縮｜${siteBoundaryLabel(site,s)} ${s.meters}m（虛線提示）`)
  ].flatMap(wrap);
  const legendTop=bottom+55,height=legendTop+rows.length*23+85;
  const legend=rows.map((text,i)=>`<text x="60" y="${legendTop+33+i*23}" class="legend">${escapeHtml(text)}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 ${height}" role="img" aria-label="${escapeHtml(siteShapeLabels[site.shape])}基地及道路對側街廓，指北角度 ${site.northAngleDeg||0} 度">
<defs><pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line y2="8" stroke="#ddd"/></pattern><clipPath id="siteClip"><polygon points="${polygon}"/></clipPath></defs>
<style>text{font-family:'Microsoft JhengHei',sans-serif;fill:#171717}.title{font-size:25px;font-weight:700}.subtitle,.legend{font-size:16px}.road,.dimension{font-size:15px;font-weight:600}.context{font-size:12px;font-weight:600}.context-building{fill:#fff;fill-opacity:.9;stroke:#333;stroke-width:1.6}.index{font-size:13px;font-weight:700}</style>
<rect width="1000" height="${height}" fill="#fff"/><rect x="26" y="22" width="948" height="${height-44}" fill="none" stroke="#222"/>
<text x="60" y="67" class="title">${escapeHtml(siteShapeLabels[site.shape])}基地設計條件</text>
<text x="60" y="96" class="subtitle">新編練習題 · 非官方試題 · 尺寸標註為準；道路與街廓量體為示意</text>
<g class="north-arrow" data-north-angle="${site.northAngleDeg||0}" transform="translate(918 145)" aria-label="指北 ${site.northAngleDeg||0} 度">
  <text x="0" y="-45" text-anchor="middle" class="index">北</text>
  <g transform="rotate(${site.northAngleDeg||0})"><path d="M0 28V-28M0-28L-8-12M0-28L8-12" fill="none" stroke="#111" stroke-width="3"/><path d="M0-28L-4-17L0-21L4-17Z" fill="#111"/></g>
  <circle cx="0" cy="0" r="3" fill="#111"/>
</g>
${roads}
${contexts}
<polygon points="${polygon}" fill="#fff" stroke="#111" stroke-width="3"/>
<g clip-path="url(#siteClip)">${setbacks}${features}</g>
${dimensions}
<text x="500" y="${legendTop}" text-anchor="middle" class="subtitle">基地周邊條件與既有物</text>
${legend}</svg>`;
}
