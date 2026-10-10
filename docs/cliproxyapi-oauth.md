# CLIProxyAPI OAuth 登入設定

OAuth 登入由 CLIProxyAPI 自己的本機管理中心或命令列完成，平台右上角的「CLIProxyAPI 設定」提供登入入口、連線狀態與模型清單。審圖請求由本機 Next.js 後端透過 CLIProxyAPI 的相容 API 傳送；CLIProxyAPI client API key 僅放在 `config.yaml` 的 `api-keys` 或伺服器端 `.env.local`，不會送到瀏覽器。

## 方式一：CLIProxyAPI 原生管理中心

CLIProxyAPI 啟動後，開啟：

```
http://127.0.0.1:8317/management.html
```

管理中心是 CLIProxyAPI 官方提供的 Web UI；在同一個管理中心完成 Codex / Antigravity / Claude OAuth 登入，憑證會由 CLIProxyAPI 寫入自己的 `auth-dir`。平台不會接觸 OAuth token。

## 方式二：本機命令列

在 CLIProxyAPI 所在電腦執行官方登入命令：

```bash
# Codex（本機 callback port 1455）
./cli-proxy-api --codex-login

# Antigravity（本機 callback port 51121）
./cli-proxy-api --antigravity-login

# Claude（Claude Pro / Max 訂閱帳號；見下方條款風險）
./cli-proxy-api --claude-login
```

Claude 登入可加 `--oauth-callback-port <port>` 更換本機 callback 埠（預設埠與 CLIProxyAPI 版本有關，埠被占用或被防火牆擋下時使用）。登入完成後憑證寫入 `auth-dir`，檔名為 `claude-<帳號識別>-<時間>.json`，權限 `0600`，內含 access／refresh token，等同帳號完整存取權，不可分享或提交 Git。

若不希望程式自動開啟瀏覽器，可加上 `--no-browser`，讓 CLIProxyAPI 印出登入網址。Windows 執行檔可將前綴改為 `cli-proxy-api.exe`。

## Claude OAuth 的條款風險（請先閱讀）

Anthropic 已公開表示：Claude Free／Pro／Max 訂閱的 OAuth 憑證僅限 Claude Code 與 claude.ai 使用；用於其他產品、工具或服務（包含代理轉發）屬未授權，違反消費者條款，且不允許第三方提供 Claude.ai 登入。開發產品應改用 Claude Console 的 API key 或支援的雲端供應商。啟用本項前請自行評估帳號受限風險；本專案預設不要求、也不預設選用 Claude OAuth 模型。這是 2026 年 2 月的公開說明，條款可能再調整，請以 Anthropic 最新官方條款為準。

## 重要界線

- 這裡使用的是 Codex / Antigravity / Claude OAuth，不是 `codex-api-key` 或其他另外計費的供應商 API key。
- 網站不會把 CLIProxyAPI API key、管理密鑰或 OAuth token 放進瀏覽器或 GitHub Pages。
- `auth-dir` 應放在 CLIProxyAPI 主機的私有目錄，不能提交到 Git。
- `/v1/models` 的結果會成為目前模型選單；完整審圖與局部補圖精審都會使用選定的已發現模型。

## 官方文件

- [CLIProxyAPI Quick Start](https://help.router-for.me/introduction/quick-start)
- [Codex OAuth](https://help.router-for.me/configuration/provider/codex)
- [Antigravity OAuth](https://help.router-for.me/configuration/provider/antigravity)
- [CLIProxyAPI Web UI](https://help.router-for.me/management/webui)


## Windows 本機快速入口

專案根目錄的 `start.bat` 會啟動本機 Next.js，並在背景啟動可找到的 CLIProxyAPI 執行檔：

```bat
start.bat
```

登入與管理中心可直接使用：

```bat
scripts\windows\start-local.bat codex-login
scripts\windows\start-local.bat antigravity-login
scripts\windows\start-local.bat claude-login
scripts\windows\start-local.bat management
```

若執行檔不在 PATH，先設定：

```bat
set CLIPROXY_BIN=C:\path\to\cli-proxy-api.exe
```

這些入口呼叫 CLIProxyAPI 的原生 OAuth 命令；OAuth token 與 `auth-dir` 留在本機，API key 由後端讀取，不會送到瀏覽器。
