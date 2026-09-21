# Supabase + CLIProxyAPI 部署準備

## 目前狀態

這個分支已加入 Supabase migration、登入後的私有題庫介面，以及 Supabase Edge Function 到 CLIProxyAPI 的 AI 代理程式。GitHub Pages 仍是公開的靜態前端；沒有 Supabase 專案設定時，題目區維持本機暫存、審圖維持 Mock，不會嘗試連線。

尚未提供 Supabase 專案，也尚未部署 Edge Function 或設定 CLIProxyAPI 主機，所以目前不是已連線的正式服務。不要把 service-role / secret key、CLIProxyAPI API key、CLIProxyAPI auth-dir、Codex / Antigravity 憑證放入 GitHub Pages、NEXT_PUBLIC 變數或程式碼。

## 資料流

GitHub Pages 前端 → Supabase Auth / Postgres / 私有 Storage  
已登入前端 → Supabase Edge Function（驗證帳號、限制模型、每日配額）→ 私有 HTTPS CLIProxyAPI → 允許清單中的模型

Supabase publishable key 會出現在瀏覽器程式中，這是預期行為；資料保護依賴 RLS、私有 Storage、已核准帳號與伺服器端秘密。前端不需要也不應該持有 Supabase secret key 或 CLIProxyAPI key。

## Supabase 專案設定

1. 建立一個 Supabase 專案，然後在專案根目錄套用 supabase/migrations/20260922000100_platform_backend.sql（例如使用 Supabase CLI 的 db push）。
2. 關閉公開自行註冊，從 Auth 管理介面新增 / 邀請指定使用者；若使用邀請流程，先完成該信箱的邀請確認，再回本站以 OTP 登入。
3. 將第一位管理帳號的伺服器管理 metadata 設為：
   - membership_status: active
   - roles: ["admin", "curator"]
   一般核准使用者可用 roles: ["learner"]。請設在 app_metadata，不要設在使用者可自行修改的 user_metadata。
4. 本站登入介面使用 email OTP。將 Supabase Email 模板改成顯示 {{ .Token }} 六位數驗證碼；不要只寄出 Magic Link。
5. Migration 會建立 exam-papers、source-documents、knowledge-assets、student-drawings、suggestion-images 五個私有 bucket，並設置資料列與檔案 RLS。題目上傳限定管理員 / 題庫整理者；已核准帳號可以讀取已發布題目。

## GitHub Pages 前端公開變數

在 GitHub 專案 Settings → Secrets and variables → Actions → Variables 建立以下 Variables：

- NEXT_PUBLIC_SUPABASE_URL：Supabase Project URL。
- NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY：Supabase publishable key；此值會進入瀏覽器，不能使用 secret/service-role key 代替。
- NEXT_PUBLIC_REVIEW_MODEL：CLIProxyAPI 上實際支援視覺輸入的模型名稱。
- NEXT_PUBLIC_IMAGE_MODEL：CLIProxyAPI 上支援 image edits 的模型名稱。

目前缺少這些值時，頁面會安全退回本機 Mock 模式。設定完成後，從 Actions 手動執行 Deploy GitHub Pages demo，或推送此分支的新 commit 重新建置。

## 部署 Edge Function 與 CLIProxyAPI

在 Supabase 專案部署 supabase/functions/ai-proxy/index.ts，並保持函式 JWT 驗證開啟（supabase/config.toml 已設 verify_jwt = true）。

透過 Supabase Dashboard 的 Edge Function Secrets 管理介面設定：

- CLIPROXY_BASE_URL：CLIProxyAPI 根網址，必須是 Supabase Edge Function 可連線的 HTTPS 網址，不含 /v1。
- CLIPROXY_API_KEY：CLIProxyAPI config 中設定的 client API key。
- CLIPROXY_CHAT_MODELS：允許正式審圖使用的模型名稱，以逗號分隔。
- CLIPROXY_IMAGE_MODELS：允許局部 image edits 使用的模型名稱，以逗號分隔。
- AI_PROXY_ALLOWED_ORIGINS：https://qqqiiiaaannn.github.io,http://localhost:3000

Supabase Edge Function 無法連到你電腦上的 localhost 或只在內網可見的服務。CLIProxyAPI 需要透過 TLS 保護、可由 Supabase 連線的受限入口提供 /v1/chat/completions 與 /v1/images/edits。只開放必要的 inference endpoint；不要把 CLIProxyAPI Management API 轉發到公網，並保持 management API 的 allow-remote 關閉。若網路政策不允許 Supabase Edge 出站連線，需選擇可在同一私有網路內執行的後端，而不是公開 CLIProxyAPI 管理介面。

Edge Function 僅接受已登入且 membership_status 為 active 的帳號、明確列入 allowlist 的模型，並限制每帳號每天最多 30 次 AI 呼叫（審圖與 image edit 共用）。更改配額需修改 migration 中 public.consume_ai_request() 的安全上限並重新套用資料庫變更。

## 圖面與建議圖的資料處理

Mock 模式不會傳送圖面。正式 AI 審圖只有在使用者勾選同意並按下審圖後，才會將完整圖面經 Supabase Edge Function 傳到 CLIProxyAPI 與其設定的上游模型。單項 AI 建議圖只傳送 SVG 問題框周邊裁圖與該項文字，不會覆寫原圖；目前生成結果留在瀏覽器供預覽 / 下載，不會自動保存到 suggestion-images bucket。使用前應確認上游模型的資料處理、費用、使用條款以及你是否有權上傳該圖面。

題目 PDF 在資料庫中先以 draft 狀態保留，核對檔案授權與題目資料後再發布；不要把未獲授權的講義、評圖或題目設成已發布。

## 資料表範圍

Migration 包含年度題目索引與私有 PDF 儲存、講師與案例來源、knowledge units、image regions 與知識 / 圖像關聯、個人 review sessions、SVG-located review findings、個別 suggestion image 索引，以及 AI 每日配額。knowledge unit 保留 building_type、topic_key、provenance、頁碼和七種 knowledge_type，避免把老師偏好或案例誤當成 hard_rule。
