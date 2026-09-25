# 題目資料庫規劃

## 題型分類

以穩定代碼做資料欄位，畫面再顯示中文名稱：

- `architectural_design`：建築設計
- `site_planning`：敷地計畫
- `civil_service_grade_3`：公務人員高考三級
- `other`：其他（新增題型時再擴充）

年度是獨立欄位，不依題型拆成多張年度資料表；因此可跨年度篩選，也能持續新增年份。

## 建議資料結構

- `exam_questions`：`id`、`year`、`category`、`title`、選填的`session_or_subject`、`status`、`created_at`、`updated_at`。
- `question_files`：`id`、`question_id`、`original_filename`、`storage_key`、`mime_type`、`size_bytes`、`sha256`、`uploaded_by`、`uploaded_at`。

PDF 檔案本體放在檔案儲存服務，資料庫只保存檔案索引與中繼資料；同一題目可以有多份附件。清單查詢以`(year, category, status)`建立索引。

## 正式上線時的上傳流程

1. 先建立題目中繼資料草稿，再透過短效上傳網址將 PDF 傳至私有暫存區。
2. 後端檢查實際檔案格式、大小與雜湊值；通過檢查後才建立檔案紀錄。
3. 題目預設為草稿，不因上傳而公開；完成內容與授權確認後才發布。
4. 清單依年度與題型查詢，支援後續增加科目、考試場次、講義或解答附件。

## 目前測試版的界線

GitHub Pages 本身仍是公開靜態網站；沒有 Supabase 設定時，題目只在目前瀏覽器暫存，重新整理後清空。設定 NEXT_PUBLIC_SUPABASE_URL 與 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY 後，題庫可使用邀請制登入、Postgres 索引與私有 Storage；實際上線前須套用 Supabase migration 並完成 RLS / Auth 設定。詳細步驟見 docs/backend-setup.md。題目檔發布前仍需確認可整理與分享的授權。
