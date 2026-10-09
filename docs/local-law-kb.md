# Local-only 法規資料庫與暫停 Supabase 的路徑

**狀態：預設 local-only；Supabase 路徑暫停，未刪除現有 \`supabase/\` 或 migrations。**

## 操作範圍

使用完整 Next.js 服務（\`npm run dev\` 或 \`npm run start\`），不設定 \`NEXT_PUBLIC_SUPABASE_URL\` 與 \`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY\`。使用 GitHub Pages 靜態頁面時，Next API 不存在，不能當作完整功能驗證。

已逐一做原始碼路徑檢查，**尚未使用真實 CLIProxyAPI 實機執行**：

| 功能 | 本機可用路徑 | 條件／限制 |
| --- | --- | --- |
| 審圖 | \`app/page.tsx\` → \`/api/review\` → \`review-provider\` → CLIProxyAPI | 需偵測並選擇已連線的視覺模型 |
| 局部精審 | \`/api/review/supplement\` → \`review-provider\` | 同上 |
| 局部 rescore | \`/api/review/rescore\` → \`review-provider\` | 同上 |
| 圖面討論／回饋 | \`/api/review/discuss\` → CLIProxyAPI；\`/api/review/feedback\` → \`review-memory\` 本機檔案 | 本機檔案目錄需可寫 |
| visual revision | \`/api/visual-revision\` → CLIProxyAPI \`/v1/images/edits\` | 必須支援雙圖、PNG mask 及固定輸出尺寸；尚未實機驗證，ROI 歷史僅在瀏覽器工作階段 |
| 出題練習 | \`/api/questions/generate\` → CLIProxyAPI，使用 \`data/question-bank.ts\` | 題庫索引與 PDF 為本機資料 |
| 題庫瀏覽及自訂題目 | \`app/question-bank.tsx\` 使用本地索引／瀏覽器狀態 | 自訂題目不是共享雲端題庫；需留意瀏覽器暫存的保存限制 |
| 補充 SVG 建議 | \`/api/review\` action=suggestion → 本機模型 | 非 ROI 改圖入口 |

沒有設定 Supabase 時，\`lib/server-auth.ts\` 放行本機 API，\`reviewApiHeaders()\` 不送登入資訊；\`liveReviewEnabled\` 的舊 Supabase 流程不啟動。\`lib/ai-proxy-client.ts\` 仍保留以前的 Supabase 專用呼叫程式，但本機 UI 優先走 Next API，**沒有移除**舊功能。不要把這份程式路徑檢查誤稱為端到端測試。

本機 API 目前缺少雲端會員門禁，僅應在受控開發環境或另有網路存取防護的服務器運行；**不可因不使用 Supabase 就把 Next API 無限制公開至網際網路**。

## 法規快照與來源

- 來源專案：<https://github.com/termcavetw/openlawtw>
- 固定版本：\`55760b591e8bb1560e8faf6ec1bb734128682464\`
- 原文來源：\`laws/D0070114.html\` 與 \`laws/D0070115.html\` 的 \`openlawtw-law-snapshot\` JSON；原始頁面依 \`law.moj.gov.tw\`，不是模型生成文字
- 來源快照擷取：2026-09-28T05:46:15+00:00；本庫匯入：2026-10-09
- 總則編 D0070114：12 條，來源修正日 2020-10-19
- 建築設計施工編 D0070115：389 條，來源修正日 2026-02-23
- Markdown：\`knowledge/laws/<法規ID>/chapter-XX.md\`，按章分檔；不具章節的總則編使用單一檔案
- \`knowledge/laws/MANIFEST.json\`：來源、固定 SHA、條數、每檔 SHA-256。每次建庫會逐檔驗證，數量、雜湊或中繼資料不一致會停止

注意：第三方完整快照的 401 條、章節結構與條號已核對其自身 JSON/HTML，**尚未由本專案獨立逐條比對官網當日版本**。修正日、資料擷取日與法規施行日不同，不能混用。圖表、附件、法規適用條件需要另核對原始官方文件。保留 Openlawtw 的 [資料來源與權利說明](https://github.com/termcavetw/openlawtw/blob/main/DATA_LICENSE.md)。

## 建庫與檢索

Node.js 22.16+ 或 Node 24（使用內建 \`node:sqlite\` 與 \`--experimental-strip-types\`，不安裝任何 SQLite 原生相依套件）：

\`\`\`sh
npm ci
npm run laws:build
npm run laws:search -- "樓梯寬度"
npm run laws:search -- "走廊"
npm run laws:search -- "第33-1條"
npm test
\`\`\`

\`scripts/build-law-index.mjs\` 以 Markdown 為權威重建 \`knowledge/laws/laws.sqlite\`。重建會清除 DB 中舊 embeddings，因此若已建立向量，請另行備份或重跑 embedding。全文檢索使用 FTS5 \`unicode61\`，在寫入與查詢時都切中文連續二字詞（bigram），以 OR 與 \`bm25\` 找候選。長短字詞並不保證語意判讀，應定期抽查結果及原文。

SQLite 欄位依 PR 的 \`articles\` schema，\`embedding\`、\`embedding_model\` 與 \`embedding_dim\` 預設為 NULL。\`lib/law-retrieval.ts\` 提供 \`searchLaws(query, { limit, lawIds })\` 及 \`getArticle(lawId, articleLabel)\`。條號支援 \`第33條\`、\`33條\`、\`第33-1條\`、\`第33條之一\`。

## Embeddings（選配，未驗證）

純 FTS 不需要 embeddings、API key 或大型本地模型。只有使用者確認 CLIProxyAPI 實際支援 \`/v1/embeddings\` 後，再設定：

\`\`\`sh
LAW_EMBEDDINGS_URL=http://127.0.0.1:8317/v1/embeddings
LAW_EMBEDDINGS_MODEL=<已連線、支援 embeddings 的模型>
LAW_EMBEDDINGS_API_KEY=<視服務需求設定>
npm run laws:embed -- --limit 20
\`\`\`

\`laws:embed\` 將 Float32 little-endian BLOB 存入 SQLite。若模型或端點不支援會顯示清楚的 HTTP 訊息，不會自動下載模型。\`searchLaws\` 先做 FTS 候選檢索；已有向量時，如果有 \`queryEmbedding\` 或環境變數指定的 embeddings 端點，便用 cosine 重排；無向量或未設定端點時仍使用純 FTS。**真實 embeddings 路徑尚未驗證，只有假向量單元測試。**

SQLite 若因附加 embeddings 而超過 Git 管理門檻，應不要提交大檔並以 \`npm run laws:build\` 重建；超過 20MB 時需加入 \`.gitignore\`。

## 後續整合界線

目前法規資料庫**沒有接入審圖 prompt**。新功能不得新增 Supabase 依賴：法規、回饋、改圖歷史應改採本機資料夾或 SQLite。重建、引用和官方差異審查見 [final-validation-checklist.md](final-validation-checklist.md)。
