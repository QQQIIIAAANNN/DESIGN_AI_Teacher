import type {
  DrawingReview,
  ReviewItem,
  SupplementReviewResult
} from "@/lib/review-schema";

export function createMockReview(fileName: string): DrawingReview {
  return {
    reviewId: `review_mock_${Date.now()}`,
    drawingId: fileName,
    overallScore: 68,
    overallMaxScore: 100,
    scoringMode: "question_points",
    scoreNote: "展示資料：依題目明示的兩個給分項直接加總；意見卡僅提供分項判斷證據，不另行倒扣。",
    needsSupplement: true,
    dimensions: [
      { key: "question-planning", section: "建築計畫", label: "設計說明", criterion: "以設計說明交代題意、配置策略與公共空間構想。",
        score: 16, maxScore: 20, assessment: "good", rubricSource: "question_explicit", confidence: 0.86,
        evidenceConfidence: 0.84, rationale: "中庭構想清楚，但入口與前廣場的論證仍可加強。",
        evidence: "中央中庭與公共空間關係可辨識，入口軸線仍不連續。",
        sourceRefs: ["K-SYS-0003", "K-SYS-0007"], relatedIssueIds: ["issue-001", "strength-001"] },
      { key: "question-design", section: "建築設計", label: "平面、立面、剖面與透視", criterion: "以平立剖透完整說明空間、動線、量體與環境策略。",
        score: 52, maxScore: 80, assessment: "partial", rubricSource: "question_explicit", confidence: 0.82,
        evidenceConfidence: 0.8, rationale: "主要空間核心成立；入口、量體轉折與景觀連續性仍影響整體完成度。",
        evidence: "平面可見中庭核心，也可見入口分岔、轉角殘餘空間與零散植栽。",
        sourceRefs: ["K-SYS-0003", "K-SYS-0007"],
        relatedIssueIds: ["issue-001", "issue-002", "issue-003", "clarity-001", "strength-001"] }
    ],
    issues: [
      {
        id: "issue-001",
        kind: "issue",
        title: "入口與主要廣場關係偏弱",
        category: "動線 / 戶外空間",
        severity: "high",
        scoreImpact: null,
        rubricRefs: ["question-planning", "question-design"],
        confidence: 0.91,
        visibilityStatus: "clear",
        description:
          "主要人行入口與前方開放空間沒有形成清楚的導引關係，評圖時容易被判讀為空間主次不明。",
        suggestion:
          "強化入口前緩衝廣場，讓鋪面、植栽與入口軸線形成同一套構圖，並避免車行動線切過主要步行路徑。",
        evidence: "圖面左上的主要步行路徑在到達建築前分岔，鋪面也沒有連續對準入口。",
        criterion: "主入口應能由主要接近方向快速辨識，並與公共步行空間形成連續關係。",
        sourceRefs: ["K-SYS-0003"],
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
        scoreImpact: null,
        rubricRefs: ["question-design"],
        confidence: 0.84,
        visibilityStatus: "clear",
        description:
          "建築轉角出現難以使用的剩餘空間，若沒有明確景觀或機能設定，會削弱平面完整性。",
        suggestion:
          "可將牆線外推並整合成完整矩形空間，或明確設定為採光庭、植栽庭，使其成為設計語彙而不是殘餘空間。",
        evidence: "平面右中側量體轉折處留下狹長三角空地，圖上未見機能或停留設定。",
        criterion: "重要戶外空間應具備用途、尺度、邊界與動線關係，不應只是退縮後的剩餘。",
        sourceRefs: ["K-SYS-0007"],
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
        scoreImpact: null,
        rubricRefs: ["question-design"],
        confidence: 0.79,
        visibilityStatus: "clear",
        description:
          "植栽配置較零碎，沒有形成遮蔭、導引或基地邊界緩衝的連續系統。",
        suggestion:
          "將零散樹穴整理成一條連續綠帶，串接主要步行路徑與戶外停留空間。",
        evidence: "圖面下緣植栽以多個單點樹穴呈現，中間被不同鋪面切斷。",
        criterion: "景觀系統應回應遮蔭、導引、邊界或生態中至少一項明確任務。",
        sourceRefs: ["K-SYS-0002"],
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
        rubricRefs: ["question-design"],
        confidence: 0.34,
        visibilityStatus: "illegible",
        description:
          "此區線條與標註在整張圖縮放後不足以可靠判讀。系統可以辨識出疑似樓梯與走道交界，但不應直接猜測尺寸、梯向或門扇關係。",
        suggestion:
          "請補上此區的高解析局部圖，再針對樓梯動線、淨寬、出入口與無障礙關係進行局部精審。",
        evidence: "右下區域可見密集平行線，但梯向、門線與尺寸文字相互黏連。",
        criterion: "看不清的局部不得補猜；應保留問題位置並要求高解析補圖後局部重審。",
        sourceRefs: ["K-SYS-0008"],
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
      },
      {
        id: "strength-001",
        kind: "strength",
        title: "中庭與公共空間已形成清楚核心",
        category: "空間層次",
        severity: "low",
        scoreImpact: null,
        rubricRefs: ["question-planning", "question-design"],
        confidence: 0.86,
        visibilityStatus: "clear",
        description: "中庭同時連接入口、主要公共空間與回遊動線，已成為方案中容易被理解的空間核心。",
        suggestion: "後續調整入口與植栽時，保留中庭的連續邊界、公共空間視線與回遊關係。",
        evidence: "中央開放空間四周有連續的公共空間，並可由入口動線直接到達。",
        criterion: "有效的戶外核心應有清楚邊界，並與入口、主要公共空間及動線形成關係。",
        sourceRefs: ["K-SYS-0007"],
        bbox: { x: 0.37, y: 0.36, w: 0.2, h: 0.24 }
      }
    ],
    retrievedKnowledge: [
      { id: "K-SYS-0003", sourceTitle: "AI Teacher Principles — 通關導向審圖原則 v0.1",
        sourceType: "platform_policy", knowledgeType: "soft_rule",
        statement: "主要入口應能由主要接近方向快速辨識，並與公共步行空間形成連續關係。" },
      { id: "K-SYS-0007", sourceTitle: "AI Teacher Principles — 通關導向審圖原則 v0.1",
        sourceType: "platform_policy", knowledgeType: "soft_rule",
        statement: "重要戶外空間必須具有用途、尺度、邊界與動線關係。" },
      { id: "K-SYS-0008", sourceTitle: "AI Teacher Principles — 通關導向審圖原則 v0.1",
        sourceType: "platform_policy", knowledgeType: "hard_rule",
        statement: "任何高信心批改都必須能指出標準、圖面證據、推論關係與來源；看不清時不得補猜。" }
    ]
  };
}

