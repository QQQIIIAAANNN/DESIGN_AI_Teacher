# Multimodal RAG Knowledge Model v0.2

## 1. 目標

把老師 PDF、上課講義、批改紀錄、歷屆題目與參考圖面整理成可被 AI Teacher 檢索、引用與驗證的知識庫。

核心原則：

> 不以 PDF 為知識單位，而以「可獨立判斷的一條原則 + 對應圖例」為知識單位。

## 2. 四類主要資料

### A. rubrics

老師講義、評圖原則與通關策略。

適合文字 retrieval。

### B. cases

高分圖、低分圖、老師改圖、批改案例。

適合 text + image retrieval。

### C. codes

法規、無障礙、題目硬條件。

適合高精確文字 retrieval，需保留版本、日期與來源。

### D. visual_refs

圖面局部、配置 pattern、動線 pattern、戶外空間 pattern。

適合 image embedding + caption retrieval。

## 3. 最小知識單元 Knowledge Unit

每一條知識至少包含：

```json
{
  "knowledge_id": "K-000001",
  "source_id": "SRC-001",
  "source_type": "teacher_pdf",
  "source_title": "example.pdf",
  "page": 12,
  "exam_type": "design",
  "topics": ["main_entrance", "pedestrian", "first_impression"],
  "unit_role": "evaluation_rule",
  "evaluation_layer": "gatekeeper",
  "knowledge_type": "soft_rule",
  "statement": "主要入口應能由基地主要接近方向快速辨識。",
  "conditions": [
    "適用於具明確公共入口的題型"
  ],
  "exceptions": [],
  "evidence_targets": [
    "主要接近方向",
    "入口位置",
    "前廣場或步行導引"
  ],
  "severity_hint": "high",
  "reasoning": "入口不清會同時削弱配置、動線與第一印象。",
  "bad_pattern": "入口藏在量體轉角且缺少廣場或軸線導引。",
  "good_pattern": "入口與前廣場、鋪面或主要步行軸線形成連續關係。",
  "remediation": [
    "調整入口位置",
    "利用鋪面與景觀形成導引"
  ],
  "image_refs": ["IMG-0012"],
  "quote_or_paraphrase": "paraphrase",
  "curation_status": "reviewed"
}
```

## 4. unit_role 與 evaluation_layer

knowledge_type 表示「這筆知識的權威與性質」，unit_role 則表示「Agent 要拿它做什麼」。

unit_role：

- evaluation_rule：拿來判斷圖面。
- review_policy：規範 AI 自己如何審圖，例如 clarity gate、evidence、confidence。
- repair_strategy：描述修改策略。
- precedent：案例或可比較做法。

evaluation_rule 再分：

- gatekeeper：先檢查，可能直接影響通關。
- core_quality：基本盤成立後的核心設計品質。
- polish：表現、創意與細節加分。

其他 unit_role 的 evaluation_layer 使用 null。

## 5. knowledge_type

必須明確區分：

- hard_rule：法規或題目不可違反條件
- soft_rule：評圖原則
- heuristic：經驗法則
- precedent：案例做法
- preference：特定老師偏好
- anti_pattern：常見錯誤
- repair_pattern：常用改法

這是避免 AI 把「老師喜歡」講成「法律規定」的核心欄位。

## 6. 圖像資料模型

不要只保存完整頁面。

一張圖應拆成：

### source image
原始頁面或完整作答圖。

### region
有語意的局部 crop，例如：

- 主入口
- 車行入口
- 中庭
- 戶外廣場
- 梯廳
- 廁所
- 服務動線
- 景觀帶

### annotation
與 region 綁定的評論。

```json
{
  "image_id": "IMG-0012",
  "source_id": "SRC-001",
  "page": 12,
  "bbox": {
    "x": 0.15,
    "y": 0.32,
    "w": 0.27,
    "h": 0.21
  },
  "caption": "主要入口與前廣場形成清楚軸線",
  "topics": ["entrance", "outdoor_space"],
  "quality": "good_pattern",
  "linked_knowledge_ids": ["K-000001"]
}
```

## 7. PDF Ingestion Pipeline

### Step 1 — Inventory

先建立來源清單，不做 embedding。

保存：

