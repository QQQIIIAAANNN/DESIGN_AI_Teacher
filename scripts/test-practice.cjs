const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
// Compile the small pure TypeScript modules in memory; no generated files or new dependencies.
function loader(overrides = {}, globals = {}) {
  const cache = new Map();
  function load(name) {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (!name.startsWith("@/")) return require(name);
    const file = path.join(root, `${name.slice(2)}.ts`);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true
    } }).outputText;
    const context = { module, exports: module.exports, require: load, crypto: globalThis.crypto,
      console, setTimeout, clearTimeout, AbortController, Headers, Response, process, Buffer, ...globals };
    vm.runInNewContext(code, context, { filename: file });
    return module.exports;
  }
  return load;
}
const load = loader();
const sites = load("@/lib/practice-site");
const questions = load("@/lib/practice-question");
const downloads = load("@/lib/practice-download");
const references = ["moex-114-architectural_design", "moex-113-architectural_design"];
function site(shape = "rectangle", angle = 0) {
  return { shape, southWidthM: 80, northWidthM: 80, depthM: 60, northAngleDeg: angle,
    roads: [{ edge: "north", widthM: 12, name: "學府路" }], contexts: [
      { edge: "north", label: "國小街廓", floors: 3, heightM: 12, impact: "入口避開通學尖峰" },
      { edge: "west", label: "住宅街廓", floors: 5, heightM: 16, impact: "避免視線干擾" }
    ], setbacks: [{ edge: "north", meters: 4 }], features: [{ kind: "tree", x: .25, y: .6, label: "保留老樹" }] };
}
function fixture(shape = "l_shape", angle = 45) {
  return { title: "社區共享學習中心", premise: "服務社區居民與學童，平假日分時共享，回應通學及住宅隱私需求。",
    sitePlan: site(shape, angle), environmentNotes: ["夏季遮陽與自然通風"],
    program: ["服務 60 人", "活動與行政分流", "共享區週末獨立開放"],
    programSchedule: [{ name: "活動室", areaM2: 200, quantity: 2, note: "每室30人，鄰接庭院" },
      { name: "閱覽室", areaM2: 200, quantity: 1, note: "安靜區，避開主要動線" },
      { name: "行政服務", areaM2: 100, quantity: 1, note: "含廁所設備與管理" }],
    designParameters: { grossFloorAreaM2: 910, circulationPercent: 30, maxCoveragePercent: 50, maxFloors: 2 },
    designTasks: ["處理凹角庭院", "人車分流", "街廓隱私與遮陽"],
    drawingRequirements: ["配置1:500", "平面1:200", "剖面1:200及面積表"],
    constraints: ["停車10輛", "室外空間500m²", "卸貨與通學入口分開"],
    scoringCriteria: [{ criterion: "基地回應", points: 40, checks: ["對街通學動線"] },
      { criterion: "機能", points: 35, checks: ["共享區獨立開放"] }, { criterion: "圖說", points: 25, checks: ["面積與剖面一致"] }],
    forecastAnalysis: { basis: [{ referenceId: references[0], finding: "行政複合題型" },
      { referenceId: references[1], finding: "照顧使用者需求" }], rationale: "整合公共服務與社區使用者，改以學習機能練習不同基地。", uncertainty: "索引僅顯示題名，不能推論官方未公開的命題方向。" } };
}
const meta = { mode: "forecast", category: "architectural_design", referenceIds: references, sourceDepth: "catalog" };

