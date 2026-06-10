-- Pin-to-top for Grammar, mirroring the Word.isPinned / pinnedAt timeline.
-- Backfills pinnedAt = createdAt so existing rows have a non-null sort key,
-- and the list orders by pinnedAt DESC without NULL sentinels at the bottom.
ALTER TABLE "Grammar" ADD COLUMN "isPinned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Grammar" ADD COLUMN "pinnedAt" DATETIME;
UPDATE "Grammar" SET "pinnedAt" = "createdAt" WHERE "pinnedAt" IS NULL;
CREATE INDEX "Grammar_userId_pinnedAt_idx" ON "Grammar"("userId", "pinnedAt");