- filename
- title
- author / teacher
- source type
- year
- exam type
- rights / usage note
- page count
- has_images
- processing status

### Step 2 — Dedup

避免：

- 同一份 PDF 不同檔名
- 掃描版與文字版重複
- 同一張參考圖被不同簡報重複收錄

### Step 3 — Page Classification

每頁分類：

- principle
- example_good
- example_bad
- correction
- law
- exam_prompt
- student_work
- mixed

### Step 4 — Principle Extraction

把長段講義拆成 atomic knowledge units。

不要固定每 500 tokens 切 chunk。

優先依：

- 標題
- 一條評圖原則
- 一個錯誤案例
- 一組 before / after
- 一個法規條文

切分。

### Step 5 — Image Extraction

抽出：

- 完整頁
- 圖面
- 老師紅線
- 圖面局部

建立 image_id 並與 knowledge_id 互相連結。

### Step 6 — Human Curation

AI 可以先抽取，但重要 knowledge unit 需要人工確認：

- 是否真的代表老師原意
- hard / soft rule 分類是否正確
- severity 是否合理
- 圖例是否匹配
- 是否存在例外

### Step 7 — Index

確認後才寫入 retrieval index。

## 8. Retrieval Architecture

建議不要只有一個 vector search。

使用：

### Metadata filter

先依：

- exam_type
- topic
- knowledge_type
- source
- year / version

縮小範圍。

### Text retrieval

Hybrid BM25 + dense embedding。

適合：

- 評圖原則
- 法規
- 老師評論

### Image retrieval

CLIP / multimodal embedding。

適合：

- 找相似平面配置
- 找類似戶外空間
- 找相似動線 pattern

### Graph expansion

取回 knowledge unit 後，同時展開：

- linked images
- related good cases
- related bad cases
- repair patterns
- source provenance

## 9. Agent Query Example

當 AI 發現「入口不清楚」：

1. query topics = main_entrance + pedestrian + first_impression
2. filter exam_type = design
3. retrieve gatekeeper evaluation_rule + soft_rule / anti_pattern
4. retrieve 2～3 個相似圖像案例
5. 根據當前 bbox 比較
6. 產生批改
7. source_refs 回傳原始來源

## 10. Chunking 原則

不要：

- 全 PDF 固定長度 chunk
- OCR 完直接 embedding
- 圖與文字分開後失去頁面關係

應該：

- semantic chunk
- knowledge unit
- image-text linkage
- source provenance
- page + bbox 可追溯

## 11. 建議索引

第一階段：

- PostgreSQL / JSON manifest：metadata 與關聯
- text vector store：knowledge unit embedding
- image vector store：image / crop embedding
- object storage：PDF、頁面圖、crop

可以先用單一 DB 實作，不必一開始分散式。

## 12. 資料品質等級

每條 knowledge unit 標記：

- raw：剛抽取
- extracted：AI 已結構化
- reviewed：人工確認
- canonical：平台核心原則

Agent 的基礎通關準則只允許使用 canonical / reviewed。

一般案例 RAG 可以使用 reviewed。

raw 資料不得直接變成高信心批改依據。

## 13. 來源可追溯

每一條最終審圖意見若有使用 RAG，必須保留：

- source_id
- page
- knowledge_id
- image_id（若有）
- retrieval score
- source type

未來 UI 可以顯示「此建議參考了哪些老師講義 / 案例」，提升可信度。


## 14. Canonical baseline 與外部 RAG 分層

平台自有的審圖底線存於 `knowledge/manifests/knowledge_units.jsonl`，來源為 `docs/agent-teacher-principles.md`。

這些 canonical review policies 與 gatekeepers 應先於外部教材 RAG 生效。老師講義、歷屆案例與法規可以補充、舉證與提供 precedent，但不能覆蓋以下底線：

- 證據不足時不亂猜。
- hard rule、soft rule、precedent、preference 必須分離。
- 先處理 gatekeeper，再處理核心品質與 polish。
- 高分案例不是唯一答案。
- 考試修改預設先找 Minimal Fix。

新增 manifest 後先執行 `npm run validate:knowledge`，確認 source、topic、layer 與 ID 關係完整，再建立 embedding/index。
