# DESIGN_AI_Teacher

建築師考試「建築設計 / 敷地繪圖」AI 輔助練習平台。

## 產品核心

不是單純讓 AI 對圖面產生文字講評，而是把審圖結果轉成可操作的圖面層：

1. 選定官方題目或上傳題目 PDF，再上傳完整作答圖。
2. 平台自動讀取題目需求與基地條件，辨識圖面後檢索相關知識要點。
3. AI 依結構化 rubric 審圖，回傳問題與評分的證據信心及圖面定位信心。
4. 用 SVG overlay 框選錯誤區域。
5. 位置不確定時由使用者點選圖面確認；局部修改可產生 SVG 或圖片編修圖。
6. 若局部圖面不足以可靠判讀，主動要求補上高解析局部圖。
7. 補圖後針對同一區域重新精審，而不是硬猜。
8. 後續累積個人歷次弱點與進步軌跡。

## 目前 MVP v0.2

- Next.js + TypeScript
- JPG / PNG 圖面上傳
- SVG 問題框選
- SVG redline 示意
- normalized coordinates
- 結構化評分面板
- 問題清單與修改建議
- Clarity Gate / 需補圖狀態
- 局部圖片補傳 UI
- Responsive UI
- GitHub Actions 建置與 Pages 展示版
- Server-side `/api/review` endpoint
- 可替換的 Review Provider adapter

本機前端透過 `/api/review` 呼叫 server-side Review Provider，預設連接 CLIProxyAPI。服務會從已連線的 CLIProxyAPI `/v1/models` 動態取得模型，不預設過時型號；完成 OAuth 並有支援圖片輸入的模型後，即可使用該帳號額度進行整圖審查與局部補圖精審。離線示範需明確設定 `REVIEW_PROVIDER=mock`。

## AI Pipeline

```
Selected official PDF / uploaded question PDF
  ↓
Question and site context reading
  ↓
Drawing upload and image normalization
  ↓
Global vision pass
  ↓
RAG over canonical platform knowledge and an optional private course index
  ↓
Evidence-gated rubric review
  ├─ clear → scored issue
  └─ uncertain → location confirmation or supplemental crop → re-review
  ↓
SVG annotation / on-demand SVG or image edit
```

## 文件

- `docs/PRD-v0.2.md`：MVP 產品規格與驗證方法
- `docs/review-schema.md`：Review JSON 與補圖資料結構
- `lib/review-schema.ts`：前端共用 TypeScript types

## RAG 建議

資料至少拆成：

- `rubrics`：老師講義與評圖原則
- `cases`：高分 / 低分案例及評論
- `codes`：法規與無障礙規範
- `visual_refs`：圖面案例與視覺 embedding

不要一開始把所有 PDF、圖面、法規塞進同一個 collection。那不是知識庫，是 AI 廚餘桶。

## MVP 驗證

建議先準備 30～50 張已有真人老師批改結果的練習圖，評估：

- 問題召回率
- 問題精確率
- SVG 定位準確度
- 紅線修改有用程度
- 補圖要求是否合理
- 看不清楚卻硬判的比例

最後一項應作為關鍵品質指標。

## 商業化預留

後續可加入：

- account
- practice_session
- drawing
- review
- review_issue
- supplemental_crop
- usage_credit
- payment_transaction
- knowledge_source

第一階段比起月訂閱，更適合測試「整張審圖 / 局部精審 / 紅線改圖」點數制。

## 開發

```bash
npm install
npm run dev
```

Windows 請雙擊根目錄的 `start.bat`；啟動器會準備依賴、背景啟動本機 CLIProxyAPI（若執行檔可用），並確認前端健康檢查通過後才開啟 http://127.0.0.1:3000。其他 Windows 輔助腳本集中在 `scripts/windows/`。CLIProxyAPI API key 請放在 `config.yaml` 的 `api-keys` 或 `.env.local` 的 `CLIPROXY_API_KEY`，不可放入 `NEXT_PUBLIC_*` 變數。

私有 PDF、課程圖面與圖片的文字及視覺索引建立方式見 [docs/knowledge-indexing.md](docs/knowledge-indexing.md)。索引可供本機 CLI 審圖按主題檢索；原始教材與向量檔不進 Git。四種作圖情境、歷年案例生成練習題、計時、審圖工作檔匯入匯出與卡片討論方式見 [docs/practice-workflow.md](docs/practice-workflow.md)。

AI 練習題可輸入特殊需求，並產生帶有指北、尺寸、道路與鄰地的基地示意圖；題目文字與 SVG 共用基地條件。審圖卡片討論會逐步顯示模型回覆。GitHub Pages 為不含後端的靜態展示版；OAuth、帳號額度審圖、AI 生題與串流討論需使用本機完整版本。

自動閱讀題目 PDF 需要 Poppler 的 `pdftotext`、`pdfinfo`、`pdftoppm`。程式先找 `POPPLER_BIN_DIR` 指定的資料夾、專案內的 `tools/poppler/bin`、本機 Codex 隨附的 Poppler，再找系統 PATH。若都沒有，請安裝 Poppler 並設定 `POPPLER_BIN_DIR`；審圖畫面會顯示缺少工具的原因。


## Backend setup

Supabase schema、私有儲存與受保護的 CLIProxyAPI Edge Function 部署方式見 [docs/backend-setup.md](docs/backend-setup.md)。題庫索引位於 [`data/question-bank.ts`](data/question-bank.ts)，連結官方 PDF。Windows 本機 OAuth、啟動與審圖流程見 [docs/local-run.md](docs/local-run.md) 與 [docs/cliproxyapi-oauth.md](docs/cliproxyapi-oauth.md)。
