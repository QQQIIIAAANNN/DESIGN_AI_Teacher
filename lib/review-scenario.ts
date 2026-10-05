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
    expectation: "檢核題目需求、基地、平面機能、空間層次、動線、環境與圖面表達；關鍵缺圖或論證不足須反映於對應題目給分項的達成程度與理由。"
  },
  {
    id: "design_8h",
    label: "完整設計大圖",
    minutes: 480,
    range: "8 小時",
    description: "以完整建築設計圖說呈現概念、配置、平剖、量體／立面造型與技術整合。",
    expectation: "採最完整的審查門檻；先看量體配置、基地與主要動線是否成立，再核對題意、平剖空間、環境、構造、法規依據與圖面可讀性。立面造型可由立面、剖面或透視等互補圖說交代。"
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
    "各題目給分項的評估仍須有具體圖面證據；題目未明載配分時只能標示達成狀態，不能因情境自動給高分或通過。",
    "比例標示先視為作圖與閱讀參考；除非題目明示為硬性條件，或因比例選擇導致基地／街廓與必要內容無法充分表達，不把比例偏差本身列為主要缺失。",
    "若剖面、全區透視或其他圖已能清楚交代量體與立面造型，不因缺少獨立立面圖直接重罰；但題目明示必繳且能確認整份成果確實缺漏時，仍可列完成度問題。"
  ].join("\n");
}
