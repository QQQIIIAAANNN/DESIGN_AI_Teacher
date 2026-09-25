# CLIProxyAPI 私有服務檢查表

這份檢查表是給正式接上 Supabase Edge Function 前使用。CLIProxyAPI 本身只提供 OpenAI / Gemini / Claude / Codex 相容的 API 介面；本站只會從 Edge Function 呼叫明確允許的模型，不把 CLIProxyAPI 管理介面放到瀏覽器。

## 服務端設定

建議以反向代理提供一個只允許 HTTPS 的根網址，並讓 Supabase Edge Function 可以從外部連到它。CLIProxyAPI 的 YAML 設定至少確認：

- \`api-keys\` 有一組專供本站 Edge Function 使用的長隨機金鑰；不要重用管理員金鑰。
- \`remote-management.allow-remote: false\`；若不需要管理 API，\`remote-management.secret-key\` 留空可直接停用 \`/v0/management\`。
- \`auth-dir\` 放在私有磁碟或私有 volume，不要放進 Git。
- \`debug: false\`，並確認反向代理與應用程式日誌不會記錄圖片內容、Authorization header 或完整請求 body。
- \`disable-image-generation\` 不可設為 \`true\`；本站的單項建議圖需要 \`/v1/images/edits\`。
- 只啟用你已核對授權、費用與資料處理條款的上游帳號 / 模型。

CLIProxyAPI 官方基本設定說明列出 \`host\`、\`tls\`、\`remote-management\`、\`api-keys\` 與 image endpoint 相關選項，部署時以該專案目前版本的設定範例為準：[CLIProxyAPI 基本設定](https://github.com/router-for-me/CLIProxyAPIDocs/blob/main/docs/en/configuration/basic.md)。

## 與本站對接

在 Supabase Edge Function secrets 設定：

- \`CLIPROXY_BASE_URL\`：例如 \`https://ai.example.com\`，不要加 \`/v1\`。
- \`CLIPROXY_API_KEY\`：上面專供本站使用的 API key。
- \`CLIPROXY_CHAT_MODELS\`：逗號分隔、已實際測試視覺輸入的模型。
- \`CLIPROXY_IMAGE_MODELS\`：逗號分隔、已實際測試 \`/v1/images/edits\` 的模型。
- \`AI_PROXY_ALLOWED_ORIGINS\`：只放本站 Pages 網址與必要的本機開發網址。

正式接通前，從 CLIProxyAPI 所在主機或同一私有網路做兩個不含學生圖面的健康檢查：

1. 用本站 API key 請求 \`/v1/models\`，確認回應只包含預期模型。
2. 用一張無敏感內容的小測試圖，分別測試 \`/v1/chat/completions\` 視覺輸入與 \`/v1/images/edits\`；確認回應格式是本站 Edge Function 允許的 \`choices\` / \`data\` 結構。

不要從公開瀏覽器直接測試管理端點，也不要把 CLIProxyAPI API key、OAuth auth-dir、Supabase secret key 或 service-role key 放入 GitHub Actions 的 \`NEXT_PUBLIC_*\` 變數。

## 上線後核對

- Pages 顯示「私有 AI 審圖」時，只有已登入且 \`app_metadata.membership_status = active\` 的帳號可以呼叫。
- Supabase \`review_sessions\` / \`review_findings\` 會保存結構化審圖與 SVG bbox；每帳號每天預設共用 30 次 AI 配額。
- PNG 型態的單項建議圖會寫入私有 \`suggestion-images\` bucket，資料表只保存索引；瀏覽器使用短時效 signed URL 預覽。
- 上游若只回傳遠端 URL，本站不會替它複製或公開保存；該次只顯示遠端預覽。
- 任何配額、模型、來源或權限異常，都先停用對應 Edge Function secret / model allowlist，再查 Supabase Edge Function 與 CLIProxyAPI 的不含內容日誌。
