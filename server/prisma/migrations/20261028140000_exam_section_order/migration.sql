-- 模拟考可以先做听力。顺序开考时定格在 attempt 上，默认值来自用户设置。
-- 'written' = 官方顺序（笔试→听力），'listening' = 先听力。
ALTER TABLE "QbankExamAttempt" ADD COLUMN "sectionOrder" TEXT NOT NULL DEFAULT 'written';
ALTER TABLE "QbankExamAttempt" ADD COLUMN "listeningSubmittedAt" DATETIME;
ALTER TABLE "UserSettings" ADD COLUMN "examSectionOrder" TEXT NOT NULL DEFAULT 'written';
