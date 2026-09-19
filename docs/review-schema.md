# Review JSON Schema v0.2

## 設計原則

1. 所有圖面座標都使用 0～1 normalized coordinates。
2. AI 回傳結構化資料，前端負責 SVG render。
3. issue 與 clarity_request 使用同一個 review item 基底。
4. 看不清楚時允許不評分，scoreImpact 使用 null。
5. 補圖不是新 session，而是原 issue 的延伸證據。

## Example

```json
{
  "reviewId": "review_20260919_001",
  "drawingId": "drawing_001",
  "overallScore": 68,
  "dimensions": [
    {
      "key": "planning",
      "label": "配置與機能",
      "score": 14,
      "maxScore": 20,
      "confidence": 0.88
    }
  ],
  "needsSupplement": true,
  "issues": [
    {
      "id": "issue-001",
      "kind": "issue",
      "title": "入口與主要廣場關係偏弱",
      "category": "circulation",
      "severity": "high",
      "scoreImpact": -4,
      "confidence": 0.91,
      "visibilityStatus": "clear",
      "description": "主要人行入口與前方開放空間缺少清楚導引。",
      "suggestion": "強化入口前緩衝廣場與步行軸線。",
      "bbox": {
        "x": 0.08,
        "y": 0.12,
        "w": 0.28,
        "h": 0.26
      },
      "redline": {
        "type": "line",
        "x1": 0.10,
        "y1": 0.42,
        "x2": 0.42,
        "y2": 0.24
      }
    },
    {
      "id": "clarity-001",
      "kind": "clarity_request",
      "title": "樓梯與鄰接空間需要局部補圖",
      "category": "drawing_readability",
      "severity": "info",
      "scoreImpact": null,
      "confidence": 0.34,
      "visibilityStatus": "illegible",
      "description": "目前無法可靠判讀樓梯線、門線與尺寸。",
      "suggestion": "補上高解析局部圖後再執行精審。",
      "bbox": {
        "x": 0.72,
        "y": 0.57,
        "w": 0.18,
        "h": 0.16
      },
      "cropRequest": {
        "reason": "局部解析度不足。",
        "instructions": [
          "保留框選區周邊上下文",
          "確保牆線、門線、樓梯方向與尺寸可辨識",
          "原圖失焦時請重新近拍"
        ],
        "reviewTargets": [
          "樓梯方向",
          "淨寬",
          "門扇關係",
          "無障礙連續性"
        ]
      }
    }
  ]
}
```

## Supplemental crop payload

```json
{
  "drawingId": "drawing_001",
  "reviewId": "review_20260919_001",
  "issueId": "clarity-001",
  "sourceBBox": {
    "x": 0.72,
    "y": 0.57,
    "w": 0.18,
    "h": 0.16
  },
  "imageAssetId": "asset_crop_001",
  "status": "crop_uploaded"
}
```

補圖後的 local review 必須引用：

- original full drawing
- supplemental crop
- source bbox
- original issue description
- cropRequest.reviewTargets

這樣模型才不會把局部圖當成失去上下文的新世界。
