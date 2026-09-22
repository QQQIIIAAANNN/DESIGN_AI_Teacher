# CLIProxyAPI OAuth 登入

本專案的登入面板使用 CLIProxyAPI 官方管理端 OAuth 流程，提供兩個入口：

- `GET /v0/management/codex-auth-url?is_webui=true`
- `GET /v0/management/antigravity-auth-url?is_webui=true`

按鈕會先取得授權網址與 `state`，在新視窗完成供應商 OAuth，接著輪詢
`GET /v0/management/get-auth-status?state=...`。成功後由 CLIProxyAPI 寫入自己的
`auth-dir`；平台不會把 OAuth token 寫進 GitHub、Supabase 或瀏覽器儲存空間。

## CLIProxyAPI 端

請使用 CLIProxyAPI 的 management 設定與版本文件確認實際埠號，至少要有管理密鑰：

```yaml
remote-management:
  allow-remote: false
  secret-key: "請放在 CLIProxyAPI 主機的秘密設定，不要提交到 Git"
```

個人使用時建議讓 CLIProxyAPI 只監聽本機 `127.0.0.1:8317`。若要從 GitHub Pages 呼叫遠端服務，必須改用受 TLS 保護的私有 HTTPS 位址、明確設定 CORS 與 `allow-remote`，並限制網路來源；不要把 management API 或密鑰直接公開到網際網路。

管理密鑰是 CLIProxyAPI 的管理權限，不是 Codex、Antigravity 或其他供應商的 API key，也不會透過 `NEXT_PUBLIC_*` 變數編譯進頁面。使用者在面板輸入後只留在這次 React 工作階段，供每次管理端請求使用。

## 前端設定

若前端與 CLIProxyAPI 同一台電腦，可把：

```
NEXT_PUBLIC_CLIPROXY_MANAGEMENT_URL=http://127.0.0.1:8317
```

放入建置環境；若是公開 HTTPS Pages，遠端位址也應使用 HTTPS，否則瀏覽器可能阻擋跨來源或 mixed-content 請求。公開頁面不應預填或保存 management key。

## 與 API key 的區別

這裡的按鈕只做供應商 OAuth 登入，對應 CLIProxyAPI 的 OAuth auth-url 路由；它不會建立 `codex-api-key`、`api-keys` 或其他按用量計費的 API key。OAuth 憑證的保存、更新與撤銷都由 CLIProxyAPI 的 `auth-dir` 與 management API 負責。

## 官方文件

- [CLIProxyAPI 官方 repository](https://github.com/router-for-me/CLIProxyAPI)
- [CLIProxyAPI 基本設定](https://github.com/router-for-me/CLIProxyAPIDocs/blob/main/docs/en/configuration/basic.md)
