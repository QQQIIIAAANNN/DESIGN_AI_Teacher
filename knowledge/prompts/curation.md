# Human Curation Checklist

AI 抽取後，reviewer 逐條確認。

## 1. 原意

- statement 是否忠於來源？
- 有沒有把老師的例子誤當一般原則？
- 有沒有擴大原文適用範圍？

## 2. 權威程度

確認 knowledge_type：

- hard_rule
- soft_rule
- heuristic
- anti_pattern
- repair_pattern
- precedent
- preference

若來源不是法規或題目條件，不可標 hard_rule。

## 3. 適用條件

- exam_type 正確嗎？
- topic 正確嗎？
- conditions 是否足以避免亂套？
- 是否需要 exceptions？

## 4. 嚴重度

severity_hint 是「可能的預設權重」，不是永遠固定。

同一原則在不同題型可能由 medium 變 high。

## 5. 圖文關係

若有圖例：

- bbox 是否框對？
- caption 是否描述真正重要的空間關係？
- good / bad / correction 分類正確嗎？
- linked_knowledge_ids 完整嗎？

## 6. 可操作性

好的知識單元應能導出：

- evidence to look for
- critique
- remediation

若只有抽象句子，例如「空間要有層次」，必須再補足判斷方式。

## 7. 狀態

- raw：未處理
- extracted：AI 抽取
- reviewed：人工確認
- canonical：可作為平台核心原則

canonical 的門檻最高，應優先收錄跨多份資料反覆出現、且具有穩定解釋力的原則。
