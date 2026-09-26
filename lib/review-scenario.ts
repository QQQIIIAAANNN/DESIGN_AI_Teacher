export const reviewScenarios = [
  {
    id: "quick_study",
    label: "快速方案",
    minutes: 150,
    range: "2–3 小時",
    description: "一張核心平面加設計說明，可用簡要透視或剖面說明概念。",
    expectation: "先檢核題意、基地、機能、主要動線與空間關係；可缺完整細部圖，但已畫出的內容仍須自洽。"
  },
  {
    id: "site_4h",
    label: "敷地大圖",
    minutes: 240,
    range: "4 小時",
    description: "以配置、基地回應、開放空間與人車系統為主。",
    expectation: "嚴格檢核基地條件、法定或題目明示限制、戶外空間、人車動線及配置論證；不以室內細部取代敷地重點。"
  },
  {
    id: "civil_6h",
    label: "三級考試",
    minutes: 360,
    range: "6 小時",
    description: "完整回應題目機能，兼顧配置、平面、空間及環境策略。",
    expectation: "檢核題目需求、基地、平面機能、空間層次、動線、環境與圖面表達；對關鍵缺圖或論證不足明確扣分。"
  },
  {
    id: "design_8h",
    label: "完整設計大圖",
    minutes: 480,
    range: "8 小時",
    description: "以完整建築設計圖說呈現概念、平立剖與技術整合。",
    expectation: "採最完整的審查門檻；核對題意、基地、平立剖一致性、空間序列、構造、環境、法規依據與圖面可讀性。"
  }
] as const;

export type ReviewScenarioId = typeof reviewScenarios[number]["id"];

export function isReviewScenarioId(value: unknown): value is ReviewScenarioId {
  return reviewScenarios.some((scenario) => scenario.id === value);
}

export function getReviewScenario(id: ReviewScenarioId) {
  return reviewScenarios.find((scenario) => scenario.id === id) || reviewScenarios[0];
}

export function normalizeReviewMinutes(value: unknown, id: ReviewScenarioId) {
  if (value === null || value === undefined || value === "") return getReviewScenario(id).minutes;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? Math.max(60, Math.min(600, Math.round(numeric / 15) * 15)) : getReviewScenario(id).minutes;
}

export function reviewScenarioInstruction(id: ReviewScenarioId, minutes: number) {
  const scenario = getReviewScenario(id);
  return [
    `【本次練習情境：${scenario.label}，作圖 ${minutes} 分鐘】`,
    `預期成果：${scenario.description}`,
    `審查門檻：${scenario.expectation}`,
    "依題目明示圖說與本次時間判斷完成度；不可因為是短時間練習就忽略主入口、需求漏項或重大動線問題。",
    "只評論可見圖面與已提供題目；未繪出的內容可列『尚未證明』，不得推定一定不存在。",
    "各項分數仍須有具體圖面證據，不能因情境自動給高分或通過。"
  ].join("\n");
}
