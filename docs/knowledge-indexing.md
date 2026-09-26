# 私有教材文字與圖面索引

平台自有的 canonical 準則在 `knowledge/manifests/`；老師教材與圖面需保留來源及人工審定狀態。私有索引放在 `knowledge/private/`，此資料夾已排除 Git。

## 本機建索引

在專案根目錄執行：

```powershell
python scripts/build-private-knowledge.py "C:\Users\User\Downloads\K圖會" --ocr-images
npm run audit:knowledge
```

此程式只讀取當下存在的 PDF 與圖片。PDF 以 Poppler 逐頁擷取文字，約 1,000 字分段並保留 120 字重疊；每頁同時建立圖頁記錄。獨立圖片建立影像記錄，若 Tesseract 可用則擷取可見文字並標示 `ocr_text_needs_review`。PDF 掃描頁若無嵌入文字，會保留 `needs_visual_reading` 狀態，不會假裝已讀到中文字。

這台電腦原先的 Tesseract 只有 `eng` 與 `osd`。目前已將 [Tesseract 官方 `tessdata_fast` 繁體中文模型](https://github.com/tesseract-ocr/tessdata_fast/blob/main/chi_tra.traineddata) 放在私有 `knowledge/private/tessdata/`，可執行第二輪繁體中文 OCR：

```powershell
& "D:\MA system\LangGraph\langgraph-env\Scripts\python.exe" scripts/augment-private-ocr.py
```

一般執行會處理獨立圖片與原本沒有嵌入文字的 PDF 頁面。本機已先針對 239 個無內嵌文字 PDF 頁面完成四份平行 OCR：

```powershell
0..3 | ForEach-Object { & "D:\MA system\LangGraph\langgraph-env\Scripts\python.exe" scripts/augment-private-ocr.py --pdf-only --shards 4 --shard $_ }
```

上例為依序執行；需要縮短等待時間時可在四個終端各執行一個 shard。程式只把中文比例及字數達基本門檻的片段加入 `ocr-augmentation*.jsonl`，並標記為尚待人工核對。目前 239 頁中有 73 頁產生 98 個補充文字片段；另有 38 張獨立圖片在先前的部分掃描中產生 42 個片段。其餘圖頁仍有原圖記錄，無法辨識的文字不會被捏造成已讀取。手繪細字與歪斜掃描仍可能讀不準，檢索結果不能因此升格成正式規則。

電腦上有快取的 CLIP 模型，以下需使用包含 PyTorch、Transformers、Pillow 的 Python 環境產生圖片向量。這台電腦可用的環境是 `D:\MA system\LangGraph\langgraph-env\Scripts\python.exe`；其他電腦可改成自己的 Python 執行檔：

```powershell
& "D:\MA system\LangGraph\langgraph-env\Scripts\python.exe" scripts/embed-private-images.py
& "D:\MA system\LangGraph\langgraph-env\Scripts\python.exe" scripts/embed-private-images.py --pdf-textless-only
```

第二個命令只針對沒有內嵌文字的 PDF 圖頁產生向量。本機目前已建立 558 張獨立圖片與 239 個無文字 PDF 圖頁的向量。其他 PDF 頁已用頁面嵌入文字建立搜尋索引，選中後可把原圖頁交給模型核對；若需每頁都有視覺向量，可用 `--include-pdf`，但需要更多 CPU 時間與私有磁碟空間。腳本可重跑，會跳過已索引的圖片。向量資料和逐頁渲染圖片都留在 `knowledge/private/`。

## 執行時檢索

本機審圖以中文雙字詞倒排索引找相關文字與 PDF 圖頁，再以 CLIP 圖像／主題向量找獨立圖面。每輪混合平台 canonical 要點、私有文字摘錄與參考圖頁。參考圖頁會和來源編號一同送給已連線的 CLI 模型，但會明確標示不是本次作答原圖。法規判斷仍需可核對的正式來源、版本與圖面尺寸。

若私有索引與原始素材不在預設位置，可設：

```powershell
$env:PRIVATE_KNOWLEDGE_INDEX="D:\private-knowledge\index.jsonl"
$env:KNOWLEDGE_SOURCE_DIR="D:\K圖會"
```

正式部署時，這兩個路徑需位於只有伺服器可讀取的私有磁碟；不可公開 `knowledge/private/`、原始 PDF 或圖片。Supabase 的結構表目前不能取代這個本機向量索引；若遷移到雲端，需先完成私有物件儲存、權限與向量匯入。部署時也要套用 `supabase/migrations/20260926000100_review_strengths.sql`，讓值得保留的審圖項目能保存。

## 來源異動

`npm run audit:knowledge` 會唯讀比對目前資料夾與索引，列出已刪除、新增或內容已改變的來源，以及無對應原圖的 OCR／向量紀錄。本機目前保留 71 份 PDF 與 558 張獨立圖片，稽核結果沒有失聯或過時來源。執行時也會核對來源檔的大小與修改時間；被刪除或替換的檔案會從審圖檢索中排除。

若日後刪除或大幅更換原始教材，請輸出到一個**新的**私有資料夾，例如 `knowledge/private/snapshot-20261001/index.jsonl`，在該資料夾重新產生 OCR 與向量，並設定 `PRIVATE_KNOWLEDGE_INDEX` 指向新索引。腳本不會刪除舊索引或教材；新索引的位置必須與其 OCR、向量及 `source-root.txt` 相同。
