# Human Curation Checklist

AI 抽取後，reviewer 逐條確認。目標不是讓資料「看起來整齊」，而是讓 Agent 之後真的不會拿錯規則。

## 1. 原意

- statement 是否忠於來源？
- 有沒有把老師的例子誤當一般原則？
- 有沒有擴大原文適用範圍？
- source_section / page 能否回到原文？

## 2. 權威程度

確認 knowledge_type：

- hard_rule
- soft_rule
- heuristic
- anti_pattern
- repair_pattern
- precedent
- preference

若來源不是法規、題目條件或平台 review policy，不可標 hard_rule。

## 3. 角色與評圖層級

確認 unit_role：

- evaluation_rule
- review_policy
- repair_strategy
- precedent

若為 evaluation_rule，再確認 evaluation_layer：

- gatekeeper
- core_quality
- polish

review_policy / repair_strategy / precedent 應填 null。

## 4. 適用條件

- exam_type 正確嗎？
- topics 是否全部存在於 taxonomy？
- conditions 是否足以避免亂套？
- 是否需要 exceptions？
- evidence_targets 是否能被實際觀察或驗證？

## 5. 嚴重度

severity_hint 是可能的預設權重，不是永遠固定。

同一原則在不同題型可能由 medium 變 high。若 severity 高，但 evidence_targets 很模糊，應退回重寫。

## 6. 圖文關係

若有圖例：

- bbox 是否框對？
- caption 是否描述真正重要的空間關係？
- good_pattern / bad_pattern / correction 分類正確嗎？
- linked_knowledge_ids 完整嗎？
- 圖例是否真的支持 statement，而不是只「看起來很像」？

## 7. 可操作性

好的知識單元應能導出：

- evidence to look for
- critique
- remediation

若只有抽象句子，例如「空間要有層次」，必須補成可觀察的關係。

## 8. 來源與法規

- hard_rule 是否保留版本、日期與來源？
- 老師偏好是否被標為 preference？
- 單一案例是否被限制為 precedent？
- 相同原則若來自多個來源，先保留多筆 provenance，再考慮升為 canonical。

## 9. 狀態

- raw：未處理
- extracted：AI 已結構化，尚未人工確認
- reviewed：人工確認，可供一般 RAG
- canonical：平台核心原則，可影響高信心與高優先級判斷

canonical 的門檻最高。平台自有 review policy 可以直接 canonical；外部教學原則若要升 canonical，應有穩定來源、清楚證據與可泛化性。
