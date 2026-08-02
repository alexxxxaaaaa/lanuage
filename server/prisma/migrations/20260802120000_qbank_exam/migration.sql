-- 模拟考试（整卷作答）。用户维度的表，题目仍然读 QbankQuestion。
--
-- 和 20260802000000_qbank 一样带 IF NOT EXISTS：线上 D1 是手工
-- `wrangler d1 execute --file` 打的，重复执行必须安全。

CREATE TABLE IF NOT EXISTS "QbankExamAttempt" (
  "id"                 TEXT     PRIMARY KEY,
  "userId"             TEXT     NOT NULL,
  "level"              TEXT     NOT NULL DEFAULT 'N1',
  "year"               INTEGER  NOT NULL,
  "month"              INTEGER  NOT NULL,
  "mode"               TEXT     NOT NULL DEFAULT 'strict',
  "answers"            TEXT     NOT NULL DEFAULT '{}',
  "score"              TEXT     NOT NULL DEFAULT '',
  "startedAt"          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "writtenSubmittedAt" DATETIME,
  "finishedAt"         DATETIME
);

-- 一套卷一条记录：开考走 INSERT，重置走 DELETE，靠这条唯一索引兜底。
CREATE UNIQUE INDEX IF NOT EXISTS "QbankExamAttempt_userId_level_year_month_key"
  ON "QbankExamAttempt" ("userId", "level", "year", "month");
