import { DatabaseSync } from "node:sqlite";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { readLawSources } from "./law-md.mjs";
import { lawTokens } from "../lib/law-tokenizer.ts";

export async function buildLawIndex(dbPath = resolve("knowledge/laws/laws.sqlite")) {
  const { manifest, rows } = await readLawSources();
  await mkdir(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA journal_mode=DELETE; PRAGMA foreign_keys=ON;");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec("DROP TABLE IF EXISTS article_fts; DROP TABLE IF EXISTS articles;");
      db.exec("CREATE TABLE articles (id INTEGER PRIMARY KEY, law_id TEXT NOT NULL, law_name TEXT NOT NULL, chapter TEXT NOT NULL, article_label TEXT NOT NULL, text TEXT NOT NULL, source_url TEXT NOT NULL, amended_date TEXT NOT NULL, md_path TEXT NOT NULL, embedding BLOB NULL, embedding_model TEXT NULL, embedding_dim INTEGER NULL, UNIQUE(law_id, article_label))");
      db.exec("CREATE INDEX law_article_lookup ON articles(law_id, article_label)");
      db.exec("CREATE VIRTUAL TABLE article_fts USING fts5(seg, tokenize='unicode61')");
      const insert = db.prepare("INSERT INTO articles (law_id,law_name,chapter,article_label,text,source_url,amended_date,md_path) VALUES (?,?,?,?,?,?,?,?)");
      const index = db.prepare("INSERT INTO article_fts (rowid, seg) VALUES (?,?)");
      for (const row of rows) {
        const result = insert.run(row.law_id, row.law_name, row.chapter,
          row.article_label, row.text, row.source_url, row.amended_date, row.md_path);
        index.run(result.lastInsertRowid, lawTokens([row.law_name,row.chapter,row.article_label,row.text].join(" ")).join(" "));
      }
      const actual = Number(db.prepare("SELECT count(*) AS n FROM articles").get().n);
      const expected = manifest.laws.reduce((n, law) => n + law.article_count, 0);
      if (actual !== expected) throw new Error("SQLite article count disagrees with MANIFEST");
      db.exec("COMMIT");
      return actual;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    db.close();
  }
}
if (process.argv[1] && import.meta.url === new URL("file://" + resolve(process.argv[1])).href) {
  const idx = process.argv.indexOf("--db");
  buildLawIndex(idx >= 0 ? resolve(process.argv[idx+1]) : undefined)
    .then((count) => console.log("Law index ready: " + count + " articles"))
    .catch((error) => { console.error("Law index failed:", error.message); process.exitCode = 1; });
}
