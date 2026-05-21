-- CreateTable
CREATE TABLE "Grammar" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pattern" TEXT NOT NULL,
    "connection" TEXT NOT NULL DEFAULT '',
    "meaning" TEXT NOT NULL DEFAULT '',
    "example" TEXT NOT NULL DEFAULT '',
    "exampleZh" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "level" TEXT NOT NULL DEFAULT 'N1',
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Grammar_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Grammar_userId_idx" ON "Grammar"("userId");

-- CreateIndex
CREATE INDEX "Grammar_level_idx" ON "Grammar"("level");

-- CreateIndex
CREATE UNIQUE INDEX "Grammar_userId_pattern_key" ON "Grammar"("userId", "pattern");
