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
reviewed / canonical
  ↓
text + image indexes
```

## 目錄

```
knowledge/
  manifests/
    sources.jsonl
    knowledge_units.jsonl
    # images.jsonl 於第一批圖像 region 匯入後建立
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

`manifests/knowledge_units.jsonl` 先保存平台自己的通關導向審圖原則，來源為 `docs/agent-teacher-principles.md`。

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
