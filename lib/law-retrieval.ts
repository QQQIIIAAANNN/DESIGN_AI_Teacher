import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { lawTokens } from "./law-tokenizer.ts";

export type LawResult = {
  lawId: string;
  articleLabel: string;
  chapter: string;
  text: string;
  sourceUrl: string;
  amendedDate: string;
  score: number;
};

export type LawSearchOptions = {
  limit?: number;
  lawIds?: string[];
  dbPath?: string;
  /** Optional caller-provided query vector for local tests or offline retrieval. */
  queryEmbedding?: number[];
};

type Row = {
  law_id: string; article_label: string; chapter: string; text: string;
  source_url: string; amended_date: string; rank: number;
  embedding: Uint8Array | null; embedding_dim: number | null;
};

function database(path?: string) {
  return new DatabaseSync(resolve(path || process.env.LAW_DB_PATH || "knowledge/laws/laws.sqlite"), { readOnly: true });
}

function key(label: string): string | null {
  const compact = label.replace(/[\s０-９]/g, (c) => {
    const n = c.charCodeAt(0) - 0xff10;
    return n >= 0 && n <= 9 ? String(n) : "";
  });
  const match = compact.match(/^(?:第)?(\d+)(?:-(\d+)(?:條)?|條(?:之(\d+|[一二三四五六七八九十]+))?)$/);
  if (!match) return null;
  const chinese = ["一","二","三","四","五","六","七","八","九","十",
    "十一","十二","十三","十四","十五","十六","十七","十八","十九","二十"];
  const suffix = match[2] || match[3];
  const numericSuffix = suffix && !/^\d+$/.test(suffix) ? String(chinese.indexOf(suffix) + 1) : suffix;
  return suffix && numericSuffix !== "0" ? match[1] + "-" + numericSuffix : match[1];
}

function output(row: Row, score: number): LawResult {
  return { lawId: row.law_id, articleLabel: row.article_label, chapter: row.chapter,
    text: row.text, sourceUrl: row.source_url, amendedDate: row.amended_date, score };
}

function cosine(query: number[], bytes: Uint8Array, dim: number | null): number | null {
  if (!dim || dim !== query.length || bytes.byteLength !== dim * 4) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < dim; i++) {
    const v = view.getFloat32(i * 4, true), q = query[i];
    if (!Number.isFinite(v) || !Number.isFinite(q)) return null;
    dot += v * q; aa += v * v; bb += q * q;
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : null;
}

async function remoteQueryVector(query: string): Promise<number[] | null> {
  const url = (process.env.LAW_EMBEDDINGS_URL || "").trim();
  const model = (process.env.LAW_EMBEDDINGS_MODEL || "").trim();
  if (!url || !model) return null;
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json",
        ...(process.env.LAW_EMBEDDINGS_API_KEY ? { Authorization: "Bearer " + process.env.LAW_EMBEDDINGS_API_KEY } : {}) },
      body: JSON.stringify({ model, input: query }),
      signal: AbortSignal.timeout(30000)
    });
  } catch { throw new Error("Embeddings 服務無法連線，請檢查 LAW_EMBEDDINGS_URL。"); }
  if (!response.ok) throw new Error("Embeddings 端點不支援或不可用 (HTTP " + response.status + ")。請檢查 /v1/embeddings 與模型。");
  const json = await response.json() as { data?: { embedding?: number[] }[] };
  const values = json.data?.[0]?.embedding;
  if (!Array.isArray(values) || !values.length || !values.every(Number.isFinite)) {
    throw new Error("Embeddings 服務回傳格式不正確。");
  }
  return values;
}

/** FTS5 unicode61 CJK bigrams; vectors are optional and never required for FTS. */
export async function searchLaws(query: string, options: LawSearchOptions = {}): Promise<LawResult[]> {
  const limit = Math.max(1, Math.min(50, Math.floor(options.limit ?? 10)));
  const lawIds = options.lawIds?.filter(Boolean) ?? [];
  if (options.lawIds && lawIds.length === 0) return [];
  const db = database(options.dbPath);
  let candidates: Row[] = [];
  try {
    const direct = key(query.trim());
    if (direct) {
      const rows = db.prepare("SELECT *, 0 AS rank FROM articles" +
        (lawIds.length ? " WHERE law_id IN (" + lawIds.map(() => "?").join(",") + ")" : "") +
        " ORDER BY law_id, id").all(...lawIds) as unknown as Row[];
      return rows.filter((row) => key(row.article_label) === direct).slice(0, limit).map((row) => output(row, 1));
    }
    const tokens = lawTokens(query).slice(0, 24);
    if (!tokens.length) return [];
    const match = tokens.join(" OR ");
    const filter = lawIds.length ? " AND a.law_id IN (" + lawIds.map(() => "?").join(",") + ")" : "";
    const querySql = "SELECT a.*, bm25(article_fts) AS rank FROM article_fts JOIN articles a ON a.id=article_fts.rowid WHERE article_fts MATCH ?" +
      filter + " ORDER BY rank ASC, a.id ASC LIMIT ?";
    candidates = db.prepare(querySql).all(match, ...lawIds, Math.max(80, limit * 12)) as unknown as Row[];
  } finally { db.close(); }
  const hasVectors = candidates.some((row) => Boolean(row.embedding && row.embedding_dim));
  const queryVector = options.queryEmbedding ?? (hasVectors ? await remoteQueryVector(query) : null);
  return candidates.map((row, index) => {
    const base = 1 / (1 + index);
    const similarity = queryVector && row.embedding ? cosine(queryVector, row.embedding, row.embedding_dim) : null;
    return output(row, similarity === null ? (queryVector ? 0.25 * base : base)
      : 0.25 * base + 0.75 * ((similarity + 1) / 2));
  }).sort((a, b) => b.score - a.score || a.lawId.localeCompare(b.lawId) ||
    a.articleLabel.localeCompare(b.articleLabel)).slice(0, limit);
}

export function getArticle(lawId: string, articleLabel: string, dbPath?: string): LawResult | null {
  const normalized = key(articleLabel.trim());
  if (!normalized) return null;
  const db = database(dbPath);
  try {
    const rows = db.prepare("SELECT *, 0 AS rank FROM articles WHERE law_id=? ORDER BY id").all(lawId) as unknown as Row[];
    const match = rows.find((row) => key(row.article_label) === normalized);
    return match ? output(match, 1) : null;
  } finally { db.close(); }
}
