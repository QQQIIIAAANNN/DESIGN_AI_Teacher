# Knowledge Extraction Contract

你正在將建築師考試教學資料整理成 AI Teacher 可使用的知識單元。

## 目的

不是摘要整份文件，也不是固定 token chunk，而是找出可以直接支援審圖判斷的 atomic knowledge units。

## 每條必須回答

- statement：這條原則是什麼？
- unit_role：evaluation_rule / review_policy / repair_strategy / precedent
- evaluation_layer：gatekeeper / core_quality / polish / null
- knowledge_type：hard_rule / soft_rule / heuristic / anti_pattern / repair_pattern / precedent / preference
- exam_type：design / site_planning / both
- topics：只能使用 taxonomy 中既有 leaf topic
- conditions：什麼情況適用？
- exceptions：什麼情況不能直接套用？
- evidence_targets：模型要在圖面或題目中找什麼證據？
- severity_hint：high / medium / low / none
- reasoning：為什麼會影響評圖？
- bad_pattern：若資料有提到，常見錯誤是什麼？
- good_pattern：若資料有提到，好的表現是什麼？
- remediation：若資料有提到，怎麼改？
- source_id
- source_title
- source_section / page
- image_refs
- quote_or_paraphrase
- curation_status

## 分類原則

### unit_role

- evaluation_rule：拿來判斷圖面是否成立。
- review_policy：規範 AI 自己如何審圖，例如 evidence、confidence、clarity gate。
- repair_strategy：描述如何修改。
- precedent：案例或可比較的做法。

### evaluation_layer

只有 evaluation_rule 使用：

- gatekeeper：會優先影響通關的重大問題。
- core_quality：基本盤成立後的核心設計品質。
- polish：加分、表現與細節。

review_policy / repair_strategy / precedent 可填 null。

## 禁止

- 不得把案例做法升格成 hard_rule。
- 不得自行補上原文沒有的尺寸或法規。
- 不確定老師語意時，curation_status 只能先到 extracted。
- 一頁有三條不同原則時，要拆成三筆。
- before / after 圖必須保留彼此 linkage。
- 圖像若是判斷依據，必須建立 image region，不可只留文字描述。
- topic 不可自行發明，若 taxonomy 缺詞先提案新增。
- 不得把 preference 寫成平台 canonical gatekeeper。

## 輸出品質

每條 evaluation_rule 應該可以獨立回答：

> 「我要在圖上看什麼證據？為什麼這可能影響評圖？若有問題，怎麼修？」

若不能，代表切得太碎或太空泛。
