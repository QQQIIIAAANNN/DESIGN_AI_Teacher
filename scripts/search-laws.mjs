import { searchLaws } from "../lib/law-retrieval.ts";

const query = process.argv.slice(2).join(" ").trim();
if (!query) {
  console.error('用法：npm run laws:search -- "樓梯寬度"');
  process.exitCode = 1;
} else {
  try {
    const rows = await searchLaws(query, { limit: 10 });
    for (const row of rows) {
      console.log(row.lawId + " " + row.articleLabel + "｜" + row.chapter + "｜score=" + row.score.toFixed(4));
      console.log(row.text.slice(0, 180).replace(/\n/g, " ") + (row.text.length > 180 ? "…" : ""));
      console.log(row.sourceUrl);
    }
    if (!rows.length) console.log("沒有找到符合的條文。");
  } catch (error) {
    console.error("法規檢索失敗：", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
