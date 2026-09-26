# Knowledge Workspace

這個資料夾定義 DESIGN_AI_Teacher 的知識整理格式。

核心原則：**原始教材與可檢索知識要分層管理**。Public repo 保存 schema、taxonomy、經授權或平台自有的 canonical records；老師教材、學生圖面與可能涉及著作權或個資的原始檔案，放在 private storage。

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
  private/                  # 本機產生，不進 Git
    index.jsonl             # PDF 逐頁、文字分段、獨立圖片
    image-embeddings.jsonl  # 原圖 CLIP 向量
    topic-embeddings.json   # 審圖主題查詢向量
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

私有資料建索引及部署方式見 [知識索引說明](../docs/knowledge-indexing.md)。原始 PDF 與圖片仍留在指定的私有資料夾，不複製到 public repo。教材刪除、替換或新增後可執行 `npm run audit:knowledge`，以唯讀方式找出索引與來源的差異。

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

## 原始資料不要直接進 public GitHub

repo 可保存：

- schema
- pipeline
- taxonomy
- metadata manifest
- 平台自有 canonical principles
- synthetic / authorized examples

實際教材、PDF、學生作答圖應放 private object storage / private Drive / private database，manifest 只保留 provenance 與 storage reference。
