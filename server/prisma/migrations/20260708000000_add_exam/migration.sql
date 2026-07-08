-- CreateTable
CREATE TABLE "ExamPaper" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "level" TEXT NOT NULL DEFAULT 'N1',
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ExamPassage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paperId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL,
    CONSTRAINT "ExamPassage_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "ExamPaper" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExamQuestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paperId" TEXT NOT NULL,
    "seq" TEXT NOT NULL,
    "orderNo" INTEGER NOT NULL,
    "section" TEXT NOT NULL,
    "mondai" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL DEFAULT '',
    "stemJp" TEXT NOT NULL DEFAULT '',
    "stemZh" TEXT NOT NULL DEFAULT '',
    "options" TEXT NOT NULL DEFAULT '[]',
    "answer" INTEGER NOT NULL,
    "explain" TEXT NOT NULL DEFAULT '',
    "passageCode" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "ExamQuestion_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "ExamPaper" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ExamPaper_level_year_month_key" ON "ExamPaper"("level", "year", "month");

-- CreateIndex
CREATE INDEX "ExamPassage_paperId_idx" ON "ExamPassage"("paperId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamPassage_paperId_code_key" ON "ExamPassage"("paperId", "code");

-- CreateIndex
CREATE INDEX "ExamQuestion_paperId_idx" ON "ExamQuestion"("paperId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamQuestion_paperId_seq_key" ON "ExamQuestion"("paperId", "seq");
