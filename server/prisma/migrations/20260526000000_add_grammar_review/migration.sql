-- CreateTable
CREATE TABLE "GrammarReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "grammarId" TEXT NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "repetition" INTEGER NOT NULL DEFAULT 0,
    "easeFactor" REAL NOT NULL DEFAULT 2.5,
    "difficultyScore" INTEGER NOT NULL DEFAULT 0,
    "lastRating" TEXT NOT NULL DEFAULT '',
    "recentRatings" TEXT NOT NULL DEFAULT '',
    "firstLearnedAt" DATETIME,
    "nextReviewDate" DATETIME NOT NULL,
    "lastReviewedAt" DATETIME,
    CONSTRAINT "GrammarReview_grammarId_fkey" FOREIGN KEY ("grammarId") REFERENCES "Grammar" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "GrammarReview_grammarId_key" ON "GrammarReview"("grammarId");
