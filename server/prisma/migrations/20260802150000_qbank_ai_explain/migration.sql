-- AI 逐选项解析的缓存。
--
-- 题库全局共享，同一道题对谁都是同一份分析，所以主键就是 questionId ——
-- 第一个点「AI 解析」的人付 token，之后所有人直接命中，不再计入任何人的每日额度。

CREATE TABLE IF NOT EXISTS "QbankAiExplain" (
  "questionId" TEXT     PRIMARY KEY,
  "summary"    TEXT     NOT NULL,
  "options"    TEXT     NOT NULL DEFAULT '[]',
  "model"      TEXT     NOT NULL DEFAULT '',
  "createdAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QbankAiExplain_questionId_fkey" FOREIGN KEY ("questionId")
    REFERENCES "QbankQuestion" ("id") ON DELETE CASCADE
);
