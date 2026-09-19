# DESIGN_AI_Teacher — MVP v0.2 PRD

## 1. 產品目標

為建築師考試的「建築設計」與「敷地繪圖」建立可反覆使用的 AI 審圖平台。

核心不是一次性的文字講評，而是：

1. 看完整張作答圖。
2. 依固定 rubric 做結構化判讀。
3. 把問題定位到圖面座標。
4. 以 SVG 疊圖呈現問題與修改方向。
5. 當局部資訊不足時，停止硬猜並要求補圖。
6. 補圖後只針對該區進行局部精審。
7. 累積考生常犯錯誤與進步軌跡。

## 2. 核心使用者痛點

- 自己畫完後很難客觀審圖。
- 找真人建築師批圖成本高，而且難以高頻使用。
- 大圖縮放後，局部文字、牆線、樓梯與尺寸常不夠清楚。
- 一般多模態模型容易在看不清楚時仍然給出肯定答案。
- 純文字評論無法快速對應到圖面位置。
- 同一類錯誤會重複出現，但考生缺乏長期追蹤。

## 3. MVP v0.2 功能

### 3.1 完整圖上傳

支援 JPG / PNG。後續再加入 PDF、掃描校正與多頁題目。

### 3.2 整體審圖

評分面向先固定為：

- 配置與機能
- 動線與分流
- 戶外空間
- 法規與無障礙
- 設計概念與表達

### 3.3 SVG 問題定位

每個問題必須至少回傳：

- normalized bbox
- category
- severity
- confidence
- reason
- suggestion

SVG 座標使用 0～1 normalized coordinates，前端再映射到實際圖面。

### 3.4 SVG Redline

第一階段只允許結構化 primitives：

- line
- rect
- polyline

不要讓模型直接產生任意 SVG 或複雜 path。

### 3.5 Clarity Gate

每個候選問題都要判斷：

- clear
- partially_blurry
- illegible

若無法可靠判讀，不得直接產生確定性結論。

此時輸出 clarity_request：

- bbox
- confidence
- 看不清楚的原因
- 補圖說明
- 補圖後要檢查的 targets

### 3.6 局部補圖

使用者可在 clarity_request 卡片直接補上高解析局部圖。

補圖應保留：

- 原始 drawing_id
- 原始 issue_id
- 原始 bbox
- 全圖 context
- 局部影像

### 3.7 局部精審

補圖後只重跑該區，不重做整張圖。

狀態流程：

```
needs_crop
  ↓
crop_uploaded
  ↓
re_reviewing
  ↓
resolved | still_uncertain
```

局部精審結果要回寫原本 issue，而不是建立一個完全無關的新問題。

## 4. AI Pipeline

```
Upload
  ↓
Image normalization
  ↓
Global vision pass
  ├─ drawing structure
  ├─ site / building / landscape
  └─ candidate review regions
  ↓
Clarity gate
  ├─ clear → rubric review
  └─ unclear → clarity_request
  ↓
Rubric review
  ├─ planning
  ├─ circulation
  ├─ outdoor
  ├─ code / accessibility
  └─ concept / representation
  ↓
RAG retrieval
  ├─ teacher rubrics
  ├─ reference cases
  └─ codes
  ↓
Structured review JSON
  ↓
SVG renderer
```

若補圖：

```
Supplemental crop
  + original full drawing
  + original bbox
  + original issue context
  ↓
Local vision pass
  ↓
Targeted rubric review
  ↓
Patch original issue
```

## 5. RAG 資料分類

不要把所有資料混成同一個 collection。

### rubrics

老師講義、批圖原則、評分邏輯。

### cases

歷屆圖面、高分圖、低分圖、老師評論。

### codes

法規、無障礙、停車、避難等規範。

### visual_refs

圖面影像 embedding 與視覺案例。

每個 case 建議保存：

- exam_type
- year
- prompt
- image
- score
- teacher_comments
- issue_tags
- good_patterns
- bad_patterns
- source

## 6. 信心與安全閘門

AI 不應把 confidence 當裝飾。

建議第一版規則：

- confidence >= 0.75：可以直接提出問題。
- 0.45 <= confidence < 0.75：標為疑似問題，避免強烈語氣。
- confidence < 0.45：優先要求補圖。
- visibility_status = illegible：禁止輸出法規尺寸等精確判斷。

後續可用驗證集重新校準門檻。

## 7. MVP 驗證指標

第一批至少準備 30～50 張有真人老師批改紀錄的圖。

追蹤：

- Issue recall：老師指出的主要問題，AI 找到多少。
- Issue precision：AI 提出的問題，有多少被真人認為合理。
- Grounding accuracy：bbox 是否框對位置。
- Redline usefulness：修改線是否有實際參考價值。
- Clarification precision：AI 要求補圖的地方，是否真的需要補圖。
- False certainty rate：看不清楚卻硬判的比例。

其中 False certainty rate 應視為核心品質指標。

## 8. 商業化預留

第一階段建議採點數：

- 整張快速審圖
- 整張深度審圖
- 局部精審
- SVG 紅線改圖

資料模型預留：

- account
- practice_session
- drawing
- review
- review_issue
- supplemental_crop
- usage_credit
- payment_transaction
- knowledge_source

## 9. 暫不做

MVP v0.2 暫不投入：

- 金流
- 複雜會員權限
- 自動訓練 / fine-tune
- 任意 SVG generation
- 完全自動分數預測
- 多人協作

先證明「審得有用、圈得準、看不清會追問」。
