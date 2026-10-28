-- 模拟考笔试倒计时可以暂停：两小时不一定能一口气拿出来。
-- pausedAt 非空 = 正暂停着（时钟冻在这一刻），pausedMs = 此前累计暂停的毫秒。
ALTER TABLE "QbankExamAttempt" ADD COLUMN "pausedAt" DATETIME;
ALTER TABLE "QbankExamAttempt" ADD COLUMN "pausedMs" INTEGER NOT NULL DEFAULT 0;
