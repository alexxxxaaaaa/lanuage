-- JLPT 精练题库（qbank）。
--
-- 前身 ExamPaper / ExamPassage / ExamQuestion 只被已删除的 importExam.ts 写过，
-- 前后端都没有引用，这里直接废弃，换成下面这套按题型/年份精练的结构。
-- 注意：真题 tab 用的是 Exam / ExamAttempt，与这三张表无关，不受影响。
--
-- 全部 CREATE 都带 IF NOT EXISTS：D1 那边是靠 `wrangler d1 execute --file` 手工打的，
-- d1_qbank/apply.sh 每次都会先跑一遍这个文件，重复执行必须是安全的。

DROP TABLE IF EXISTS "ExamQuestion";
DROP TABLE IF EXISTS "ExamPassage";
DROP TABLE IF EXISTS "ExamPaper";

-- 阅读原文 / 听力原文。年份维度直接落在行上，没有独立的「试卷」表。
CREATE TABLE IF NOT EXISTS "QbankPassage" (
  "id"      TEXT    PRIMARY KEY,
  "level"   TEXT    NOT NULL DEFAULT 'N1',
  "year"    INTEGER NOT NULL,
  "month"   INTEGER NOT NULL,
  "code"    TEXT    NOT NULL,
  "type"    TEXT    NOT NULL DEFAULT '',
  "content" TEXT    NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "QbankPassage_level_year_month_code_key"
  ON "QbankPassage" ("level", "year", "month", "code");

-- 单题。category+mondaiNo = 題型，(level,year,month) = 年份，两个维度合起来
-- 就是目录树的三级；练习集的筛选与排序全部命中下面那条复合索引。
CREATE TABLE IF NOT EXISTS "QbankQuestion" (
  "id"        TEXT    PRIMARY KEY,
  "level"     TEXT    NOT NULL DEFAULT 'N1',
  "year"      INTEGER NOT NULL,
  "month"     INTEGER NOT NULL,
  "category"  TEXT    NOT NULL,
  "mondaiNo"  INTEGER NOT NULL,
  "seq"       TEXT    NOT NULL,
  "orderNo"   INTEGER NOT NULL,
  "stemJp"    TEXT    NOT NULL DEFAULT '',
  "stemZh"    TEXT    NOT NULL DEFAULT '',
  "options"   TEXT    NOT NULL DEFAULT '[]',
  "answer"    INTEGER NOT NULL,
  "explain"   TEXT    NOT NULL DEFAULT '',
  "audioKey"  TEXT    NOT NULL DEFAULT '',
  "source"    TEXT    NOT NULL DEFAULT 'nadou',
  "dispute"   TEXT    NOT NULL DEFAULT '',
  "passageId" TEXT,
  CONSTRAINT "QbankQuestion_passageId_fkey" FOREIGN KEY ("passageId")
    REFERENCES "QbankPassage" ("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "QbankQuestion_level_year_month_seq_key"
  ON "QbankQuestion" ("level", "year", "month", "seq");
CREATE INDEX IF NOT EXISTS "QbankQuestion_category_mondaiNo_year_month_orderNo_idx"
  ON "QbankQuestion" ("category", "mondaiNo", "year", "month", "orderNo");
CREATE INDEX IF NOT EXISTS "QbankQuestion_passageId_idx" ON "QbankQuestion" ("passageId");

-- 每个 (用户, 题) 一行，重做时覆盖：答题卡与错题本只看最近一次结果。
CREATE TABLE IF NOT EXISTS "QbankAttempt" (
  "id"         TEXT     PRIMARY KEY,
  "userId"     TEXT     NOT NULL,
  "questionId" TEXT     NOT NULL,
  "selected"   INTEGER  NOT NULL,
  "isCorrect"  BOOLEAN  NOT NULL,
  "createdAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QbankAttempt_questionId_fkey" FOREIGN KEY ("questionId")
    REFERENCES "QbankQuestion" ("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "QbankAttempt_userId_questionId_key"
  ON "QbankAttempt" ("userId", "questionId");
CREATE INDEX IF NOT EXISTS "QbankAttempt_userId_isCorrect_idx"
  ON "QbankAttempt" ("userId", "isCorrect");

CREATE TABLE IF NOT EXISTS "QbankFavorite" (
  "id"         TEXT     PRIMARY KEY,
  "userId"     TEXT     NOT NULL,
  "questionId" TEXT     NOT NULL,
  "createdAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QbankFavorite_questionId_fkey" FOREIGN KEY ("questionId")
    REFERENCES "QbankQuestion" ("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "QbankFavorite_userId_questionId_key"
  ON "QbankFavorite" ("userId", "questionId");
CREATE INDEX IF NOT EXISTS "QbankFavorite_userId_createdAt_idx"
  ON "QbankFavorite" ("userId", "createdAt");
