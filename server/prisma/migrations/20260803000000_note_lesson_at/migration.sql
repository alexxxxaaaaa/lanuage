-- 笔记：课次（自由文本）改成课程时间（日期）。
--
-- 三件事，顺序不能换：
--   1. 老的课次文本（"L23" 之类）在删列之前先并进标题，否则信息就没了。
--   2. 课程时间和更新时间对老行一律回填成创建时间 —— 课程时间的业务默认值
--      就是创建时间，列表排序直接吃这一列，不能留 NULL。
--   3. userId 单列索引被 (userId, lessonAt) 覆盖，删掉免得白占写入成本。
--
-- 全部是 ADD COLUMN / DROP COLUMN / UPDATE，没有建表搬数据，所以 Word 表上
-- 那条指向 Note 的外键不用管，D1 上也能直接打。

ALTER TABLE "Note" ADD COLUMN "lessonAt" DATETIME;
ALTER TABLE "Note" ADD COLUMN "updatedAt" DATETIME;

UPDATE "Note"
SET "title" = CASE
    WHEN TRIM("title") = '' THEN TRIM("lesson")
    ELSE TRIM("title") || ' · ' || TRIM("lesson")
  END
WHERE TRIM(COALESCE("lesson", '')) <> '';

UPDATE "Note" SET "lessonAt" = "createdAt", "updatedAt" = "createdAt";

ALTER TABLE "Note" DROP COLUMN "lesson";

DROP INDEX "Note_userId_idx";
CREATE INDEX "Note_userId_lessonAt_idx" ON "Note"("userId", "lessonAt");
CREATE INDEX "Note_userId_course_idx" ON "Note"("userId", "course");
