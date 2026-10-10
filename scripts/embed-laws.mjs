import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";

const url = (process.env.LAW_EMBEDDINGS_URL || "").trim();
const model = (process.env.LAW_EMBEDDINGS_MODEL || "").trim();
if (!url || !model) {
  console.error("未設定 LAW_EMBEDDINGS_URL 與 LAW_EMBEDDINGS_MODEL；需指向支援 /v1/embeddings 的服務。");
  process.exit(1);
}

const max = process.argv.indexOf("--limit");
const limit = max >= 0 ? Math.max(1, Number(process.argv[max + 1]) || 1) : 9999;
const batchSize = 8;
const db = new DatabaseSync(resolve(process.env.LAW_DB_PATH || "knowledge/laws/laws.sqlite"));
try {
  const rows = db.prepare("SELECT id, law_name, article_label, text FROM articles WHERE embedding IS NULL ORDER BY id LIMIT ?").all(limit);
  const update = db.prepare("UPDATE articles SET embedding=?, embedding_model=?, embedding_dim=? WHERE id=?");
  let total = 0;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json",
          ...(process.env.LAW_EMBEDDINGS_API_KEY ? { Authorization: "Bearer " + process.env.LAW_EMBEDDINGS_API_KEY } : {}) },
        body: JSON.stringify({ model, input: batch.map((row) => row.law_name + " " + row.article_label + "\n" + row.text) }),
        signal: AbortSignal.timeout(60000)
      });
    } catch {
      throw new Error("Embeddings 服務無法連線，請檢查 LAW_EMBEDDINGS_URL、埠號與服務狀態。");
    }
    if (!response.ok) {
      const hint = [400, 404, 405, 415, 422, 501].includes(response.status)
        ? "此端點／模型可能不支援 /v1/embeddings 或批次 input。" : "請檢查認證、額度或服務健康狀態。";
      throw new Error("Embeddings 失敗 (HTTP " + response.status + ")。" + hint);
    }
    const payload = await response.json();
    if (!Array.isArray(payload.data) || payload.data.length !== batch.length) {
      throw new Error("Embeddings 回傳筆數與請求不一致，沒有寫入這批資料。");
    }
    const ordered = [...payload.data].sort((a, b) => a.index - b.index);
    const vectors = ordered.map((item, i) => {
      if (item.index !== i || !Array.isArray(item.embedding) || !item.embedding.length ||
          !item.embedding.every((x) => typeof x === "number" && Number.isFinite(x))) {
        throw new Error("Embeddings 回傳格式或向量值異常，沒有寫入這批資料。");
      }
      return item.embedding;
    });
    const dim = vectors[0].length;
    if (vectors.some((v) => v.length !== dim)) throw new Error("Embeddings 向量維度不一致。");
    db.exec("BEGIN");
    try {
      for (let i = 0; i < batch.length; i++) {
        const blob = Buffer.alloc(dim * 4);
        vectors[i].forEach((value, j) => blob.writeFloatLE(value, j * 4));
        update.run(blob, model, dim, batch[i].id);
        total++;
      }
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    console.log("已完成 " + total + " / " + rows.length + " 條 embedding");
  }
  console.log("Embeddings 完成：" + total + " 條。實機檢索品質仍須人工驗證。");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally { db.close(); }
