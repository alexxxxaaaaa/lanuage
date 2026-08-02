-- 答案分歧：两来源不一致的题，两个答案都判对。
--
-- 原先只存一句渲染好的中文（dispute = "纳豆=4 / mojidict=2（两来源答案不同…）"），
-- 机器用不了，判分只认纳豆那个，选了另一来源的答案一律记错。现在拆成两列：
--   altAnswer   —— 另一来源的答案，1-based，0 = 无分歧；判分对 answer 和它都放行
--   disputeNote —— 人工写的争点说明，全库只有 2013.07 Q51 有
-- 「纳豆=4 / mojidict=2」这句话由前端按两个答案现算，不再入库。
-- 数据源见 n1-qbank/markdown 的 `- alt_answer:` / `- dispute_note:` 字段。

ALTER TABLE "QbankQuestion" ADD COLUMN "altAnswer" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "QbankQuestion" ADD COLUMN "disputeNote" TEXT NOT NULL DEFAULT '';

-- 从旧文案里把另一来源的答案抠出来（形如 "… / mojidict=2（…）"，答案是 1–4 单字符），
-- 这样迁移完就生效，不必等 `npm run import:qbank` 重新导入 markdown。
UPDATE "QbankQuestion"
SET "altAnswer" = CAST(substr("dispute", instr("dispute", 'mojidict=') + 9, 1) AS INTEGER)
WHERE instr("dispute", 'mojidict=') > 0;

-- 按新口径重判历史作答：选了另一来源答案而被记成错的，改判为对，错题本随之更新。
-- 已交卷的整卷成绩（QbankExamAttempt.score）是当时的快照，不追溯重算。
UPDATE "QbankAttempt"
SET "isCorrect" = 1, "updatedAt" = CURRENT_TIMESTAMP
WHERE "isCorrect" = 0
  AND "selected" IN (
    SELECT "altAnswer" FROM "QbankQuestion" q
    WHERE q."id" = "QbankAttempt"."questionId" AND q."altAnswer" > 0
  );

ALTER TABLE "QbankQuestion" DROP COLUMN "dispute";
