# 私有教材索引與部署

原始 PDF、圖片與課程資料留在雲端硬碟，不複製進 Git。私人專案只追蹤執行檢索需要的文字索引、OCR 補充、向量、回饋記憶及繁體中文 OCR 模型；索引含有教材摘錄，因此 GitHub 專案必須維持 Private。

## 專案內保留的資料

- `knowledge/private/index.jsonl`：PDF 頁面、文字段落與圖片來源索引。
- `knowledge/private/ocr-augmentation*.jsonl`：掃描頁與圖片的 OCR 補充，內容仍待人工核對。
- `knowledge/private/image-embeddings.jsonl`、`topic-embeddings.json`：圖像與審圖主題向量。
- `knowledge/private/core-memory/review-feedback.md`：使用者回饋形成的修正訊號。
- `knowledge/private/source-root.txt`：原始雲端同步資料夾相對於專案根目錄的位置。
- `knowledge/private/tessdata/`：需要重新執行 OCR 時使用的語言模型。

原始教材不進 Git。PDF 頁面渲染快取寫到 `.cache/knowledge/rendered/`；舊快照、重複索引與可重建快取不保留在專案資料中，`.cache/` 也已加入 Git 忽略清單。

## 路徑設定

所有索引、向量、回饋記憶與快取預設都以專案根目錄為基準。`source-root.txt` 預設為 `../K圖會`，也就是雲端硬碟同步資料夾與專案放在同一層的情況。若另一台電腦的同步資料夾位置不同，修改本機 `.env.local` 的 `KNOWLEDGE_SOURCE_DIR`，填入相對於專案根目錄的路徑；不必把該路徑寫成特定電腦的絕對位置。

`.env.local.example` 已列出預設值。`.env.local` 不進 Git；雲端部署時應把來源資料掛載在服務可讀取的位置，並設定相對路徑。不要把原始資料放進靜態網站輸出或公開目錄。

## 建索引與稽核

在專案根目錄執行。需要 Poppler 的 `pdftotext`、`pdfinfo`；若要建獨立圖片 OCR，另需安裝 Tesseract。

```powershell
python scripts/build-private-knowledge.py --ocr-images
npm run audit:knowledge
```

預設來源為 `../K圖會`。如需只補入一份新教材，可指定相對於來源資料夾的檔案路徑：

```powershell
python scripts/build-private-knowledge.py --only-source "課程/補充知識/新教材.pdf"
```

建索引與稽核共用同一套排除規則：略過隱藏工作資料夾、`output/`、`知識索引/`、純考題 PDF 及指定的純考題頁／圖片，避免把臨時附件或評分用題目當成教學知識。

`npm run audit:knowledge` 只讀取並比對來源，不會修改索引。若要清除已刪除、改變、被排除來源的舊記錄，以及孤立的 OCR／向量，明確執行：

```powershell
python scripts/audit-private-knowledge.py --prune-stale
npm run audit:knowledge
```

清理只會改寫專案內的索引與衍生記錄，不會刪除或修改雲端硬碟的原始檔。同步雲端資料夾後，先稽核；若來源檔大小或修改時間改變，需重建相關索引，並視需要重新產生 OCR 或向量。

繁體中文 OCR 使用 `knowledge/private/tessdata/chi_tra.traineddata`；平行處理掃描 PDF 頁面可執行：

```powershell
python scripts/augment-private-ocr.py --pdf-only --shards 4 --shard 0
python scripts/augment-private-ocr.py --pdf-only --shards 4 --shard 1
python scripts/augment-private-ocr.py --pdf-only --shards 4 --shard 2
python scripts/augment-private-ocr.py --pdf-only --shards 4 --shard 3
```

向量已隨私人索引保存。只有新增圖片或需要更新向量時才執行 `scripts/embed-private-images.py`；它需要安裝 PyTorch、Transformers、Pillow，並已快取 CLIP 模型。

## 執行時檢索

審圖會把平台 canonical 準則、私有教材索引與人工回饋記憶一併檢索。教材內容屬於未審定摘錄，回饋記憶屬於 `human_correction_signal`；兩者都不能取代題目條件、圖面證據或正式法規。PDF 頁面只有在需要作為視覺參考時才由 Poppler 渲染至 `.cache/knowledge/rendered/`。
