# DESIGN_AI_Teacher

建築師考試「建築設計 / 敷地繪圖」AI 輔助練習平台。

## 產品核心

這個專案不是單純讓 AI 對圖面產生文字講評，而是把審圖結果轉成可操作的「圖面層」：

1. 上傳考生作答圖
2. AI 依結構化 rubric 審圖
3. 回傳問題座標與嚴重度
4. 用 SVG overlay 在原圖上框選錯誤區域
5. 以 SVG redline 顯示修改方向
6. 文字說明原因、扣分風險與改法
7. 後續累積個人歷次弱點與進步軌跡

## 目前 MVP

- Next.js + TypeScript
- JPG / PNG 圖面上傳
- SVG 問題框選
- SVG redline 示意
- 結構化評分面板
- 問題清單與修改建議
- Responsive UI

目前的審圖資料使用 mock response，目的是先驗證「AI 審圖 + SVG 定位 + 紅線修改」的核心互動。

## 下一階段架構

建議 AI pipeline：

```
Upload
  ↓
Image normalization
  ↓
Vision model
  ├─ site / drawing segmentation
  ├─ spatial reasoning
  └─ candidate issues
  ↓
Rubric engine
  ├─ 配置
  ├─ 動線
  ├─ 戶外空間
  ├─ 無障礙 / 法規
  ├─ 永續
  └─ 設計概念 / 圖面表達
  ↓
RAG
  ├─ 導師講義
  ├─ 歷屆高分圖
  ├─ 批改案例
  └─ 法規資料
  ↓
Structured review JSON
  ↓
SVG renderer
  ├─ bbox
  ├─ route
  ├─ wall
  ├─ landscape
  └─ annotations
```

### 建議 AI 回傳格式

```json
{
  "score": 68,
  "dimensions": {
    "planning": 14,
    "circulation": 12,
    "outdoor": 13,
    "code": 15,
    "concept": 14
  },
  "issues": [
    {
      "id": 1,
      "category": "circulation",
      "severity": "high",
      "score_impact": -4,
      "bbox": { "x": 0.08, "y": 0.12, "w": 0.28, "h": 0.26 },
      "summary": "入口與主要廣場關係偏弱",
      "reason": "...",
      "suggestion": "...",
      "redline": {
        "type": "polyline",
        "points": [[0.1, 0.42], [0.42, 0.24]]
      }
    }
  ]
}
```

座標建議全部使用 normalized 0~1，避免不同解析度導致 SVG 位移。

## RAG 資料建議

不要一開始把所有 PDF 與圖面混成同一個向量庫。

至少拆成：

- `rubrics`：老師講義與評圖原則
- `cases`：高分 / 低分案例及評論
- `codes`：法規與無障礙規範
- `visual_refs`：圖面案例與視覺 embedding

圖面案例最好同時保存：
- 原圖
- 題目類型
- 年份
- 分數
- 老師評論
- 關鍵問題
- 可接受解法

## 商業化預留

後續可加入：

- account
- practice_session
- review
- usage_credit
- payment_transaction
- knowledge_source

建議先用「每張圖計次」而不是月訂閱測市場，因為考生的使用頻率通常集中在考前。

## 開發

```bash
npm install
npm run dev
```

打開 http://localhost:3000
