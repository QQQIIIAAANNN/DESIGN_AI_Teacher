import type { DrawingReview } from "@/lib/review-schema";

export function createMockReview(fileName: string): DrawingReview {
  return {
    reviewId: `review_mock_${Date.now()}`,
    drawingId: fileName,
    overallScore: 68,
    needsSupplement: true,
    dimensions: [
      { key: "planning", label: "配置與機能", score: 14, maxScore: 20, confidence: 0.88 },
      { key: "circulation", label: "動線與分流", score: 12, maxScore: 20, confidence: 0.86 },
      { key: "outdoor", label: "戶外空間", score: 13, maxScore: 20, confidence: 0.82 },
      { key: "code", label: "法規與無障礙", score: 15, maxScore: 20, confidence: 0.78 },
      { key: "concept", label: "設計概念與表達", score: 14, maxScore: 20, confidence: 0.84 }
    ],
    issues: [
      {
        id: "issue-001",
        kind: "issue",
        title: "入口與主要廣場關係偏弱",
        category: "動線 / 戶外空間",
        severity: "high",
        scoreImpact: -4,
        confidence: 0.91,
        visibilityStatus: "clear",
        description:
          "主要人行入口與前方開放空間沒有形成清楚的導引關係，評圖時容易被判讀為空間主次不明。",
        suggestion:
          "強化入口前緩衝廣場，讓鋪面、植栽與入口軸線形成同一套構圖，並避免車行動線切過主要步行路徑。",
        bbox: { x: 0.08, y: 0.12, w: 0.28, h: 0.26 },
        redline: {
          type: "line",
          x1: 0.1,
          y1: 0.42,
          x2: 0.42,
          y2: 0.24
        }
      },
      {
        id: "issue-002",
        kind: "issue",
        title: "量體轉折造成轉角空間浪費",
        category: "空間配置",
        severity: "medium",
        scoreImpact: -2,
        confidence: 0.84,
        visibilityStatus: "clear",
        description:
          "建築轉角出現難以使用的剩餘空間，若沒有明確景觀或機能設定，會削弱平面完整性。",
        suggestion:
          "可將牆線外推並整合成完整矩形空間，或明確設定為採光庭、植栽庭，使其成為設計語彙而不是殘餘空間。",
        bbox: { x: 0.57, y: 0.31, w: 0.24, h: 0.22 },
        redline: {
          type: "rect",
          x: 0.55,
          y: 0.28,
          w: 0.29,
          h: 0.28
        }
      },
      {
        id: "issue-003",
        kind: "issue",
        title: "景觀綠帶缺乏連續性",
        category: "景觀 / 永續",
        severity: "low",
        scoreImpact: -1,
        confidence: 0.79,
        visibilityStatus: "clear",
        description:
          "植栽配置較零碎，沒有形成遮蔭、導引或基地邊界緩衝的連續系統。",
        suggestion:
          "將零散樹穴整理成一條連續綠帶，串接主要步行路徑與戶外停留空間。",
        bbox: { x: 0.16, y: 0.66, w: 0.4, h: 0.2 },
        redline: {
          type: "polyline",
          points: [
            [0.14, 0.8],
            [0.28, 0.69],
            [0.45, 0.82],
            [0.62, 0.7]
          ]
        }
      },
      {
        id: "clarity-001",
        kind: "clarity_request",
        title: "樓梯與鄰接空間需要局部補圖",
        category: "圖面清晰度",
        severity: "info",
        scoreImpact: null,
        confidence: 0.34,
        visibilityStatus: "illegible",
        description:
          "此區線條與標註在整張圖縮放後不足以可靠判讀。系統可以辨識出疑似樓梯與走道交界，但不應直接猜測尺寸、梯向或門扇關係。",
        suggestion:
          "請補上此區的高解析局部圖，再針對樓梯動線、淨寬、出入口與無障礙關係進行局部精審。",
        bbox: { x: 0.72, y: 0.57, w: 0.18, h: 0.16 },
        cropRequest: {
          reason: "局部解析度不足，牆線、樓梯線與尺寸文字互相黏連。",
          instructions: [
            "保留框選區域四周約 10%～20% 的上下文，不要只裁一個小方塊。",
            "讓牆線、門線、樓梯方向與尺寸文字可辨識。",
            "若原圖本身失焦，請重新近拍該區，而不是單純數位放大。"
          ],
          reviewTargets: ["樓梯方向", "走道與門扇關係", "淨寬", "無障礙連續性"]
        }
      }
    ]
  };
}
