import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readLawSources } from "../scripts/law-md.mjs";
import { buildLawIndex } from "../scripts/build-law-index.mjs";
import { searchLaws, getArticle } from "../lib/law-retrieval.ts";

const { manifest, rows } = await readLawSources();
const dir = await mkdtemp(join(tmpdir(), "architect-law-"));
const dbPath = join(dir, "test-laws.sqlite");

test("MD article counts equal the MANIFEST for each law; every SHA-256 is valid", () => {
  for (const law of manifest.laws) {
    const matches = rows.filter((row) => row.law_id === law.law_id);
    assert.equal(matches.length, law.article_count);
    assert.equal(law.files.reduce((n, file) => n + file.article_count, 0), law.article_count);
    assert.equal(new Set(matches.map((row) => row.article_label)).size, law.article_count);
  }
  assert.equal(rows.length, 401);
});

test("SQLite index stores verbatim MD text and metadata", async () => {
  assert.equal(await buildLawIndex(dbPath), rows.length);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const indexed = db.prepare("SELECT * FROM articles ORDER BY id").all();
    assert.equal(indexed.length, rows.length);
    for (const [i, row] of indexed.entries()) {
      for (const key of ["law_id","law_name","chapter","article_label","text","source_url","amended_date","md_path"]) {
        assert.equal(row[key], rows[i][key], "MD/SQLite differ: " + key + " #" + i);
      }
    }
    assert.equal(db.prepare("SELECT count(*) AS n FROM article_fts").get().n, 401);
  } finally { db.close(); }
});

test("rebuilding is idempotent: row content, FTS size and article order do not change", async () => {
  const before = new DatabaseSync(dbPath, { readOnly: true });
  const baseline = before.prepare("SELECT law_id, article_label, text FROM articles ORDER BY id").all();
  before.close();
  assert.equal(await buildLawIndex(dbPath), 401);
  const after = new DatabaseSync(dbPath, { readOnly: true });
  try {
    assert.deepEqual(after.prepare("SELECT law_id, article_label, text FROM articles ORDER BY id").all(), baseline);
    assert.equal(after.prepare("SELECT count(*) AS n FROM article_fts").get().n, 401);
  } finally { after.close(); }
});

test("Chinese bigram FTS retrieves staircase widths, corridors and parking areas", async () => {
  for (const phrase of ["樓梯寬度", "走廊", "停車空間"]) {
    const result = await searchLaws(phrase, { limit: 20, dbPath });
    assert.ok(result.length, "no hits: " + phrase);
    assert.ok(result.some((r) => phrase === "樓梯寬度"
      ? r.text.includes("樓梯") && r.text.includes("寬度")
      : r.text.includes(phrase)), "no expected relevance: " + phrase);
  }
  assert.ok((await searchLaws("停車空間設置", { limit: 20, dbPath })).length);
});

test("article lookup accepts literal 3-1 and 之一 as the same article", async () => {
  const first = getArticle("D0070114", "第3-1條", dbPath);
  const second = getArticle("D0070114", "第3條之一", dbPath);
  assert.ok(first?.text);
  assert.deepEqual(first, second);
  assert.equal(first.articleLabel, "第 3-1 條");
  const full = await searchLaws("第3條之一", { lawIds: ["D0070114"], dbPath });
  assert.equal(full[0].articleLabel, "第 3-1 條");
  assert.equal(getArticle("D0070114", "999條", dbPath), null);
});

test("search uses FTS without vectors, and cosine reranks a fake vector pair", async () => {
  const plain = await searchLaws("樓梯寬度", { limit: 8, dbPath });
  assert.ok(plain.length >= 2);
  const db = new DatabaseSync(dbPath);
  try {
    const update = db.prepare("UPDATE articles SET embedding=?, embedding_model=?, embedding_dim=? WHERE law_id=? AND article_label=?");
    const write = (vec, row) => {
      const bytes = Buffer.alloc(8);
      vec.forEach((v, i) => bytes.writeFloatLE(v, i * 4));
      update.run(bytes, "fake-vector-only", 2, row.lawId, row.articleLabel);
    };
    write([0,1], plain[0]);
    write([1,0], plain[1]);
  } finally { db.close(); }
  const reordered = await searchLaws("樓梯寬度", { limit: 8, dbPath, queryEmbedding: [1,0] });
  assert.equal(reordered[0].articleLabel, plain[1].articleLabel);
  assert.equal(reordered[0].lawId, plain[1].lawId);
  const fallback = await searchLaws("樓梯寬度", { limit: 8, dbPath });
  assert.deepEqual(fallback.map((x) => x.articleLabel), plain.map((x) => x.articleLabel));
});

test("lawIds filter limits search to selected law only", async () => {
  const found = await searchLaws("樓梯", { limit: 15, lawIds: ["D0070115"], dbPath });
  assert.ok(found.length);
  assert.ok(found.every((x) => x.lawId === "D0070115"));
  assert.deepEqual(await searchLaws("樓梯", { lawIds: [], dbPath }), []);
});
