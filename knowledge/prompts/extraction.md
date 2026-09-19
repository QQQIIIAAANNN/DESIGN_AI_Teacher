# Knowledge Extraction Contract

你正在將建築師考試教學資料整理成 AI Teacher 可使用的知識單元。

## 目的

不是摘要整份文件，而是找出可以直接支援審圖判斷的 atomic knowledge units。

## 每條必須回答

- statement：這條原則是什麼？
- knowledge_type：hard_rule / soft_rule / heuristic / anti_pattern / repair_pattern / precedent / preference
- exam_type：design / site_planning / both
- topics：使用 taxonomy 中既有 topic
- conditions：什麼情況適用？
- exceptions：什麼情況不能直接套用？
- severity_hint：high / medium / low / none
- reasoning：為什麼會影響評圖？
- bad_pattern：若資料有提到，常見錯誤是什麼？
- good_pattern：若資料有提到，好的表現是什麼？
- remediation：若資料有提到，怎麼改？
- source_id
- page
- image_refs

## 禁止

- 不得把案例做法升格成 hard rule。
- 不得自行補上原文沒有的尺寸或法規。
- 不確定老師語意時標記 needs_review。
- 一頁有三條不同原則時，要拆成三筆。
- before / after 圖必須保留彼此 linkage。
- 圖像若是判斷依據，必須建立 image region，不可只留文字描述。

## 輸出品質

每條 knowledge unit 應該可以獨立回答：

> 「為什麼這張圖的這個區域可能有問題，以及可怎麼修？」

若不能，代表切得太碎或太空泛。
