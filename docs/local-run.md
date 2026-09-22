# 本機執行與 CLIProxyAPI OAuth

GitHub Pages 版本先保留作為公開介面與靜態 Mock；需要較安全的本機憑證與後端流程時，請在專案根目錄使用 `start-local.bat`。

## 快速啟動

1. 安裝 Node.js 20 以上，於專案根目錄執行一次：

   ```bat
   npm install
   ```

2. 將 `.env.local.example` 複製為 `.env.local`。目前只放 CLIProxyAPI 原生管理中心網址，不放 API key 或 OAuth token。

3. 將 CLIProxyAPI 執行檔放在 PATH，或先設定完整路徑：

   ```bat
   set CLIPROXY_BIN=C:\path\to\cli-proxy-api.exe
   ```

4. 雙擊 `start-local.bat`，或在命令列執行：

   ```bat
   start-local.bat
   ```

   這會啟動 Next.js 本機前端（`http://127.0.0.1:3000`），若找到 CLIProxyAPI 也會另開視窗啟動它。

## OAuth 登入

請先啟動 CLIProxyAPI，再使用以下入口。登入流程由 CLIProxyAPI 原生處理，本站不接觸憑證：

```bat
start-local.bat codex-login
start-local.bat antigravity-login
start-local.bat management
```

- Codex OAuth：官方 callback port 1455。
- Antigravity OAuth：官方 callback port 51121。
- 管理中心：`http://127.0.0.1:8317/management.html`。
- 不想自動開瀏覽器時，可在 CLIProxyAPI 所在資料夾手動加上 `--no-browser`。

完成 OAuth 後，CLIProxyAPI 會將憑證保存在自己的 `auth-dir`。請把該目錄放在本機私有位置，絕不要提交到 Git、`.env.local`、GitHub Pages 或瀏覽器端。網站只提供管理中心連結與官方登入指令，不呼叫 Management API，也不要求輸入管理密鑰或供應商 API key。

## 後端切換

目前本機啟動器不會改動公開 Pages；沒有後端設定時前端仍可使用 Mock。後續要完全本地化時，可在同一台電腦啟動受限的後端，讓後端讀取 CLIProxyAPI 的本機服務與 `auth-dir`，瀏覽器只連 `localhost`，不把管理介面公開到網際網路。

## 官方文件

- [CLIProxyAPI Quick Start](https://help.router-for.me/introduction/quick-start)
- [Codex OAuth](https://help.router-for.me/configuration/provider/codex)
- [Antigravity OAuth](https://help.router-for.me/configuration/provider/antigravity)
- [CLIProxyAPI Web UI](https://help.router-for.me/management/webui)