test("all five shapes compute distinct area and labelled edges from their geometry", () => {
  const expected = { rectangle: 4800, trapezoid: 4800, l_shape: 4032, chamfered: 4644.48, irregular: 3668.88 };
  for (const shape of sites.siteShapes) {
    const plan = sites.normalizePracticeSitePlan(site(shape, 135));
    const area = sites.practiceSiteArea(plan);
    assert.ok(Math.abs(area - expected[shape]) < .01, `${shape}: ${area}`);
    const svg = sites.renderPracticeSiteSvg(plan);
    assert.match(svg, /rotate\(135\)/);
    assert.match(svg, /街廓 1 · 對側/);
    assert.match(svg, /12 m/);
    assert.ok(sites.practiceSiteConditions(plan).some((s) => s.includes(`${Math.round(area)} 平方公尺`)));
  }
  assert.equal(sites.siteEdgeLabel(site("rectangle", 90), "north"), "圖上側（約西側）");
  const trapezoid = site("trapezoid"); trapezoid.northWidthM = 60;
  assert.equal(sites.practiceSiteArea(sites.normalizePracticeSitePlan(trapezoid)), 4200);
});
test("reject invalid dimensions, bearings and features outside a concave site", () => {
  assert.throws(() => sites.normalizePracticeSitePlan({ ...site(), northAngleDeg: 360 }));
  assert.throws(() => sites.normalizePracticeSitePlan({ ...site(), northWidthM: 70 }));
  assert.throws(() => sites.normalizePracticeSitePlan({ ...site("l_shape"), features: [{ kind: "tree", x: .8, y: .2, label: "樹" }] }), /地界之外/);
});
test("roads follow sloping boundaries at true width and share adjacent junction corners", () => {
  for(const shape of sites.siteShapes) {
    const plan=site(shape);if(shape==="trapezoid")plan.northWidthM=60;
    plan.roads=[{edge:"north",widthM:12,name:"A"},{edge:"east",widthM:8,name:"B"}];
    for(const {road,boundary,points} of sites.practiceRoadBands(plan)) {
      assert.equal(points[0],boundary.a);
      assert.equal(points[1],boundary.b);
      for(const p of points.slice(2)) {
        const distance=(p.x-boundary.a.x)*boundary.normal.x+(p.y-boundary.a.y)*boundary.normal.y;
        assert.ok(Math.abs(distance-road.widthM)<1e-8,`${shape}: ${distance}`);
      }
      assert.match(sites.renderPracticeSiteSvg(plan),new RegExp(`data-road-segment="${boundary.index}"`));
    }
    const bands=sites.practiceRoadBands(plan);
    if((bands[0].boundary.index+1)%sites.practiceSiteVertices(plan).length===bands[1].boundary.index) {
      assert.deepEqual(bands[0].points[2],bands[1].points[3]);
    }
  }
  const narrow=sites.normalizePracticeSitePlan({...site("irregular"),southWidthM:20,northWidthM:20,depthM:160,features:[]});
  for(const edge of ["north","east","south","west"])assert.ok(sites.practiceBoundaryFor(narrow,{edge}));
  assert.throws(()=>sites.normalizePracticeSitePlan({...site(),roads:[{edge:"north",segmentIndex:2,widthM:12,name:"bad"}]}),/線段/);
});
test("diversity rotates primary themes and road layouts using recent saved questions", () => {
  const diversity=load("@/lib/practice-diversity");
  const recent=[]; const keys=new Set(),layouts=new Set();
  for(let i=0;i<6;i++) {
    const next=diversity.pickPracticeDiversity("architectural_design",recent,()=>0);
    assert.ok(!keys.has(next.themeKey));keys.add(next.themeKey);
    const layout=[...next.roadEdges].sort().join(",");
    assert.ok(!layouts.has(layout));layouts.add(layout);
    recent.unshift({title:"練習",themeKey:next.themeKey,roadEdges:next.roadEdges});
  }
  const next=diversity.pickPracticeDiversity("architectural_design",[{title:"全齡健康與托育中心",roadEdges:["north"]}],()=>.999);
  assert.notEqual(next.themeKey,"care");
  assert.notEqual(next.roadEdges.join(","),"north");
});
test("complete question checks numeric feasibility, 100 points and traceable sources", () => {
  const q = questions.normalizePracticeQuestion(fixture(), meta);
  assert.equal(questions.isPracticeQuestion(q), true);
  assert.match(questions.practiceQuestionText(q), /機能面積表/);
  assert.match(questions.practiceQuestionText(q), /910/);
  assert.throws(() => questions.normalizePracticeQuestion({ ...fixture(), designParameters: { ...fixture().designParameters, grossFloorAreaM2: 700 } }, meta), /不一致/);
  assert.throws(() => questions.normalizePracticeQuestion({ ...fixture(), scoringCriteria: fixture().scoringCriteria.map((r) => ({ ...r, points: 20 })) }, meta), /100 分/);
  const missing = fixture(); missing.sitePlan.contexts.shift();
  assert.throws(() => questions.normalizePracticeQuestion(missing, meta), /對側街廓/);
  const conflict = fixture(); conflict.premise = "南側道路與北側住宅";
  assert.throws(() => questions.normalizePracticeQuestion(conflict, meta), /方位文字/);
  const compass = fixture(); compass.environmentNotes = ["真西側與真西南側午後日照強，真東北側迎冬季季風。"];
  assert.doesNotThrow(() => questions.normalizePracticeQuestion(compass, meta));
  const falseSource = fixture(); falseSource.forecastAnalysis.basis[0].referenceId = "made-up";
  assert.throws(() => questions.normalizePracticeQuestion(falseSource, meta), /歷年案例/);
});
test("legacy work files remain valid and malformed imports are rejected", () => {
  const q = questions.normalizePracticeQuestion(fixture(), meta);
  for (const key of ["programSchedule", "designParameters", "scoringCriteria", "forecastAnalysis"]) delete q[key];
  delete q.sitePlan.northAngleDeg;
  assert.equal(questions.isPracticeQuestion(q), true);
  assert.equal(sites.normalizePracticeSitePlan(q.sitePlan).northAngleDeg, 0);
  assert.equal(questions.isPracticeQuestion({ ...q, generatedAt: "invalid" }), false);
  assert.equal(questions.isPracticeQuestion({ ...q, scoringCriteria: [] }), false);
});
test("standalone download contains full question, geometry, sources and safe escaped text", () => {
  const q = questions.normalizePracticeQuestion(fixture(), meta);
  q.title = '<img src=x onerror="alert(1)">';
  q.sitePlan.contexts[0].label = '<script>alert(1)</script>';
  const html = downloads.practiceQuestionHtml(q);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /<svg/);
  assert.match(html, /window.print/);
  assert.match(html, /機能面積表/);
  assert.match(html, /考選部|wwwq.moex.gov.tw/);
});
test("review uses the generated question's explicit scoring instead of generic fallback", () => {
  const rubric = load("@/lib/review-rubric");
  const q = questions.normalizePracticeQuestion(fixture(), meta);
  const resolved = rubric.resolveReviewRubric(null, q);
  assert.equal(resolved.mode, "question_points");
  assert.equal(resolved.totalMaxScore, 100);
  assert.match(resolved.sourceLabel, /非官方/);
  assert.equal(resolved.items[0].maxScore, 40);
  assert.equal(resolved.items[0].criterion, "對街通學動線");
  delete q.scoringCriteria;
  assert.equal(rubric.resolveReviewRubric(null, q).mode, "platform_fallback");
});
test("generation endpoint validates requested geometry and reports per-source evidence", async () => {
  let sent;
  const generatedFixture = fixture();
  const diversity = load("@/lib/practice-diversity").pickPracticeDiversity("architectural_design", [], "l_shape", () => 0);
  const boundaries = sites.practiceSiteBoundaries(generatedFixture.sitePlan);
  generatedFixture.sitePlan.roads = diversity.roadSegments.map((segmentIndex) => ({
    edge: boundaries[segmentIndex].edge, segmentIndex, widthM: 12, name: "學府路"
  }));
  generatedFixture.sitePlan.contexts = diversity.buildingFootprints.map(({ segmentIndex, footprintShape }) => ({
    edge: boundaries[segmentIndex].edge, segmentIndex, label: `街廓 ${segmentIndex + 1}`,
    floors: 3, heightM: 12, impact: "控制採光並維持步行銜接", footprintShape
  }));
  const route = loader({
    "@/lib/server-auth": { reviewAuthorizationError: async () => null },
    "@/lib/cliproxy-server": { getCliProxyModelStatus: async () => ({ running: true, authenticated: true, models: ["test-model"] }),
      getCliProxyBaseUrl: () => "http://test.invalid", getCliProxyHeaders: () => ({}),
      cliProxyCompletion: async (_url, options) => {sent=JSON.parse(options.body);return Response.json({text:JSON.stringify(generatedFixture)},{headers:{"X-CliProxy-Model":"test-model"}});} },
    "@/lib/question-source": { loadQuestionDocument: async (id) => ({ text: id === references[0] ? "官方題目摘錄" : "" }) },
    "@/lib/ai-proxy-client": { extractText: (body) => body.text, parseJsonContent: JSON.parse }
  }, { Math:Object.assign(Object.create(Math),{random:()=>0}) })("@/app/api/questions/generate/route");
  const response = await route.POST({ json: async () => ({ category: "architectural_design", mode: "forecast", siteShape: "l_shape", northAngle: 45, model: "test-model", scenario: "design_8h", minutes: 480 }) });
  const body = await response.json();
  assert.equal(response.status, 200, body.error);
  assert.equal(body.question.durationMinutes, 480);
  assert.equal(body.question.scenarioId, "design_8h");
  const evidence=JSON.parse(sent.messages[1].content.split("已讀取案例與摘錄：")[1].split("\n")[0]);
  for(const source of body.question.sourceDocuments)assert.equal(source.depth,evidence.find(s=>s.id===source.id)?.officialExtract?"pdf":"catalog");
  assert.equal(body.question.generationModel,"test-model");
  assert.match(sent.messages[0].content, /shape=l_shape、northAngleDeg=45/);
  const wrong = await route.POST({ json: async () => ({ category: "architectural_design", siteShape: "rectangle", northAngle: 0 }) });
  assert.equal(wrong.status, 502);
  const invalid = await route.POST({ json: async () => ({ category: "architectural_design", northAngle: -1 }) });
  assert.equal(invalid.status, 400);
});

