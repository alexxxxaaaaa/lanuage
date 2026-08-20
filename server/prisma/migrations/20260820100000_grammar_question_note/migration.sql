-- GrammarQuestion 加用户备注列。
--
-- 挂在题上而不是 (用户, 题) 上：GrammarQuestion 本来就是通过 grammarId 属于
-- 某个用户的（题库不是全局共享的，和 QbankQuestion 不同），所以一列就够。
ALTER TABLE "GrammarQuestion" ADD COLUMN "note" TEXT NOT NULL DEFAULT '';
