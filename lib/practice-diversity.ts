import type { QuestionCategory } from "@/data/question-bank";
import { practiceSiteBoundaryCount, practiceSiteBoundaries, siteBuildingFootprints, siteShapes, type SiteBuildingFootprint, type SiteEdge, type SiteShape } from "@/lib/practice-site";

const themes = [
  { key:"market", label:"地方市場與食品供應：採買、卸貨、衛生與營業時間分流", words:/市場|食品|採買|物流/ },
  { key:"mobility", label:"交通轉乘與旅客服務：步行、自行車、公車轉乘與候車空間", words:/轉乘|交通|旅客|候車/ },
  { key:"heritage", label:"地方工藝與文化保存：工坊、展演、典藏與既有空間再利用", words:/文化|工藝|典藏|展演|保存/ },
  { key:"disaster", label:"防災與緊急服務：平時教育、災時避難、物資與指揮動線", words:/防災|避難|災害|緊急|指揮/ },
  { key:"ecology", label:"環境與水岸教育：生態觀察、雨水管理、室內外教學銜接", words:/生態|環境教育|水岸|雨水/ },
  { key:"sports", label:"運動與休閒：不同年齡的活動強度、場地共享與更衣服務", words:/運動|體育|休閒|更衣/ },
  { key:"work", label:"產業創新與職業訓練：實作、設備運送、工作安全與成果交流", words:/產業|創新|職業|訓練|實作/ },
  { key:"housing", label:"短期住宿與生活支持：居住隱私、共同生活與後勤管理", words:/住宿|居住|住宅|宿舍/ },
  { key:"civic", label:"行政與公共服務：洽公、等候、辦公、安全分區及獨立開放", words:/行政|洽公|辦公|公共服務/ },
  { key:"library", label:"閱讀與資訊服務：安靜閱讀、數位學習、館務與分時使用", words:/閱讀|圖書|資訊|閱覽/ },
  { key:"education", label:"教育與校園：教學單元、校園邊界、通學安全及社區共享", words:/學校|校園|小學|國小|教學|學童/ },
  { key:"care", label:"健康照顧與支持：不同使用者的可及性、照護與生活服務", words:/健康|照顧|托育|長照|高齡/ }
];
export type RecentPractice = { title:string; themeKey?:string; program?:string[]; shape?:SiteShape; roadSegments?:number[]; roadEdges?:SiteEdge[] };
const signature=(indices:number[])=>[...indices].sort((a,b)=>a-b).join(",");
function roadCombinations(boundaryCount:number) {
  const result:number[][]=[];
  for(let count=1;count<=Math.min(3,boundaryCount-1);count++) {
    const build=(next:number,picked:number[])=>{
      if(picked.length===count){result.push(picked);return;}
      for(let i=next;i<boundaryCount;i++)build(i+1,[...picked,i]);
    };
    build(0,[]);
  }
  return result;
}
export function pickPracticeDiversity(category:QuestionCategory, recent:RecentPractice[], shapeOrRandom:SiteShape|(()=>number)="rectangle", suppliedRandom=Math.random) {
  const shape=typeof shapeOrRandom==="string"?shapeOrRandom:"rectangle";
  const random=typeof shapeOrRandom==="function"?shapeOrRandom:suppliedRandom;
  const usedThemes=new Set(recent.slice(0,6).flatMap(q=>{
    if(q.themeKey)return [q.themeKey];
    const text=q.title+" "+(q.program||[]).join(" ");
    return themes.filter(t=>t.words.test(text)).map(t=>t.key);
  }));
  const eligible=category==="civil_service_grade_3"?themes.filter(t=>!["housing","work"].includes(t.key)):themes;
  const unused=eligible.filter(t=>!usedThemes.has(t.key));
  const themeCandidates=unused.length?unused:eligible;
  const theme=themeCandidates[Math.min(themeCandidates.length-1,Math.floor(random()*themeCandidates.length))];
  const boundaryCount=practiceSiteBoundaryCount(shape);
  const rectangleBoundaries=practiceSiteBoundaries({shape:"rectangle",southWidthM:80,northWidthM:80,depthM:60,roads:[],contexts:[],setbacks:[],features:[]});
  const usedRoads=new Set(recent.slice(0,8).flatMap(q=>{
    if(q.shape===shape&&q.roadSegments)return [`${shape}:${signature(q.roadSegments)}`];
    // Older saved prompts recorded only drawing sides; retain them as a diversity hint.
    if(!q.shape&&q.roadEdges&&shape==="rectangle") {
      const indices=rectangleBoundaries.filter(b=>q.roadEdges!.includes(b.edge)).map(b=>b.index);
      return [`${shape}:${signature(indices)}`];
    }
    return [];
  }));
  const candidates=roadCombinations(boundaryCount);
  const layouts=candidates.filter(indices=>!usedRoads.has(`${shape}:${signature(indices)}`));
  const choices=layouts.length?layouts:candidates;
  const roadSegments=choices[Math.min(choices.length-1,Math.floor(random()*choices.length))];
  const footprintOffset=Math.floor(random()*siteBuildingFootprints.length);
  const buildingFootprints=Array.from({length:boundaryCount},(_,segmentIndex)=>({
    segmentIndex,footprintShape:siteBuildingFootprints[(segmentIndex+footprintOffset)%siteBuildingFootprints.length]
  }));
  const interiorBuildingFootprint=siteBuildingFootprints[Math.floor(random()*siteBuildingFootprints.length)];
  const sample={shape,southWidthM:80,northWidthM:80,depthM:60,roads:[],contexts:[],setbacks:[],features:[]};
  const roadEdges=practiceSiteBoundaries(sample).filter(b=>roadSegments.includes(b.index)).map(b=>b.edge);
  return {themeKey:theme.key,theme:theme.label,roadSegments,roadEdges,buildingFootprints,interiorBuildingFootprint};
}
export function normalizeRecentPractice(value:unknown):RecentPractice[] {
  return Array.isArray(value)?value.slice(0,8).flatMap(q=>{
    if(!q||typeof q!=="object"||typeof q.title!=="string")return [];
    return [{title:q.title.slice(0,100),themeKey:typeof q.themeKey==="string"?q.themeKey.slice(0,40):undefined,
      program:Array.isArray(q.program)?q.program.filter((p:unknown)=>typeof p==="string").slice(0,5).map((p:string)=>p.slice(0,200)):[],
      shape:siteShapes.includes(q.shape as SiteShape)?q.shape as SiteShape:undefined,
      roadSegments:Array.isArray(q.roadSegments)?q.roadSegments.filter((i:unknown)=>typeof i==="number"&&Number.isInteger(i)&&i>=0&&i<6).slice(0,3):[],
      roadEdges:Array.isArray(q.roadEdges)?q.roadEdges.filter((s:unknown)=>["north","east","south","west"].includes(String(s))).slice(0,3):[]}];
  }):[];
}
