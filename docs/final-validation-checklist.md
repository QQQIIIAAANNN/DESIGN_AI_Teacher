# CLIProxyAPI 最終人工驗收清單

目前為 **實機尚未驗證** 清單。用本機 Next.js 服務，`NEXT_PUBLIC_SUPABASE_*` 皆保持未設定。記錄模型、版本、日期、測試圖檔與執行結果；有失敗不得標示通過。

| 驗收項目 | 操作步驟 | 通過標準 |
| --- | --- | --- |
| 本機審圖 | 啟動 CLIProxyAPI + Next.js，選視覺模型，上傳一張建築平面圖、點審圖 | `/api/review` HTTP 200，產出可定位意見，無 Supabase 網路請求 |
| 局部精審／重評 | 對可辨識問題上傳局部補圖，並對關聯分項執行 rescore | 兩個 Next API 成功更新意見／分數，不依賴 Supabase |
| 題目與題庫 | 開啟題庫索引、選既有題目，並用「練圖專區」生成模擬題 | 題庫可閱讀；`/api/questions/generate` 輸出符合 schema 的題目，不需 Supabase |
| ROI 確認門檻 | 選問題，未按「確認修改位置」前觀察生成按鈕；移動 ROI 後再檢查 | 未確認不能生成；移動位置會失效；單純點擊不失效 |
| 雙圖與 mask | 確認 ROI 後使用支援 `images/edits` 的模型，檢查代理請求及回應 | 送入局部圖＋全圖 context＋後端 mask，輸出 size 與 frame 一致 |
| ROI 外原像素不變 | 保存 Before／After PNG，逐像素比對 ROI 外的 RGBA 值，含貼邊與非正方形圖片 | ROI 外每一像素通道均完全相等（0 差異）；ROI 內有可辨識設計變更 |
| 歷史版本 | 同一題不同 ROI 或重生成兩次，再切換歷史下拉選單 | 兩次 Before/After 均可切換，原始版本不被覆寫 |
| Embeddings API | 先單獨 POST `/v1/embeddings`，再 `npm run laws:embed -- --limit 2` | 回傳有效相同維度數值向量，兩筆 `embedding_dim` 與 BLOB 長度一致；不支援時明確提示 |
| 中文法規查詢 | `npm run laws:search -- "樓梯寬度"`、`"走廊"`、`"停車空間"` | 結果包含真正相關條文，條號可開官方來源，原文逐字一致 |
| 增訂條號 | 對 `第3-1條`、`第3條之一` 與另一增訂條號直查 | 同一條號回傳相同原文，未找到時不捏造結果 |
| 快照一致性 | 對照 `MANIFEST.json`、Markdown、SQLite；抽樣對照官網當日版本 | 12＋389 條、SHA 與 SQLite 一致；官方逐條抽查沒有文字遺漏，差異有明確紀錄 |
| 極端長寬比 | 手動框選 17:1 或 1:17 的細長 ROI 生圖 | 記錄實際有效像素與生圖品質；本輪不保證品質，若不佳需另排改善 |
| 狀態與隱私 | 測試重新整理／重啟 Next.js，檢查回饋與改圖歷史 | 回饋本機持久化正常；**改圖歷史目前只有瀏覽器工作階段**，重整後不應假裝已保存 |
| API 存取安全 | 確認 Next.js 僅受信任網路可存取，再測未登入 API | local-only 模式本身沒有雲端身分門禁；對外部署前必須另加安全控制 |


## 官方法規逐條人工抽查（尚未驗證）

目前 401/401 條已經由獨立程序確認與 **Openlawtw 固定快照**逐字一致，但 **沒有透過自動化驗證全國法規資料庫的現行官方原文**。請人工開啟官方「單條條文」連結，注意修正日期、現行／歷史版本、生效日期以及附件；不可僅比對搜尋引擎摘要。

官方網址形式：
\`https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=D0070115&flno=34\`。
如網站重新導向，請於官方「所有條文」頁選擇相同條號，切勿自行推定內容。

| 勾選 | 法規與條號 | 官方逐條網址 | 比對重點 |
| --- | --- | --- | --- |
| [ ] | 總則編第 1 條 | https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=D0070114&flno=1 | 法規授權依據的完整語句 |
| [ ] | 總則編第 3-3 條 | https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=D0070114&flno=3-3 | 增訂條號及逐段內容 |
| [ ] | 設計施工編第 34 條 | https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=D0070115&flno=34 | 樓梯平台深度及尺度文字 |
| [ ] | 設計施工編第 59 條 | https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=D0070115&flno=59 | 停車空間表格：框線、數字、單位、換行 |
| [ ] | 設計施工編第 92 條 | https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=D0070115&flno=92 | 走廊寬度表格及行首縮排 |
| [ ] | 設計施工編第 167-1 條 | https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=D0070115&flno=167-1 | 無障礙通路，含「之一」條號 |
| [ ] | 設計施工編第 89-1 條（刪除） | https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=D0070115&flno=89-1 | 刪除狀態及官方版本是否仍相同 |
| [ ] | 設計施工編第 323 條（最後一條） | https://law.moj.gov.tw/LawClass/LawSingle.aspx?pcode=D0070115&flno=323 | 綠建材設計技術規範引用及結尾 |

人工比對步驟：

1. 開啟本地 \`knowledge/laws/D0070114/chapter-01.md\`，以及 D0070115 對應分章 Markdown；用 \`npm run laws:search -- "第34條"\` 或 \`getArticle()\` 核對 SQLite 條文。
2. 將官方單條的**完整文字**（含項、款、數字、刪除標記）與 MD／SQLite 原文逐行比對。表格需保留項序和每個儲存格，不應只比較整段純文字的大意；官方 HTML 的排版換行若有差異，另列記錄，不得默默修改文字。
3. 記錄抽查日期、官方頁面顯示的修正／施行日期、比對結果、官方網址和差異；任何不一致先標記為「待人工核對」，不得宣稱最新法規已驗證，也不要由 LLM 自行補法條。
4. 八條全通過才能宣稱「指定八條抽查通過」；**不代表其餘 393 條全部已核對**。正式上線前另需建立週期性版本更新與全面比對流程。

**停止條件：** 條文內容與官方版本衝突、資料缺頁、模型改動 ROI 外畫面、回傳尺寸異常或含虛構法規結論時，應停止發布相關 AI 改圖示範，保留原始輸入、輸出及失敗紀錄供排查。