export function createMockSupplementReview(
  originalIssue: ReviewItem
): SupplementReviewResult {
  return {
    status: "resolved",
    issue: {
      ...originalIssue,
      kind: "issue",
      title: "補圖後確認：樓梯與走道交界仍可再整理",
      category: "動線 / 樓梯",
      severity: "medium",
      scoreImpact: null,
      confidence: 0.89,
      visibilityStatus: "clear",
      description:
        "補上局部高解析圖後，可以確認樓梯方向與門線。主要問題不是法規尺寸，而是梯口、門扇與走道轉折集中在同一節點，閱讀與使用都偏擁擠。",
      suggestion:
        "優先把門扇開啟範圍移出梯口緩衝區，並讓走道方向更直接。若空間允許，可微調隔間牆線，減少梯口前的動線交叉。",
      cropRequest: undefined,
      redline: {
        type: "polyline",
        points: [
          [originalIssue.bbox.x + 0.02, originalIssue.bbox.y + originalIssue.bbox.h * 0.75],
          [originalIssue.bbox.x + originalIssue.bbox.w * 0.5, originalIssue.bbox.y + originalIssue.bbox.h * 0.45],
          [originalIssue.bbox.x + originalIssue.bbox.w * 0.85, originalIssue.bbox.y + originalIssue.bbox.h * 0.2]
        ]
      }
    }
  };
}
