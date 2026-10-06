"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import QuestionBank from "./question-bank";
import { questionBankCatalog, type ProjectQuestion, type QuestionCategory } from "@/data/question-bank";
import { isPracticeQuestion, type PracticeQuestion, type PracticeQuestionMode } from "@/lib/practice-question";
import { downloadPracticeQuestion, practiceDownloadFile, type PracticeDownloadFormat } from "@/lib/practice-download";
import { normalizePracticeSitePlan, renderPracticeSiteSvg, siteShapeLabels, siteShapes, type SiteShape } from "@/lib/practice-site";
import { reviewScenarios, type ReviewScenarioId } from "@/lib/review-scenario";

const STORAGE_KEY = "design_ai_practice_library_v1";
type Props = {
  question: PracticeQuestion | null;
  onUseQuestion: (question: PracticeQuestion) => void;
  onUsePastQuestion: (question: ProjectQuestion) => void;
  selectedTitle: string;
  mode: PracticeQuestionMode; onModeChange: (mode: PracticeQuestionMode) => void;
  category: QuestionCategory; onCategoryChange: (category: QuestionCategory) => void;
  specialRequirements: string; onSpecialChange: (value: string) => void;
  siteShape: SiteShape | "auto"; onShapeChange: (value: SiteShape | "auto") => void;
  northAngle: number | "auto"; onNorthChange: (value: number | "auto") => void;
  onGenerate: () => void; generating: boolean; ready: boolean; error: string; generationNotice: string;
  selectedModel: string; models: string[]; onModelChange: (model: string) => void; onRefreshModels: () => void;
  scenario: ReviewScenarioId; onScenarioChange: (id: ReviewScenarioId) => void;
  minutes: number; onMinutesChange: (minutes: number) => void;
  remaining: number; running: boolean; onToggleTimer: () => void; onResetTimer: () => void;
  onGoReview: () => void;
};
function clock(seconds: number) {
  return [Math.floor(seconds / 3600), Math.floor(seconds % 3600 / 60), seconds % 60].map((v) => String(v).padStart(2, "0")).join(":");
}
function PracticeDownloadLink({ question, format, children }: { question: PracticeQuestion; format: PracticeDownloadFormat; children: string }) {
  const [href, setHref] = useState("");
  const name = `${question.title.replace(/[\\/:*?"<>|]/g, "-")}${format === "svg" ? "-基地條件圖" : ""}.${format}`;
  useEffect(() => {
    const file = practiceDownloadFile(question, format);
    const url = URL.createObjectURL(new Blob([file.content], { type: file.type }));
    setHref(url);
    return () => URL.revokeObjectURL(url);
  }, [question, format]);
  return <a className="practice-action" href={href || undefined} download={name} aria-disabled={!href}>{children}</a>;
}
export default function PracticeStudio(p: Props) {
  const [saved, setSaved] = useState<PracticeQuestion[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState("");
  const [minutesDraft, setMinutesDraft] = useState(String(p.minutes));
  useEffect(() => setMinutesDraft(String(p.minutes)), [p.minutes]);
  const [sourceTab, setSourceTab] = useState<"ai" | "past" | "saved">("ai");
  const importRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<PracticeQuestion[]>([]);
  const storageWritable = useRef(true);
  const autoSavedId = useRef("");
  useEffect(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      if (Array.isArray(value)) {
        const questions = value.filter(isPracticeQuestion).map((q) => ({ ...q, sitePlan: q.sitePlan ? normalizePracticeSitePlan(q.sitePlan) : undefined }));
        libraryRef.current = questions;
        setSaved(questions);
        if (questions.length !== value.length) {
          storageWritable.current = false;
          setNotice("部分收藏格式無法讀取；保留原始儲存內容，請使用下載題目保存新題。");
        }
      } else { storageWritable.current = false; setNotice("收藏格式無法讀取；保留原始資料，請使用下載題目保存新題。"); }
    } catch { storageWritable.current = false; setNotice("無法讀取本機收藏，仍可下載或匯入題目檔。"); }
    setLoaded(true);
  }, []);
  function save(question: PracticeQuestion) {
    if (!storageWritable.current) { setNotice("本機收藏暫時無法寫入，原始資料已保留；請下載 JSON 或完整題目保存。"); return; }
    try {
      const existing = libraryRef.current;
      if (existing.some((q) => q.id === question.id)) { setNotice("此題已在本機收藏。"); return; }
      if (existing.length >= 100) throw new Error("本機收藏已達 100 題，請下載題目保存。");
      const next = [question, ...existing];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      libraryRef.current = next;
      setSaved(next);
      setNotice("已保存到本機收藏。可下載完整題目，換裝置時再匯入 JSON。");
    } catch (error) { setNotice(error instanceof Error && error.message.includes("100 題") ? error.message : "瀏覽器儲存空間不足或不允許保存；請下載 JSON 或完整題目。"); }
  }
  useEffect(() => {
    if (!loaded || !p.question || autoSavedId.current === p.question.id) return;
    autoSavedId.current = p.question.id;
    save(p.question);
    // Save each newly selected/generated question once; persistence is handled atomically in save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, p.question]);
  async function importQuestion(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      if (file.size > 3 * 1024 * 1024) throw new Error("題目 JSON 不得超過 3 MB。");
      const value = JSON.parse(await file.text());
      if (value.format !== "design-ai-teacher-practice" || value.version !== 1 || !isPracticeQuestion(value.question)) throw new Error("這不是有效的練習題 JSON。審圖工作檔請到審圖區匯入。");
      const question: PracticeQuestion = { ...value.question, sitePlan: value.question.sitePlan ? normalizePracticeSitePlan(value.question.sitePlan) : undefined };
      save(question);
      p.onUseQuestion(question);
      setSourceTab("ai");
    } catch (error) { setNotice(error instanceof Error ? error.message : "題目匯入失敗。"); }
    finally { event.target.value = ""; }
  }
  const q = p.question;
  const svg = q?.sitePlan ? renderPracticeSiteSvg(q.sitePlan) : "";
  return <section className="practice-studio" aria-labelledby="practice-title">
    <div className="practice-intro"><div><span className="step">DRAWING PRACTICE</span><h2 id="practice-title">練圖專區</h2>
      <p>選一道題、設定時限，完成作圖後帶著相同題目交給 AI 審圖。</p></div>
      <button className="practice-action" type="button" onClick={p.onGoReview}>前往審圖 →</button></div>
    <div className="practice-session">
      <div className="practice-session-copy"><span>本次練圖題目</span><strong>{p.selectedTitle || "先生成新題，或從歷年資料庫選用"}</strong>
        <small>題目與作圖時間會同步到審圖區。</small></div>
      <div className="practice-time-settings"><label>作圖情境<select value={p.scenario} disabled={p.running} onChange={(e) => p.onScenarioChange(e.target.value as ReviewScenarioId)}>
        {reviewScenarios.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
        <label>時間（分鐘）<input type="number" min={60} max={600} step={15} value={minutesDraft} disabled={p.running}
          onChange={(e) => setMinutesDraft(e.target.value)} onBlur={() => {
            p.onMinutesChange(minutesDraft.trim() ? Number(minutesDraft) : p.minutes);
            setMinutesDraft(String(Math.max(60, Math.min(600, Math.round((Number(minutesDraft) || p.minutes) / 15) * 15))));
          }} /></label></div>
      <div className="practice-timer" aria-label="練習計時器"><span>{p.remaining === 0 ? "時間到" : "剩餘時間"}</span>
        <output aria-live={p.remaining === 0 ? "polite" : "off"}>{clock(p.remaining)}</output>
        <button type="button" onClick={p.onToggleTimer}>{p.running ? "暫停" : p.remaining === 0 ? "再開始" : "開始"}</button>
        <button type="button" onClick={p.onResetTimer}>重設</button></div>
    </div>
    <nav className="practice-source-tabs" aria-label="練圖題目來源">
      {([["ai", "AI 生成練習題"], ["past", "歷年試題資料庫"], ["saved", `我的收藏（${saved.length}）`]] as const).map(([key, label]) =>
        <button key={key} type="button" aria-pressed={sourceTab === key} onClick={() => setSourceTab(key)}>{label}</button>)}
    </nav>
    <div hidden={sourceTab !== "ai"}>
      <div className="practice-generator practice-generator-panel">
        <div className="generator-controls">
          <label>用途<select value={p.mode} onChange={(e) => p.onModeChange(e.target.value as PracticeQuestionMode)}><option value="mock">同級模擬題</option><option value="forecast">考前猜題練習</option></select></label>
          <label>題型<select value={p.category} onChange={(e) => p.onCategoryChange(e.target.value as QuestionCategory)}><option value="architectural_design">建築設計</option><option value="site_planning">敷地計畫</option><option value="civil_service_grade_3">公務三級</option></select></label>
          <label>基地形狀<select value={p.siteShape} onChange={(e) => p.onShapeChange(e.target.value as SiteShape | "auto")}><option value="auto">多樣變化（自動）</option>{siteShapes.map((s) => <option key={s} value={s}>{siteShapeLabels[s]}</option>)}</select></label>
          <label>指北<select value={p.northAngle} onChange={(e) => p.onNorthChange(e.target.value === "auto" ? "auto" : Number(e.target.value))}><option value="auto">多方向（自動）</option>{[0,30,45,60,90,120,135,180,225,270,315].map((a) => <option key={a} value={a}>順時針 {a}°</option>)}</select></label>
          <label>AI 模型<select value={p.selectedModel} onChange={(e) => p.onModelChange(e.target.value)} disabled={!p.models.length}>
            {!p.models.length && <option value="">請先連接 AI 帳號</option>}{p.models.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
          <button type="button" onClick={p.onRefreshModels}>偵測模型</button>
          <label className="generator-special">特殊練習需求<textarea rows={3} maxLength={800} value={p.specialRequirements} onChange={(e) => p.onSpecialChange(e.target.value)} placeholder="例如：L 形轉角基地、對街學校與住宅、保留老樹，練習人車分流與半戶外空間。" /></label>
          <button type="button" disabled={!p.ready || p.generating} onClick={p.onGenerate}>{p.generating ? "正在對照案例、編題及核對條件…" : q ? "生成另一題" : "生成題目"}</button>
        </div>
        <p className="generator-note">每次隨機調整臨路線段與周邊用途，基地每一段邊界都標明道路對側街廓或直接鄰地。新題含面積表、圖說要求和練習配分，附歷年依據及推演理由，不保證命中。</p>
        {p.error && <p className="error-text" role="alert">{p.error}</p>}
        {p.generationNotice && <p role="status">{p.generationNotice}</p>}
      </div>
    </div>
    <div hidden={sourceTab !== "past"}><QuestionBank compact onSelect={(question) => { p.onUsePastQuestion(question); setNotice(`已選用「${question.title}」，可開始計時練圖。`); }} /></div>
    <div hidden={sourceTab !== "saved"} className="practice-library">
      <div className="practice-library-heading"><div><h3>我的練習題收藏</h3><p>保存在目前瀏覽器；下載 JSON 可備份並在其他裝置匯入。</p></div>
        <button type="button" className="practice-action" onClick={() => importRef.current?.click()}>匯入題目 JSON</button></div>
      <input ref={importRef} type="file" accept="application/json,.json" hidden onChange={(e) => void importQuestion(e)} />
      {!saved.length && <p className="practice-empty">生成的題目會自動收藏，也可匯入先前下載的題目。</p>}
      {saved.map((question) => <article className="practice-saved-row" key={question.id}><div><strong>{question.title}</strong>
        <small>{question.mode === "forecast" ? "猜題練習" : "模擬題"} · {question.sitePlan ? siteShapeLabels[question.sitePlan.shape] : "文字題"} · {new Date(question.generatedAt).toLocaleDateString("zh-TW")}</small></div>
        <button type="button" className="practice-action" onClick={() => { p.onUseQuestion(question); setSourceTab("ai"); }}>選用</button>
        <button type="button" className="practice-action" onClick={() => downloadPracticeQuestion(question, "html")}>下載完整題目</button></article>)}
    </div>
    {notice && <p className="status-note" role="status">{notice}</p>}
    {q && <article className="generated-question-card practice-question-preview">
      {q.generationModel && <small>本題使用模型：{q.generationModel}</small>}
      <div className="generated-question-title"><div><span>{q.mode === "forecast" ? "考前猜題練習" : "同級模擬題"}{q.durationMinutes ? ` · ${q.durationMinutes} 分鐘` : ""}</span><h3>{q.title}</h3></div>
        <div className="practice-downloads"><button type="button" onClick={() => save(q)}>保存收藏</button>
          <PracticeDownloadLink question={q} format="html">下載完整題目</PracticeDownloadLink>
          <PracticeDownloadLink question={q} format="json">下載 JSON</PracticeDownloadLink>
          <PracticeDownloadLink question={q} format="txt">下載文字</PracticeDownloadLink></div></div>
      <p>{q.premise}</p><p className="generator-note">完整題目下載包含基地圖；開啟下載的 HTML 後可列印或另存 PDF。</p>
      {q.specialRequirements && <p className="generated-focus">指定練習：{q.specialRequirements}</p>}
      {svg && <figure className="generated-site-figure"><div className="generated-site-heading"><figcaption>基地與周邊街廓 <span>指北順時針 {q.sitePlan?.northAngleDeg || 0}°</span></figcaption>
        <PracticeDownloadLink question={q} format="svg">下載基地 SVG</PracticeDownloadLink></div>
        <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} alt="含地界邊長、指北與道路對側街廓的基地示意圖" /></figure>}
      {q.forecastAnalysis && <section className="practice-analysis"><strong>歷年依據與推演理由</strong><ul>{q.forecastAnalysis.basis.map((b, i) => {
        const source = questionBankCatalog.find((s) => s.id === b.referenceId);
        const depth = q.sourceDocuments?.find((s) => s.id === b.referenceId)?.depth;
        return <li key={i}>{source ? <a href={source.sourceUrl} target="_blank" rel="noopener noreferrer">{source.year} 年 {source.title}</a> : b.referenceId}（{depth === "pdf" ? "PDF 摘錄" : "題庫索引"}）：{b.finding}</li>;
      })}</ul><p>{q.forecastAnalysis.rationale}</p><p className="subtle">推演限制：{q.forecastAnalysis.uncertainty}</p></section>}
      {([["基地條件", q.siteConditions], ["機能與使用需求", q.program], ["設計課題", q.designTasks], ["應交圖說", q.drawingRequirements], ["限制條件", q.constraints]] as const).map(([heading, rows]) =>
        rows.length ? <section key={heading}><strong>{heading}</strong><ul>{rows.map((row, i) => <li key={i}>{row}</li>)}</ul></section> : null)}
      {q.programSchedule && <section><strong>機能面積表</strong><div className="practice-table-scroll"><table className="practice-area-table"><thead><tr><th>空間</th><th>每處 m²</th><th>數量</th><th>小計 m²</th><th>使用／鄰接要求</th></tr></thead>
        <tbody>{q.programSchedule.map((r, i) => <tr key={i}><td>{r.name}</td><td>{r.areaM2}</td><td>{r.quantity}</td><td>{r.areaM2 * r.quantity}</td><td>{r.note}</td></tr>)}</tbody>
        <tfoot><tr><th colSpan={3}>機能淨面積合計</th><td>{q.programSchedule.reduce((sum, r) => sum + r.areaM2 * r.quantity, 0)}</td><td>公設與動線另加</td></tr></tfoot></table></div></section>}
      {q.designParameters && <p>本題指定：總樓地板 {q.designParameters.grossFloorAreaM2} m² · 公設與動線以淨面積加 {q.designParameters.circulationPercent}% · 建蔽率上限 {q.designParameters.maxCoveragePercent}% · 最高 {q.designParameters.maxFloors} 層。此為練習設定。</p>}
      {q.scoringCriteria && <section><strong>本題練習配分（合計 100 分）</strong><ul>{q.scoringCriteria.map((r, i) => <li key={i}>{r.criterion} · {r.points} 分：{r.checks.join("；")}</li>)}</ul></section>}
      <small>參考來源：{q.referenceIds.map((id) => { const source = questionBankCatalog.find((s) => s.id === id); return source ? <a key={id} href={source.sourceUrl} target="_blank" rel="noopener noreferrer">{source.year} 年 {source.title}</a> : null; })}
        · {q.sourceDepth === "pdf" ? "部分案例含官方 PDF 摘錄" : "僅依題庫索引"} · 新編練習題與配分，非官方預測。</small>
    </article>}
  </section>;
}
