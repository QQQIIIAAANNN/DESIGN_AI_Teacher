import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, readdir, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";
import type { RetrievedKnowledge } from "@/lib/review-schema";

type PrivateRow = {
  id: string;
  kind: "text" | "image";
  source_title: string;
  source_path: string;
  page: number | null;
  text: string;
  image_ref?: string;
};

type Cache = { mtime: number; augmentationMtime: number; checkedAt: number; staleSources: number; rows: PrivateRow[]; postings: Map<string, number[]>; lengths: number[] };
let cache: Cache | null = null;
let vectorCache: { mtime: number; topicMtime: number; vectors: Map<string, number[]>; topics: Record<string, number[]> } | null = null;
const execFileAsync = promisify(execFile);

function indexFile() { return path.resolve(process.env.PRIVATE_KNOWLEDGE_INDEX || path.join(process.cwd(), "knowledge/private/index.jsonl")); }

export function searchTokens(value: string) {
  const lower = value.toLowerCase();
  const latin = lower.match(/[a-z][a-z0-9_-]{1,}/g) ?? [];
  const han = lower.match(/[\u3400-\u9fff]+/g) ?? [];
  return new Set([...latin, ...han.flatMap((run) => run.length <= 2 ? [run] : Array.from({ length: run.length - 1 }, (_, i) => run.slice(i, i + 2)))]);
}

async function load(): Promise<Cache> {
  const file = indexFile();
  let mtime = 0;
  try { mtime = (await stat(file)).mtimeMs; } catch { return { mtime: 0, augmentationMtime: 0, checkedAt: Date.now(), staleSources: 0, rows: [], postings: new Map(), lengths: [] }; }
  const augmentedFiles = (await readdir(path.dirname(file))).filter((name) => /^ocr-augmentation(?:-\d+)?\.jsonl$/.test(name))
    .map((name) => path.join(path.dirname(file), name));
  const augmentationMtime = (await Promise.all(augmentedFiles.map(async (name) => (await stat(name)).mtimeMs)))
    .reduce((sum, time) => sum + time, 0);
  if (cache?.mtime === mtime && cache.augmentationMtime === augmentationMtime && Date.now() - cache.checkedAt < 30_000) return cache;
  const files = [await readFile(file, "utf8"), ...await Promise.all(augmentedFiles.map((name) => readFile(name, "utf8")))];
  const parseRows = (content: string) => content.split(/\r?\n/).flatMap((line): PrivateRow[] => {
    if (!line.trim()) return [];
    try {
      const value = JSON.parse(line) as PrivateRow;
      return value.id && value.text && (value.kind === "text" || value.kind === "image") ? [value] : [];
    } catch { return []; }
  });
  const root = await sourceRoot();
  const baseRows = parseRows(files[0]);
  const sourcePaths = [...new Set(baseRows.map((row) => row.source_path))];
  const validDigests = new Map<string, string>();
  await Promise.all(sourcePaths.map(async (relative) => {
    try {
      const source = insideRoot(root, relative);
      const sourceStat = await stat(source, { bigint: true });
      const digest = createHash("sha256").update(`${relative}|${sourceStat.size}|${sourceStat.mtimeNs}`).digest("hex").slice(0, 20);
      validDigests.set(relative, digest);
    } catch { /* A removed or inaccessible source must not enter retrieval. */ }
  }));
  const validBase = baseRows.filter((row) => {
    const digest = /^(?:PV|PT|IMG)-([a-f0-9]{20})(?:-|$)/.exec(row.id)?.[1];
    return Boolean(digest && validDigests.get(row.source_path) === digest);
  });
  const validImageIds = new Set(validBase.filter((row) => row.kind === "image").map((row) => row.id));
  const augmented = files.slice(1).flatMap(parseRows).filter((row) => {
    const sourceImageId = /^OCR-(.+)-\d+$/.exec(row.id)?.[1];
    return Boolean(sourceImageId && validImageIds.has(sourceImageId));
  });
  const rows = [...validBase, ...augmented];
  const activeSources = new Set(validBase.map((row) => row.source_path));
  const staleSources = sourcePaths.length - activeSources.size;
  const postings = new Map<string, number[]>();
  const lengths: number[] = [];
  rows.forEach((row, index) => {
    const terms = searchTokens(`${row.source_title} ${row.source_path} ${row.text}`);
    lengths.push(terms.size);
    for (const term of terms) {
      const list = postings.get(term) || [];
      list.push(index);
      postings.set(term, list);
    }
  });
  cache = { mtime, augmentationMtime, checkedAt: Date.now(), staleSources, rows, postings, lengths };
  return cache;
}

