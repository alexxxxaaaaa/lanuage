-- AlterTable
ALTER TABLE "Word" ADD COLUMN "isPinned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Word" ADD COLUMN "pinnedAt" DATETIME;

-- CreateIndex
CREATE INDEX "Word_folderId_isPinned_pinnedAt_idx" ON "Word"("folderId", "isPinned", "pinnedAt");
