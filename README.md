# DESIGN_AI_Teacher

建築師考試「建築設計 / 敷地繪圖」AI 輔助練習平台。

## 產品核心

不是單純讓 AI 對圖面產生文字講評，而是把審圖結果轉成可操作的圖面層：

1. 上傳完整作答圖。
2. AI 依結構化 rubric 審圖。
3. 回傳問題座標、嚴重度與 confidence。
4. 用 SVG overlay 框選錯誤區域。
5. 以結構化 SVG redline 顯示修改方向。
6. 若局部圖面不足以可靠判讀，主動要求補上高解析局部圖。
7. 補圖後針對同一區域重新精審，而不是硬猜。
8. 後續累積個人歷次弱點與進步軌跡。

## 目前 MVP v0.2

- Next.js + TypeScript
- JPG / PNG 圖面上傳
- SVG 問題框選
- SVG redline 示意
- normalized coordinates
- 結構化評分面板
- 問題清單與修改建議
- Clarity Gate / 需補圖狀態
- 局部圖片補傳 UI
- Responsive UI
- GitHub Actions build CI

目前審圖內容使用 mock response，先驗證「AI 審圖 + SVG grounding + 補圖精審」的互動模型。

## AI Pipeline

```
Upload
  ↓
Image normalization
  ↓
Global vision pass
  ↓
Clarity gate
  ├─ clear → rubric review
  └─ unclear → clarity_request → supplemental crop → local re-review
  ↓
RAG
  ├─ teacher rubrics
  ├─ reference cases
  ├─ codes
  └─ visual references
  ↓
Structured review JSON
  ↓
SVG renderer
```

## 文件

- `docs/PRD-v0.2.md`：MVP 產品規格與驗證方法
- `docs/review-schema.md`：Review JSON 與補圖資料結構
- `lib/review-schema.ts`：前端共用 TypeScript types

## RAG 建議

資料至少拆成：

- `rubrics`：老師講義與評圖原則
- `cases`：高分 / 低分案例及評論
- `codes`：法規與無障礙規範
- `visual_refs`：圖面案例與視覺 embedding

不要一開始把所有 PDF、圖面、法規塞進同一個 collection。那不是知識庫，是 AI 廚餘桶。

## MVP 驗證

建議先準備 30～50 張已有真人老師批改結果的練習圖，評估：

- 問題召回率
- 問題精確率
- SVG 定位準確度
- 紅線修改有用程度
- 補圖要求是否合理
- 看不清楚卻硬判的比例

最後一項應作為關鍵品質指標。

## 商業化預留

後續可加入：

- account
- practice_session
- drawing
- review
- review_issue
- supplemental_crop
- usage_credit
- payment_transaction
- knowledge_source

第一階段比起月訂閱，更適合測試「整張審圖 / 局部精審 / 紅線改圖」點數制。

## 開發

```bash
npm install
npm run dev
```

打開 http://localhost:3000
