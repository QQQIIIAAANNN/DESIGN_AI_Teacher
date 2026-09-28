# Review JSON Schema v0.3

## 設計原則

1. 所有圖面座標都使用 0～1 normalized coordinates。
2. AI 回傳結構化資料，前端負責 SVG render。
3. `issue`、`strength` 與 `clarity_request` 使用同一個 review item 基底。
4. 評分結構優先來自題目明示的給分項，不預設固定五項或 100 分。
5. 題目有明確配分才填 `score` / `maxScore`；未標上限時兩者皆為 `null`，改填 `assessment`。
6. 意見卡不是扣分單；`scoreImpact` 保留相容欄位但一律為 `null`。
7. `rubricRefs` 與 `relatedIssueIds` 建立給分項和實際審圖意見的雙向關聯。
8. 補圖不是新 session，而是原 issue 的延伸證據。

## Example

```json
{
  "reviewId": "review_20260928_001",
  "drawingId": "drawing_001",
  "scoringMode": "question_points",
  "overallScore": 68,
  "overallMaxScore": 100,
  "dimensions": [
    {
      "key": "question-planning",
      "section": "建築計畫",
      "label": "設計說明",
      "criterion": "交代題意、配置策略與公共空間構想。",
      "score": 16,
      "maxScore": 20,
      "assessment": "good",
      "rubricSource": "question_explicit",
      "confidence": 0.86,
      "evidenceConfidence": 0.84,
      "rationale": "中庭構想清楚，入口論證仍可加強。",
      "evidence": "中庭與公共空間關係可辨識，入口軸線仍不連續。",
      "sourceRefs": ["K-SYS-0003"],
      "relatedIssueIds": ["finding-1", "finding-2"]
    }
  ],
  "needsSupplement": false,
  "issues": [
    {
      "id": "finding-1",
      "kind": "issue",
      "title": "入口與主要廣場關係偏弱",
      "category": "動線 / 戶外空間",
      "severity": "high",
      "scoreImpact": null,
      "rubricRefs": ["question-planning"],
      "confidence": 0.91,
      "visibilityStatus": "clear",
      "evidence": "主要步行路徑在到達建築前分岔。",
      "criterion": "主入口應能由主要接近方向快速辨識。",
      "description": "入口與公共空間的主次關係不明。",
      "suggestion": "以鋪面、植栽與入口軸線建立連續導引。",
      "bbox": { "x": 0.08, "y": 0.12, "w": 0.28, "h": 0.26 }
    }
  ]
}
```

沒有明確配分時：

```json
{
  "scoringMode": "question_criteria",
  "overallScore": null,
  "overallMaxScore": null,
  "dimensions": [
    {
      "key": "question-drawings",
      "section": "題目要求",
      "label": "平面、立面、剖面與透視",
      "score": null,
      "maxScore": null,
      "assessment": "partial",
      "relatedIssueIds": ["finding-1"]
    }
  ]
}
```

`assessment` 可為 `excellent`、`good`、`partial`、`insufficient`、`unverified`。

## Supplemental crop payload

補圖沿用原 `reviewId`、`issueId`、`sourceBBox` 與原始意見；模型必須同時看到完整原圖、局部圖與原問題 context，避免把局部圖當成新的獨立世界。
