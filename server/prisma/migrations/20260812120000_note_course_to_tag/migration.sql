-- 笔记：「课程」这个概念去掉，course 列改叫 tag，lessonAt 改叫 noteAt。
--
-- 纯改名，数据不动：用户已经填在 course 里的字符串原样变成标签值。
--
-- 两条索引先删后建 —— SQLite 的 RENAME COLUMN 会自动改写索引里的列名，但索引
-- 名还留着老列名，跟 Prisma 按 schema 推出来的名字对不上，下次 migrate 会当成
-- drift。索引名归索引名，直接重建最省事。

DROP INDEX "Note_userId_lessonAt_idx";
DROP INDEX "Note_userId_course_idx";

ALTER TABLE "Note" RENAME COLUMN "course" TO "tag";
ALTER TABLE "Note" RENAME COLUMN "lessonAt" TO "noteAt";

CREATE INDEX "Note_userId_noteAt_idx" ON "Note"("userId", "noteAt");
CREATE INDEX "Note_userId_tag_idx" ON "Note"("userId", "tag");
