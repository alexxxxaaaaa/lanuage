-- 真题归类：一场考试 = 级别 + 年 + 月，同一 (级别, 年) 为一「套」。
-- 空字符串 / 0 表示未归类。
ALTER TABLE "Podcast" ADD COLUMN "examLevel" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Podcast" ADD COLUMN "examYear" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Podcast" ADD COLUMN "examMonth" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Podcast_userId_examLevel_examYear_examMonth_idx"
  ON "Podcast"("userId", "examLevel", "examYear", "examMonth");