async function loadVectors() {
  const folder = path.dirname(indexFile());
  const vectorFile = path.join(folder, "image-embeddings.jsonl");
  const topicFile = path.join(folder, "topic-embeddings.json");
  let mtime = 0;
  let topicMtime = 0;
  try { mtime = (await stat(vectorFile)).mtimeMs; topicMtime = (await stat(topicFile)).mtimeMs; }
  catch { return null; }
  if (vectorCache?.mtime === mtime && vectorCache.topicMtime === topicMtime) return vectorCache;
  const vectors = new Map<string, number[]>();
  for (const line of (await readFile(vectorFile, "utf8")).split(/\r?\n/)) {
    try {
      const row = JSON.parse(line) as { id: string; vector: number[] };
      if (row.id && Array.isArray(row.vector)) vectors.set(row.id, row.vector);
    } catch { /* A partially written final line is ignored. */ }
  }
  const topicData = JSON.parse(await readFile(topicFile, "utf8")) as { vectors: Record<string, number[]> };
  vectorCache = { mtime, topicMtime, vectors, topics: topicData.vectors };
  return vectorCache;
}

export async function searchPrivateKnowledge(query: string, limit = 8, focusKeys: string[] = []): Promise<RetrievedKnowledge[]> {
  const { rows, postings, lengths } = await load();
  if (!rows.length) return [];
  const scores = new Map<number, number>();
  for (const term of searchTokens(query)) {
    const list = postings.get(term);
    if (!list) continue;
    const idf = Math.log(1 + (rows.length - list.length + 0.5) / (list.length + 0.5));
    for (const index of list) scores.set(index, (scores.get(index) || 0) + idf / (1 + lengths[index] / 170));
  }
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  let rankedImages = ranked;
  const vectorData = focusKeys.length ? await loadVectors() : null;
  if (vectorData) {
    const focus = focusKeys.map((key) => vectorData.topics[key]).filter((vector): vector is number[] => Array.isArray(vector));
    if (focus.length) {
      const dimensions = focus[0].length;
      const combined = Array.from({ length: dimensions }, (_, index) => focus.reduce((sum, vector) => sum + (vector[index] || 0), 0) / focus.length);
      const norm = Math.hypot(...combined) || 1;
      const maxLexical = ranked[0]?.[1] || 1;
      rankedImages = rows.flatMap((row, index): Array<[number, number]> => {
        if (row.kind !== "image") return [];
        const vector = vectorData.vectors.get(row.id);
        const semantic = vector?.length === dimensions
          ? vector.reduce((sum, value, dimension) => sum + value * combined[dimension], 0) / norm : 0;
        const lexical = (scores.get(index) || 0) / maxLexical;
        return semantic > 0 || lexical > 0 ? [[index, semantic * 8 + lexical * 0.6]] : [];
      }).sort((a, b) => b[1] - a[1]);
    }
  }
  const selected: number[] = [];
  const seen = new Set<string>();
  for (const kind of ["text", "image"] as const) {
    const quota = kind === "image" ? Math.max(1, Math.floor(limit / 3)) : limit - Math.max(1, Math.floor(limit / 3));
    const imageCandidates = vectorData
      ? [...rankedImages.slice(0, 1), ...ranked.filter(([index]) => rows[index].kind === "image" && rows[index].image_ref?.startsWith("pdf:")), ...rankedImages]
      : rankedImages;
    for (const [index] of kind === "image" ? imageCandidates : ranked) {
      const row = rows[index];
      const key = `${row.source_path}#${row.page ?? "file"}`;
      if (row.kind !== kind || seen.has(`${kind}:${key}`)) continue;
      selected.push(index);
      seen.add(`${kind}:${key}`);
      if (selected.filter((value) => rows[value].kind === kind).length >= quota) break;
    }
  }
  return selected.slice(0, limit).map((index) => {
    const row = rows[index];
    return { id: row.id, sourceTitle: `${row.source_title}${row.page ? ` · 第 ${row.page} 頁` : ""}`,
      sourceType: "course_material_unreviewed", knowledgeType: row.kind === "image" ? "visual_reference" : "source_excerpt",
      statement: row.text.slice(0, 850), imageRefs: row.image_ref ? [row.id] : [] };
  });
}

