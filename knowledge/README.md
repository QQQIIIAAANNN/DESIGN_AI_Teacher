# Knowledge Workspace

這個資料夾定義 DESIGN_AI_Teacher 的知識整理格式。

核心原則：**原始教材與可檢索知識分層管理**。原始教材與學生圖面留在雲端硬碟；私人 Git 專案只保存執行檢索所需的衍生索引、向量與回饋記憶，不保存原始 PDF 或圖片。

## 目前資料流

```
raw sources
  ↓
inventory
  ↓
dedup / page classification
  ↓
atomic extraction
  ↓
knowledge units + image regions
  ↓
human review
  ↓
reviewed / canonical（平台規則）或 extracted（私有教材）
  ↓
文字倒排索引 + PDF 圖頁索引 + CLIP 視覺向量
```

## 目錄

```
knowledge/
  manifests/
    sources.jsonl
    knowledge_units.jsonl
    review_coverage_units.jsonl
  private/                  # 私人 Git 專案只追蹤必要檢索資產
    index.jsonl             # PDF 逐頁、文字分段、獨立圖片
    ocr-augmentation*.jsonl # 掃描圖頁 OCR 補充
    image-embeddings.jsonl  # CLIP 圖像向量
    topic-embeddings.json   # 審圖主題查詢向量
    source-root.txt         # 以專案根目錄為基準的雲端同步資料夾路徑
    core-memory/            # 使用者回饋記憶
    tessdata/               # 僅供重新建索引時 OCR 使用
  .cache/knowledge/         # 執行時產生的 PDF 圖頁快取，不進 Git
  schemas/
    source.schema.json
    knowledge-unit.schema.json
    image-region.schema.json
  taxonomies/
    topics.json
    knowledge-types.json
  prompts/
    extraction.md
    curation.md
  examples/
    source.example.json
    knowledge-unit.example.json
    image-region.example.json
```

## Canonical baseline

`manifests/knowledge_units.jsonl` 保存平台自己的通關導向審圖原則與空間關係準則，來源為 `docs/agent-teacher-principles.md` 及 `docs/spatial-review-criteria.md`。

正式審圖先從選定的官方題目 PDF 或使用者上傳的 PDF 擷取需求、基地條件與附圖，再辨識圖面事實。系統會根據題目與圖面觀察，從 canonical units 檢索相關要點。模型只能引用本次檢索的 knowledge_id；缺少圖面證據或知識依據時，該項改列待確認。局部補圖與局部修改圖也會重新檢索相關要點。

平台規則為 canonical；K圖會教材的本機索引為 extracted，會以可追溯來源摘錄與參考圖頁呈現，不能自動升格成官方法規或教師已審定評分準則。審圖分題意、空間、動線、環境構造四輪，各輪先檢索平台規則與私有教材，再產生有證據的缺失、優點或待補圖項目。獨立圖片可用 CLIP 向量尋找相近主題，PDF 圖頁與原始圖片會在本機 CLI 審圖時作為視覺參考送給模型。題庫保存題名與官方 PDF 索引；題目缺漏時可在審圖畫面上傳題目 PDF。

## 意見回饋核心記憶

使用者可在每張意見卡回饋「判斷正確」、「部分正確」、「誤判」或「位置錯誤」。完整版會追加寫入 `knowledge/private/core-memory/review-feedback.md`；若有設定 `REVIEW_MEMORY_FILE`，則改寫入該路徑（相對路徑以專案根目錄為基準）。每筆紀錄保留原意見的圖面證據、標準、推論、建議、原始與修正後 bbox，以及使用者補充。

這些記憶會和 canonical 平台準則、私有教材一起被檢索，但權威層級固定為 `human_correction_signal`：只用來避免在類似圖面情境重複誤判，不可當作法規、題目條件或系統指令。回饋記憶會同步到私人 Git 專案，請勿將該專案設為公開。

私有資料建索引及部署方式見 [知識索引說明](../docs/knowledge-indexing.md)。原始 PDF 與圖片留在雲端同步資料夾；`source-root.txt` 儲存相對於專案根目錄的路徑。教材刪除、替換或新增後執行 `npm run audit:knowledge`；必要時加上 `--prune-stale` 清除舊索引記錄，不會刪除雲端來源檔。

這批資料是 Agent 的穩定底線，與外部老師講義、歷屆案例、法規資料分開。外部 RAG 可以補充與舉證，但不能覆蓋：

- 證據不足時不亂猜。
- 法規、評圖原則、案例與偏好必須分離。
- 先處理 gatekeeper，再處理核心品質與表現。
- 優先提出 Minimal Fix。
- 高分案例不是唯一答案。

## 驗證

新增或修改 manifest 後執行：

```bash
npm run validate:knowledge
```

目前驗證會檢查：

- JSONL 是否可解析。
- knowledge_id 是否重複。
- source_id 是否存在。
- exam_type / evaluation_layer / knowledge_type 是否合法。
- topic 是否存在於 taxonomy。
- evidence_targets 是否完整。
- curation_status 是否合法。

之後可再加入 JSON Schema validator 與 image linkage 驗證。

## 原始資料不要進 Git

一般 repo 可保存：

- schema
- pipeline
- taxonomy
- metadata manifest
- 平台自有 canonical principles
- synthetic / authorized examples

實際教材、PDF、學生作答圖應放 private Drive 或私有物件儲存。私人 Git 專案可追蹤上述必要衍生索引，但索引含有教材摘錄，也必須維持私人；圖頁快取與舊建置快照可以從原始來源重建，不進 Git。
