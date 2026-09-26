# 本機執行與 CLIProxyAPI OAuth

本機版本使用 Next.js server-side API 連接 CLIProxyAPI，圖面與 API key 不會經過公開 GitHub Pages。請雙擊專案根目錄的 `start.bat`。

## 快速啟動

1. 安裝 Node.js 20 以上，於專案根目錄執行一次：

   ```bat
   npm install
   ```

2. 首次啟動會從 `.env.local.example` 建立 `.env.local`。CLIProxyAPI API key 可留在 CLIProxyAPI 的 `config.yaml`，或設在 `.env.local` 的 `CLIPROXY_API_KEY`；此值只由伺服器讀取，勿使用 `NEXT_PUBLIC_` 前綴。OAuth token 由 CLIProxyAPI 保存。

3. 將 CLIProxyAPI 執行檔放在 PATH，或先設定完整路徑：

   ```bat
   set CLIPROXY_BIN=C:\path\to\cli-proxy-api.exe
   ```

4. 雙擊 `start.bat`，或在命令列執行：

   ```bat
   start.bat
   ```

   啟動器會檢查依賴、背景啟動本機 CLIProxyAPI，等待 Next.js 與狀態 API 就緒後再開啟 `http://127.0.0.1:3000`。如果還沒有執行檔，可在設定面板下載，或先放在專案根目錄／PATH。

## OAuth 登入

登入流程由 CLIProxyAPI 原生處理，本站不接觸憑證。可從網站右上角「CLIProxyAPI 設定」一鍵開啟 OAuth，也可使用以下入口：

```bat
scripts\windows\start-local.bat codex-login
scripts\windows\start-local.bat antigravity-login
scripts\windows\start-local.bat management
```

- Codex OAuth：官方 callback port 1455。
- Antigravity OAuth：官方 callback port 51121。
- 管理中心：`http://127.0.0.1:8317/management.html`。
- 不想自動開瀏覽器時，可在 CLIProxyAPI 所在資料夾手動加上 `--no-browser`。

完成 OAuth 後，CLIProxyAPI 會將憑證保存在自己的 `auth-dir`。請把該目錄放在本機私有位置，絕不要提交到 Git、`.env.local`、GitHub Pages 或瀏覽器端。網站後端會用 API key 查詢 `/v1/models` 並呼叫 `/v1/chat/completions`；面板會顯示目前連線與模型狀態，審圖模型從該清單動態取得。

## 題目 PDF 閱讀

選定歷年題目後，審圖時會即時讀取官方 PDF；也可在首頁上傳自己的題目 PDF，上傳檔優先使用。系統擷取文字及前幾頁附圖，交給已連線模型辨識題目需求、基地條件與不確定處，再做知識檢索和審圖。題目未提供或內容不清時，分數會標示為暫評。

PDF 轉文字與頁面圖片使用 Poppler。若電腦未能找到 `pdftotext`、`pdfinfo`、`pdftoppm`，請將 Poppler 的 `bin` 資料夾設為 `POPPLER_BIN_DIR`（也可在 `.env.local` 中設定）。程式也會尋找專案 `tools/poppler/bin`、本機 Codex 隨附路徑及系統 PATH。官方題目來源暫時無法下載時，可直接上傳 PDF。

## 後端切換

瀏覽器只連本機 Next.js；API key 僅存在伺服器環境或 CLIProxyAPI 設定中。若沒有可用的 OAuth 模型，介面會顯示連線原因，不會靜默改用 Mock 結果。

## 官方文件

- [CLIProxyAPI Quick Start](https://help.router-for.me/introduction/quick-start)
- [Codex OAuth](https://help.router-for.me/configuration/provider/codex)
- [Antigravity OAuth](https://help.router-for.me/configuration/provider/antigravity)
- [CLIProxyAPI Web UI](https://help.router-for.me/management/webui)
