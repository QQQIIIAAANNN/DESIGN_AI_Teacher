# CLIProxyAPI OAuth 登入設定

本平台不直接呼叫 CLIProxyAPI Management API，也不要求在網站輸入管理密鑰或供應商 API key。OAuth 登入由 CLIProxyAPI 自己的本機管理中心或命令列完成，平台右上角的「CLIProxyAPI 設定」只提供入口與指令複製。

## 方式一：CLIProxyAPI 原生管理中心

CLIProxyAPI 啟動後，開啟：

```
http://127.0.0.1:8317/management.html
```

管理中心是 CLIProxyAPI 官方提供的 Web UI；在同一個管理中心完成 Codex / Antigravity OAuth 登入，憑證會由 CLIProxyAPI 寫入自己的 `auth-dir`。平台不會接觸 OAuth token。

## 方式二：本機命令列

在 CLIProxyAPI 所在電腦執行官方登入命令：

```bash
# Codex（本機 callback port 1455）
./cli-proxy-api --codex-login

# Antigravity（本機 callback port 51121）
./cli-proxy-api --antigravity-login
```

若不希望程式自動開啟瀏覽器，可加上 `--no-browser`，讓 CLIProxyAPI 印出登入網址。Windows 執行檔可將前綴改為 `cli-proxy-api.exe`。

## 重要界線

- 這裡使用的是 Codex / Antigravity OAuth，不是 `codex-api-key` 或其他另外計費的供應商 API key。
- 網站只負責開啟 `/management.html` 與複製官方 CLI 指令，不會把 API key、管理密鑰或 OAuth token 放進 GitHub Pages。
- `auth-dir` 應放在 CLIProxyAPI 主機的私有目錄，不能提交到 Git。
- GitHub Pages 與 CLIProxyAPI 可分開運作；要讓正式 AI 審圖使用 CLIProxyAPI，仍需另外完成 Supabase Edge Function 的伺服器端模型設定。

## 官方文件

- [CLIProxyAPI Quick Start](https://help.router-for.me/introduction/quick-start)
- [Codex OAuth](https://help.router-for.me/configuration/provider/codex)
- [Antigravity OAuth](https://help.router-for.me/configuration/provider/antigravity)
- [CLIProxyAPI Web UI](https://help.router-for.me/management/webui)
