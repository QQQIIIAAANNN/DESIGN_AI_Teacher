# Knowledge Workspace

這個資料夾定義 DESIGN_AI_Teacher 的知識整理格式。

目前不要直接把原始 PDF commit 進 public repo。

建議資料流：

```
raw sources
  ↓
inventory
  ↓
extraction
  ↓
knowledge units
  ↓
human review
  ↓
reviewed / canonical
  ↓
text + image indexes
```

## 建議目錄

實際資料可放在 private storage，不一定 commit：

```
knowledge/
  manifests/
    sources.jsonl
    knowledge_units.jsonl
    images.jsonl
  taxonomies/
    topics.json
    knowledge_types.json
  prompts/
    extraction.md
    curation.md
  examples/
    source.example.json
    knowledge-unit.example.json
    image-region.example.json
```

## 原始資料不要直接進 public GitHub

老師教材、上課 PDF、學生作答圖可能有著作權或個資。

repo 只保存：

- schema
- pipeline
- metadata example
- synthetic / authorized example

實際檔案應放 private object storage / private Drive / private database。
