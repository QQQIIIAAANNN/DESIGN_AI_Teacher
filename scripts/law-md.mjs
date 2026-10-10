import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

export const manifestPath = "knowledge/laws/MANIFEST.json";
const ARTICLE = /^### (第\s*\d+(?:-\d+)?\s*條(?:之\s*\d+)?)$/;

export function parseLawMarkdown(content) {
  const front = content.match(/^---\n([\s\S]*?)\n---\n\n/);
  if (!front) throw new Error("Missing law Markdown front matter");
  const meta = {};
  for (const line of front[1].split("\n")) {
    const pair = line.match(/^([a-z_]+): (.+)$/);
    if (!pair) throw new Error("Malformed law metadata: " + line);
    meta[pair[1]] = JSON.parse(pair[2]);
  }
  const articles = [];
  let section = "", active = null;
  function finish() {
    if (!active) return;
    while (active.lines.at(-1) === "") active.lines.pop();
    while (active.lines[0] === "") active.lines.shift();
    if (!active.lines.length) throw new Error("Missing text for " + active.label);
    articles.push({
      label: active.label,
      chapter: section ? meta.chapter + " / " + section : meta.chapter,
      text: active.lines.join("\n")
    });
    active = null;
  }
  for (const line of content.slice(front[0].length).split("\n")) {
    if (line.startsWith("## ")) {
      finish();
      section = line.slice(3);
    } else {
      const found = line.match(ARTICLE);
      if (found) {
        finish();
        active = { label: found[1], lines: [] };
      } else if (active) {
        active.lines.push(line);
      } else if (line.trim()) {
        throw new Error("Unexpected content outside articles: " + line.slice(0, 100));
      }
    }
  }
  finish();
  return { meta, articles };
}

export async function readLawSources(root = process.cwd()) {
  const manifest = JSON.parse(await readFile(resolve(root, manifestPath), "utf8"));
  if (manifest.schema_version !== 1 || !Array.isArray(manifest.laws) || manifest.laws.length !== 2) {
    throw new Error("Unexpected law manifest format");
  }
  const rows = [];
  for (const law of manifest.laws) {
    let count = 0;
    const seen = new Set();
    for (const file of law.files) {
      const content = await readFile(resolve(root, file.path), "utf8");
      const actualHash = createHash("sha256").update(content, "utf8").digest("hex");
      if (actualHash !== file.sha256) throw new Error("Law SHA-256 mismatch: " + file.path);
      const { meta, articles } = parseLawMarkdown(content);
      if (meta.law_id !== law.law_id || meta.law_name !== law.law_name ||
          meta.source_url !== law.source_url || meta.retrieved_at !== law.retrieved_at ||
          meta.amended_date !== law.amended_date || meta.chapter !== file.chapter) {
        throw new Error("Law source metadata mismatch: " + file.path);
      }
      if (articles.length !== file.article_count) throw new Error("Article count mismatch: " + file.path);
      for (const article of articles) {
        if (seen.has(article.label)) throw new Error("Duplicate article: " + article.label);
        seen.add(article.label);
        rows.push({
          law_id: law.law_id, law_name: law.law_name, chapter: article.chapter,
          article_label: article.label, text: article.text, source_url: law.source_url,
          amended_date: law.amended_date, md_path: file.path
        });
      }
      count += articles.length;
    }
    if (count !== law.article_count) throw new Error("MANIFEST law article count mismatch: " + law.law_id);
  }
  return { manifest, rows };
}
