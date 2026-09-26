# DESIGN_AI_Teacher

建築設計與敷地考試的 AI 練習平台。它會先讀取題目和圖面，再用設計要點與基地證據提出審查意見，並把每項意見定位到作答圖上。

[開啟 GitHub Pages 展示版](https://qqqiiiaaannn.github.io/DESIGN_AI_Teacher/) · [Windows 本機啟動說明](docs/local-run.md)

## 功能

- **依考試時數調整審查**：快速方案（2–3 小時）、敷地大圖（4 小時）、公務三級（6 小時）、完整設計大圖（8 小時）；可自行調整作圖時間。
- **題目與基地判讀**：選擇歷年官方題目或上傳 PDF，讀取題目需求、基地條件及附圖。
- **知識檢索與圖面審查**：按審查主題從平台準則及可用的私有教材索引檢索要點，再以證據評分和定位。位置信心偏低時可由使用者確認或重新審查。
- **模擬題與考前練習**：參考同類歷年案例生成建築設計、敷地或三級練習題；可輸入特殊練習需求。生成的新題會附上基地條件圖，含指北、尺寸、道路、鄰地及指定基地要素。題目文字和 SVG 圖共用同一份基地資料，圖面可下載。
- **卡片對話**：每項意見可展開討論，模型會重新檢視局部圖並串流顯示回覆；有圖面證據支持時才修正判讀。
- **練習工具**：倒數計時、工作檔 JSON 匯入與匯出，以及圖面上的 SVG 定位與修改建議。

## 使用版本

### GitHub Pages 展示版

Pages 提供靜態介面與操作展示。它不執行伺服器 API，因此不會連接本機 CLIProxyAPI，也不能使用 OAuth 帳號額度生題、審圖或討論。

### 本機完整版

本機 Next.js 後端連接 CLIProxyAPI。登入後，平台會從已連線的 CLIProxyAPI `/v1/models` 動態偵測模型，不會預設舊型號。請選擇支援圖片輸入的模型進行審圖。

## Windows 快速開始

1. 安裝 Node.js 20 或更新版本。
2. 將 CLIProxyAPI 執行檔放在專案根目錄或系統 `PATH`。
3. 雙擊專案根目錄的 `start.bat`。首次執行會準備依賴；啟動器會等待前端和本機服務就緒後，再開啟 `http://127.0.0.1:3000`。
4. 在頁面右上方完成 CLIProxyAPI OAuth，選取偵測到的模型後即可使用。

API key 可放在 CLIProxyAPI 的 `config.yaml`，或本機 `.env.local` 的 `CLIPROXY_API_KEY`。OAuth 憑證由 CLIProxyAPI 保存在自己的 `auth-dir`。這些憑證不可提交到 Git 或放入 `NEXT_PUBLIC_*` 環境變數。

其他啟動、OAuth 與 PDF 設定方式見[本機執行說明](docs/local-run.md)及[CLIProxyAPI OAuth 說明](docs/cliproxyapi-oauth.md)。非 Windows 開發者可在專案目錄執行：

```bash
npm install
npm run dev
```

## 題目 PDF 與私有知識庫

閱讀 PDF 需要 Poppler 的 `pdftotext`、`pdfinfo`、`pdftoppm`。程式會搜尋 `POPPLER_BIN_DIR`、專案內的 `tools/poppler/bin` 與系統 `PATH`。若尚未安裝，審圖畫面會顯示原因；選用官方題目或上傳 PDF 都需要這些工具。

私有教材的文字、圖頁及圖片索引建立方式見[知識庫索引說明](docs/knowledge-indexing.md)。原始教材、OCR 補充及視覺向量應保留在受控的私有位置，不要提交到 Git。

## 建置與部署

```bash
npm run build
```

推送到 `main` 會觸發 GitHub Actions 建置並部署 Pages 靜態展示版。完整 AI 功能需要可執行 Next.js API 的主機與安全保存的 CLIProxyAPI 憑證；Supabase 雲端路徑的設定見[後端部署說明](docs/backend-setup.md)。

審查結果與分數是練習輔助，不是官方評分或及格判定。AI 生成題與考前猜題是模擬練習，不代表官方預測。上傳的圖面與題目會送至目前連接的模型；卡片討論只傳送對應的局部圖。工作檔可能包含私人圖面，請存放在自己控制的位置。

## 文件

- [練習情境、生成題與工作檔](docs/practice-workflow.md)
- [審查涵蓋要點](docs/spatial-review-criteria.md)
- [知識庫索引建立與稽核](docs/knowledge-indexing.md)
- [本機執行與 OAuth](docs/local-run.md)、[CLIProxyAPI OAuth](docs/cliproxyapi-oauth.md)
- [Supabase 與雲端後端部署](docs/backend-setup.md)
- [題庫索引與官方來源](data/question-bank.ts)
