import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
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
    assert.equal(db.prepare("SELECT count(*) AS n FROM article_fts").get().n,
      db.prepare("SELECT count(*) AS n FROM articles WHERE is_deleted=0").get().n);
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


test("deleted articles stay available by ID but never contaminate FTS ranking", async () => {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const deleted = db.prepare("SELECT * FROM articles WHERE is_deleted=1").all();
    assert.ok(deleted.length >= 25, "Expected deleted article records to be retained");
    assert.ok(deleted.every(row => /^[（(]刪除[）)]$/.test(row.text.replace(/\s+/g, ""))));
    assert.equal(db.prepare("SELECT count(*) AS n FROM article_fts").get().n, 401 - deleted.length);
    const ftsDeleted = db.prepare("SELECT count(*) AS n FROM article_fts JOIN articles a ON a.id=article_fts.rowid WHERE a.is_deleted=1").get().n;
    assert.equal(ftsDeleted, 0);
    const first = deleted.find(row => row.law_id === "D0070115" && row.article_label === "第 89-1 條");
    assert.ok(first);
    assert.equal(getArticle("D0070115", "第89-1條", dbPath)?.text, first.text);
    assert.deepEqual(await searchLaws("第89-1條", { dbPath }), []);
    assert.equal((await searchLaws("第89-1條", { dbPath, includeDeleted: true }))[0].articleLabel, first.article_label);
  } finally { db.close(); }
});

test("four problem queries exclude deleted articles from the top five", async () => {
  for (const query of ["無障礙 坡道", "日照 採光", "防火避難 樓梯", "走廊"]) {
    const results = await searchLaws(query, { dbPath, limit: 5 });
    assert.equal(results.length, 5, "Expected five legal article results for " + query);
    for (const result of results) {
      assert.ok(!/^[（(]刪除[）)]$/.test(result.text.replace(/\s+/g, "")), query + ": " + result.articleLabel);
    }
    if (query === "無障礙 坡道") {
      assert.ok(results.some(row => row.chapter.includes("第 十 章 無障礙建築物")),
        "Top 5 should include active Chapter 10 accessibility articles");
    }
  }
});

test("Chinese numeric main article and increment convert to exact direct lookup only", async () => {
  for (const [phrase, label] of [
    ["第三十三條", "第 33 條"],
    ["第三十三條之一", "第 33-1 條"],
    ["第三百二十三條", "第 323 條"],
    ["第一百六十七條之一", "第 167-1 條"],
    ["第九十二條", "第 92 條"]
  ]) {
    const expected = getArticle("D0070115", label, dbPath);
    if (expected) {
      assert.equal(getArticle("D0070115", phrase, dbPath)?.text, expected.text);
      assert.equal((await searchLaws(phrase, { dbPath, lawIds: ["D0070115"] }))[0]?.articleLabel, label);
    } else {
      assert.deepEqual(await searchLaws(phrase, { dbPath }), []);
    }
  }
  assert.deepEqual(await searchLaws("第三十三條之二百零一", { dbPath }), []);
});

test("25 exam-oriented searches have measured source-grounded recall@10", async () => {
  const examples = JSON.parse(await readFile(new URL("./law-eval.json", import.meta.url), "utf8"));
  let hitCount = 0;
  for (const row of examples) {
    for (const target of row.expected) {
      assert.ok(rows.find(source => source.law_id === target.lawId && source.article_label === target.articleLabel),
        "Evaluation target absent from verbatim Markdown: " + row.query);
    }
    const top = await searchLaws(row.query, { dbPath, limit: 10 });
    const hit = row.expected.some(target => top.some(result => result.lawId === target.lawId &&
      result.articleLabel === target.articleLabel));
    if (hit) hitCount++;
    else console.log("Law eval miss: " + row.query + "; top articles: " +
      top.slice(0, 5).map(item => item.articleLabel + "/" + item.lawId).join(", "));
  }
  const rate = hitCount / examples.length;
  console.log("Law retrieval recall@10: " + hitCount + "/" + examples.length +
    " = " + (rate * 100).toFixed(1) + "%");
  assert.ok(examples.length >= 20);
  assert.ok(rate >= 0.8, "Recall@10 falls below 80%");
});