async function sourceRoot() {
  if (process.env.KNOWLEDGE_SOURCE_DIR?.trim()) return path.resolve(process.env.KNOWLEDGE_SOURCE_DIR.trim());
  return (await readFile(path.join(path.dirname(indexFile()), "source-root.txt"), "utf8")).trim();
}

function insideRoot(root: string, relative: string) {
  const resolved = path.resolve(root, relative);
  const diff = path.relative(root, resolved);
  if (diff === ".." || diff.startsWith(`..${path.sep}`) || path.isAbsolute(diff)) throw new Error("知識圖片路徑超出來源資料夾。");
  return resolved;
}

export async function getKnowledgeImageDataUrl(id: string): Promise<string | null> {
  try {
    const index = await load();
    const row = index.rows.find((item) => item.id === id);
    if (!row?.image_ref) return null;
    const root = await sourceRoot();
    let source: string;
    if (row.image_ref.startsWith("pdf:")) {
      const match = /^pdf:(.+)#page=(\d+)$/.exec(row.image_ref);
      if (!match) return null;
      source = insideRoot(root, match[1]);
      const key = createHash("sha256").update(row.id).digest("hex").slice(0, 24);
      const renderDir = path.join(path.dirname(indexFile()), "rendered");
      const outputBase = path.join(renderDir, key);
      await mkdir(renderDir, { recursive: true });
      try { await stat(`${outputBase}.jpg`); } catch {
        await execFileAsync("pdftoppm", ["-f", match[2], "-l", match[2], "-scale-to", "1600", "-jpeg", "-singlefile", source, outputBase],
          { timeout: 60000, maxBuffer: 1024 * 1024 });
      }
      source = `${outputBase}.jpg`;
    } else {
      source = insideRoot(root, row.image_ref);
    }
    const jpeg = await sharp(source).resize({ width: 1500, height: 1500, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 76 }).toBuffer();
    return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function privateKnowledgeStats() {
  const { rows, staleSources } = await load();
  let imageEmbeddings = 0;
  try {
    const validImageIds = new Set(rows.filter((row) => row.kind === "image").map((row) => row.id));
    imageEmbeddings = (await readFile(path.join(path.dirname(indexFile()), "image-embeddings.jsonl"), "utf8"))
      .split(/\r?\n/).reduce((count, line) => {
        try { return count + (validImageIds.has((JSON.parse(line) as { id: string }).id) ? 1 : 0); }
        catch { return count; }
      }, 0);
  } catch { /* The image vector index is optional. */ }
  return { textChunks: rows.filter((row) => row.kind === "text").length,
    imagePages: rows.filter((row) => row.kind === "image").length,
    imageEmbeddings, sourceCount: new Set(rows.map((row) => row.source_path)).size, staleSources };
}
