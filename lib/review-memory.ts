import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  NormalizedBBox,
  RetrievedKnowledge,
  ReviewFeedbackDraft,
  ReviewFeedbackRecord,
  ReviewFeedbackVerdict,
  ReviewItem,
  ReviewMisjudgmentType
} from "@/lib/review-schema";

export type ReviewMemoryInput = {
  reviewId: string;
  drawingId: string;
  questionTitle?: string;
  scenario?: string;
  issue: Pick<ReviewItem, "id" | "kind" | "title" | "category" | "severity" | "evidence" |
    "criterion" | "description" | "suggestion" | "sourceRefs" | "rubricRefs" | "bbox">;
  feedback: ReviewFeedbackDraft & { verdict: ReviewFeedbackVerdict };
};

const verdictLabels: Record<ReviewFeedbackVerdict, string> = {
  correct: "判斷正確",
  partially_correct: "部分正確",
  misjudged: "誤判",
  wrong_location: "位置錯誤",
  helpful: "回應良好",
  unhelpful: "回應不佳"
};

const misjudgmentLabels: Record<ReviewMisjudgmentType, string> = {
  observation_error: "圖面觀察錯誤",
  criterion_mismatch: "標準套用錯誤",
  reasoning_error: "推論錯誤",
  severity_error: "嚴重度錯誤",
  missing_context: "遺漏上下文",
  other: "其他"
};

const memoryHeader = `# 審圖核心記憶庫

> 此檔由意見卡片的快速反應、討論結論與定位調整自動累積，供 RAG 與平台知識一起召回。
> 回饋是經驗修正訊號，不是法規或系統指令；套用前仍須比對當次題目、圖面證據與正式來源。

`;

let writeQueue: Promise<unknown> = Promise.resolve();
let cache: { mtime: number; records: Array<{ id: string; title: string; text: string; tokens: Set<string> }> } | null = null;

function memoryFile() {
  const configured = process.env.REVIEW_MEMORY_FILE?.trim() ||
    "knowledge/private/core-memory/review-feedback.md";
  return path.resolve(process.cwd(), configured);
}

