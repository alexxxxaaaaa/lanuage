-- 暂停学习：null = 正常。暂停的词单不再往今日复习 / 今日新词里送词。
ALTER TABLE "Folder" ADD COLUMN "pausedAt" DATETIME;