function proxyFixture(failure, models=["claude-opus-5-5-high","claude-opus-4-6-thinking","claude-sonnet-4-6"]) {
  const posts=[];
  const proxy=loader({}, {
    process:{...process,env:{CLIPROXY_URL:"http://proxy.test",CLIPROXY_API_KEY:"test-only"}},
    fetch:async(url,options={})=>{
      if(url.endsWith("/v1/models"))return Response.json({data:models.map(id=>({id}))});
      assert.equal(url,"http://proxy.test/v1/chat/completions");
      const body=JSON.parse(options.body);posts.push(body);
      return body.model.includes("5-5")?failure():Response.json({choices:[{message:{content:"OK"}}]});
    }
  })("@/lib/cliproxy-server");
  return {proxy,posts,init:{method:"POST",body:JSON.stringify({model:"claude-opus-5-5-high",messages:[{role:"user",content:"keep this prompt"}],stream:true,max_tokens:20})}};
}
test("Claude missing-model errors retry once within the same family and expose actual model", async()=>{
  for(const failure of [
    ()=>Response.json({error:{message:"Requested entity was not found.",status:"NOT_FOUND"}},{status:404}),
    ()=>Response.json({error:{message:'auth_unavailable: no auth available; last upstream error: {"code":404,"status":"NOT_FOUND"}'}},{status:503})
  ]) {
    const {proxy,posts,init}=proxyFixture(failure);
    const result=await proxy.cliProxyCompletion("http://proxy.test",init);
    assert.equal(result.status,200);
    assert.equal(result.headers.get("X-CliProxy-Model"),"claude-opus-4-6-thinking");
    assert.equal(posts.length,2);
    assert.equal(posts[1].messages[0].content,"keep this prompt");
    assert.equal(posts[1].stream,true);
    const status=await proxy.getCliProxyModelStatus();
    assert.ok(!status.models.includes("claude-opus-5-5-high"));
    assert.ok(status.unavailableModels.includes("claude-opus-5-5-high"));
    await proxy.cliProxyCompletion("http://proxy.test",init);
    assert.equal(posts.length,3); // Subsequent calls bypass the known broken model during cooldown.
  }
});
test("Claude fallback preserves authentication, quota, endpoint and unrelated server errors",async()=>{
  for(const failure of [
    ()=>Response.json({error:{message:"Unauthorized"}},{status:401}),
    ()=>Response.json({error:{message:"Rate limit"}},{status:429}),
    ()=>new Response("<html>404 Not Found</html>",{status:404}),
    ()=>Response.json({error:{message:"auth_unavailable: no auth available"}},{status:503})
  ]) {
    const {proxy,posts,init}=proxyFixture(failure);
    const result=await proxy.cliProxyCompletion("http://proxy.test",init);
    assert.equal(result.ok,false);
    assert.equal(posts.length,1);
  }
  const {proxy,posts,init}=proxyFixture(()=>Response.json({error:{message:"Requested entity was not found."}},{status:404}),["claude-opus-5-5-high","claude-sonnet-4-6"]);
  await assert.rejects(()=>proxy.cliProxyCompletion("http://proxy.test",init),/同系列/);
  assert.equal(posts.length,1);
  const selection=load("@/lib/model-selection");
  assert.equal(selection.selectConnectedModel("claude-opus-5-5-high",["gemini-3-pro","claude-opus-4-6-thinking"]),"claude-opus-4-6-thinking");
  assert.equal(selection.selectConnectedModel("claude-opus-5-5-high",["gemini-3-pro","claude-sonnet-4-6"]),undefined);
});
