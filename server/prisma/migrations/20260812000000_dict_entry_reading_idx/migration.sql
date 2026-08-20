-- 按读音取词头的第二条索引。
--
-- 查词框的关联词建议要回答「读音 ください 的词头都有谁」（→ ください / 下さい），
-- 建表时那条 (direction, word) 帮不上忙：读音不是它的前缀列。没有这条索引就是
-- 57 万行全表扫，而 D1 按读取行数计费，一次敲键就能把一天的额度吃掉一大块。
--
-- 词库是可随时重灌的公共数据（importDict.ts 走 DELETE + 整批插入，不动表结构），
-- 所以这条索引建一次就一直在，重灌不必重建。

CREATE INDEX "DictEntry_direction_reading_idx" ON "DictEntry"("direction", "reading");
