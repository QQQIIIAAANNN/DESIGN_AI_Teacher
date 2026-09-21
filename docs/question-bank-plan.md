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

GitHub Pages 是靜態網站。此原型只用瀏覽器的本機暫存與 PDF 預覽，不呼叫伺服器、不儲存題目；重新整理後清空。正式上傳及跨裝置資料庫需要另接後端與檔案儲存。題目檔發布前應確認可公開使用的授權。
