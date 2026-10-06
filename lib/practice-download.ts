import { questionBankCatalog } from "@/data/question-bank";
import { practiceQuestionText, type PracticeQuestion } from "@/lib/practice-question";
import { escapeHtml, renderPracticeSiteSvg } from "@/lib/practice-site";

export function practiceQuestionHtml(question: PracticeQuestion): string {
  const esc = escapeHtml;
  const sources = question.referenceIds.flatMap((id) => {
    const source = questionBankCatalog.find((s) => s.id === id);
    if (!source) return [];
    const depth = question.sourceDocuments?.find((s) => s.id === id)?.depth;
    return [`<li><a href="${esc(source.sourceUrl)}">${source.year} 年 ${esc(source.title)}</a>${depth ? depth === "pdf" ? "（含 PDF 摘錄）" : "（索引）" : ""}</li>`];
  }).join("");
  return `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(question.title)}</title>
<style>body{font:16px/1.8 'Microsoft JhengHei',sans-serif;color:#171717;max-width:900px;margin:40px auto;padding:0 24px}h1{font-size:28px}pre{white-space:pre-wrap;font:inherit;overflow-wrap:anywhere}svg{width:100%;height:auto}.site{break-before:page}a{color:#235b9d}button{padding:10px 16px;cursor:pointer}@media print{body{margin:0;max-width:none;font-size:11pt}button{display:none}a{color:inherit}svg{max-height:245mm}h1,h2{break-after:avoid}@page{size:A4;margin:16mm}}</style>
<button onclick="window.print()">列印／另存 PDF</button><h1>${esc(question.title)}</h1>
<p>${question.mode === "forecast" ? "考前猜題練習" : "同級模擬題"} · 生成時間：${esc(question.generatedAt)}<br>新編練習題，非官方預測或官方配分。${question.sourceDepth === "pdf" ? "部分案例含官方 PDF 摘錄。" : "依歷年題庫索引推演。"}</p>
<pre>${esc(practiceQuestionText(question))}</pre>
${question.sitePlan ? `<section class="site"><h2>基地與道路對側街廓</h2>${renderPracticeSiteSvg(question.sitePlan)}</section>` : ""}
<h2>參考案例</h2><ul>${sources}</ul></html>`;
}

export type PracticeDownloadFormat = "html" | "json" | "txt" | "svg";
export function practiceDownloadFile(question: PracticeQuestion, format: PracticeDownloadFormat) {
  const content = format === "html" ? practiceQuestionHtml(question) : format === "json"
    ? JSON.stringify({ format: "design-ai-teacher-practice", version: 1, question }, null, 2)
    : format === "svg" && question.sitePlan ? renderPracticeSiteSvg(question.sitePlan)
      : `${question.title}\n\n${practiceQuestionText(question)}`;
  const types = { html: "text/html", json: "application/json", txt: "text/plain", svg: "image/svg+xml" };
  return { content, type: `${types[format]};charset=utf-8`,
    name: `${question.title.replace(/[\\/:*?"<>|]/g, "-")}${format === "svg" ? "-基地條件圖" : ""}.${format}` };
}
export function downloadPracticeQuestion(question: PracticeQuestion, format: PracticeDownloadFormat) {
  const file = practiceDownloadFile(question, format);
  const url = URL.createObjectURL(new Blob([file.content], { type: file.type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
