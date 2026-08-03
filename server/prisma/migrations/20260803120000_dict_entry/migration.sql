-- 日中 / 中日词库表。
--
-- 公共参考数据，不挂用户，也不参与任何外键 —— 整张表可以随时清空重灌
-- （scripts/importDict.ts 就是 DELETE 后整批插入）。
--
-- 只建一条 (direction, word) 复合索引：查词的唯一形态就是「给定方向 +
-- 词头取全部义项」。sortKey 不建索引 —— 排序和定位由随前端发布的
-- client/public/dict/*.idx 在客户端完成，服务端从不按它扫表，多一条索引
-- 只会白白拖慢 16 万行的批量导入。

CREATE TABLE "DictEntry" (
    "id"        INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "word"      TEXT NOT NULL,
    "reading"   TEXT NOT NULL,
    "romaji"    TEXT NOT NULL DEFAULT '',
    "pos"       TEXT NOT NULL,
    "senses"    TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "source"    TEXT NOT NULL,
    "sortKey"   TEXT NOT NULL
);

CREATE INDEX "DictEntry_direction_word_idx" ON "DictEntry"("direction", "word");
