-- 词头精确匹配的索引首列换成 word，另外补上两根一直没有索引的外键列。
--
-- 1) DictEntry
--
-- 上一条迁移（dict_entry_reading_idx）修的是读音那条路径，词头这条主路径漏了。
-- 回车搜索走 lookupLocalDict，用户没选方向时 where 里只剩 word，而建表时那条
-- 是 (direction, word) —— 最左列对不上，SQLite 只能退化成全表扫。实测一次读
-- 573k 行 / 63ms，一天 44 次就是 2517 万行，占了整个库读取量的九成以上。
--
-- 换成 (word, direction) 两种形态都吃得上：只给 word 时走前缀，headwordRows 的
-- direction + word 双等值也照样走这一条，所以不必再多留一条单列索引。库里没有
-- 任何查询是只按 direction 过滤的，掉头不会打断别的路径。
--
-- 先建新的再删旧的：中间任何一刻都有索引可用，不会出现裸奔的窗口。
--
-- 2) Word.sourceNoteId / Expression.folderId
--
-- 两根外键列建表起就没有索引。笔记列表和表达分类的条数统计要按它们分组，删除
-- 时的外键检查也要扫它们 —— 删一条笔记实测读了 11111 行，跟这条笔记挂了几个词
-- 无关，纯粹是在扫全表。对照 WordFolder 那边一直有 folderId 索引，这两处是漏了。

CREATE INDEX "DictEntry_word_direction_idx" ON "DictEntry"("word", "direction");
DROP INDEX "DictEntry_direction_word_idx";

CREATE INDEX "Word_sourceNoteId_idx" ON "Word"("sourceNoteId");

CREATE INDEX "Expression_folderId_idx" ON "Expression"("folderId");