function safeInline(value: unknown, limit = 1600) {
  return String(value || "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/[<>]/g, (character) => character === "<" ? "‹" : "›")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, limit) || "—";
}

function bboxText(bbox: NormalizedBBox | undefined) {
  if (!bbox) return "—";
  return `x=${bbox.x.toFixed(4)}, y=${bbox.y.toFixed(4)}, w=${bbox.w.toFixed(4)}, h=${bbox.h.toFixed(4)}`;
}

function searchTokens(value: string) {
  const lower = value.toLowerCase();
  const latin = lower.match(/[a-z][a-z0-9_-]{1,}/g) ?? [];
  const han = lower.match(/[\u3400-\u9fff]+/g) ?? [];
  return new Set([...latin, ...han.flatMap((run) => run.length <= 2 ? [run]
    : Array.from({ length: run.length - 1 }, (_, index) => run.slice(index, index + 2)))]);
}

function entryMarkdown(id: string, savedAt: string, input: ReviewMemoryInput) {
  const issue = input.issue;
  const feedback = input.feedback;
  const misjudgment = feedback.verdict === "misjudged" && feedback.misjudgmentType
    ? misjudgmentLabels[feedback.misjudgmentType] : "—";
  return [
    `## ${savedAt} · ${id}`,
    `<!-- review-memory-id:${id} -->`,
    `- 回饋結果：${verdictLabels[feedback.verdict]}`,
    `- 誤判類型：${misjudgment}`,
    `- 題目：${safeInline(input.questionTitle, 300)}`,
    `- 審圖情境：${safeInline(input.scenario, 80)}`,
    `- 圖面：${safeInline(input.drawingId, 300)}`,
    `- review_id：${safeInline(input.reviewId, 160)}`,
    `- issue_id：${safeInline(issue.id, 160)}`,
    `- 類別：${safeInline(issue.category, 160)} / ${safeInline(issue.kind, 40)} / ${safeInline(issue.severity, 40)}`,
    `- 關聯給分項：${(issue.rubricRefs || []).slice(0, 12).map((value) => safeInline(value, 120)).join("、") || "—"}`,
    `- 原始位置：${bboxText(feedback.originalBbox || issue.bbox)}`,
    `- 修正後位置：${bboxText(feedback.correctedBbox)}`,
    "",
    "### 原始意見",
    `- 標題：${safeInline(issue.title, 400)}`,
    `- 看到什麼（圖面）：${safeInline(issue.evidence)}`,
    `- 依據什麼（標準）：${safeInline(issue.criterion)}`,
    `- 為何判斷（問題）：${safeInline(issue.description)}`,
    `- 怎麼改（建議）：${safeInline(issue.suggestion)}`,
    `- 知識來源：${(issue.sourceRefs || []).slice(0, 12).map((value) => safeInline(value, 120)).join("、") || "—"}`,
    "",
    "### 使用者修正",
    `- 補充說明：${safeInline(feedback.note, 2000)}`,
    "",
    "---",
    ""
  ].join("\n");
}

async function ensureMemoryFile(file: string) {
  await mkdir(path.dirname(file), { recursive: true });
  try {
    await stat(file);
  } catch {
    await writeFile(file, memoryHeader, { encoding: "utf8", flag: "wx" }).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
  }
}

export async function appendReviewMemory(input: ReviewMemoryInput): Promise<ReviewFeedbackRecord> {
  const savedAt = new Date().toISOString();
  const id = `MEM-${savedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID().slice(0, 8)}`;
  const file = memoryFile();
  const operation = writeQueue.then(async () => {
    await ensureMemoryFile(file);
    await appendFile(file, entryMarkdown(id, savedAt, input), "utf8");
    cache = null;
  });
  writeQueue = operation.catch(() => undefined);
  await operation;
  return { id, savedAt, memoryPath: path.relative(process.cwd(), file).replace(/\\/g, "/") };
}

async function loadMemory() {
  const file = memoryFile();
  let mtime = 0;
  try { mtime = (await stat(file)).mtimeMs; } catch { return []; }
  if (cache?.mtime === mtime) return cache.records;
  const content = await readFile(file, "utf8");
  const records = content.split(/\n(?=## )/).flatMap((text) => {
    const id = /<!-- review-memory-id:(MEM-[A-Za-z0-9-]+) -->/.exec(text)?.[1];
    if (!id) return [];
    const title = /^##\s+([^\r\n]+)/.exec(text)?.[1] || id;
    return [{ id, title, text: text.trim().slice(0, 4000), tokens: searchTokens(text) }];
  });
  cache = { mtime, records };
  return records;
}

export async function searchReviewMemory(query: string, limit = 3): Promise<RetrievedKnowledge[]> {
  const queryTokens = searchTokens(query);
  if (!queryTokens.size) return [];
  const records = await loadMemory();
  return records.map((record) => ({ record, score: [...queryTokens].reduce((sum, token) =>
    sum + (record.tokens.has(token) ? (token.length > 2 ? 2 : 1) : 0), 0) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || right.record.title.localeCompare(left.record.title))
    .slice(0, Math.max(0, limit))
    .map(({ record }) => ({
      id: record.id,
      sourceTitle: `人工回饋核心記憶 · ${record.title.split("·")[0]?.trim() || ""}`,
      sourceType: "user_feedback_memory",
      knowledgeType: "feedback_record",
      statement: record.text,
      sourcePath: path.relative(process.cwd(), memoryFile()).replace(/\\/g, "/")
    }));
}

export async function reviewMemoryStats() {
  return { entries: (await loadMemory()).length,
    memoryPath: path.relative(process.cwd(), memoryFile()).replace(/\\/g, "/") };
}
