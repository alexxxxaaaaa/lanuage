-- Real-exam upload feature. Each Exam holds one uploaded JLPT-style test:
-- the parsed question structure lives inline as a JSON blob in `parsedData`,
-- while the original PDF and audio (large binary assets) are referenced by
-- URL and stored in R2 externally.

CREATE TABLE "Exam" (
  "id"             TEXT     PRIMARY KEY,
  "userId"         TEXT     NOT NULL,
  "title"          TEXT     NOT NULL,
  "year"           TEXT     NOT NULL DEFAULT '',
  "level"          TEXT     NOT NULL DEFAULT 'N1',
  "questionPdfUrl" TEXT     NOT NULL DEFAULT '',
  "solutionPdfUrl" TEXT     NOT NULL DEFAULT '',
  "audioUrl"       TEXT     NOT NULL DEFAULT '',
  "parsedData"     TEXT     NOT NULL,
  "createdAt"      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      DATETIME NOT NULL,
  CONSTRAINT "Exam_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id")
);
CREATE INDEX "Exam_userId_idx" ON "Exam" ("userId");

CREATE TABLE "ExamAttempt" (
  "id"          TEXT     PRIMARY KEY,
  "examId"      TEXT     NOT NULL,
  "answers"     TEXT     NOT NULL DEFAULT '{}',
  "score"       INTEGER,
  "scoreByType" TEXT     NOT NULL DEFAULT '{}',
  "startedAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt"  DATETIME,
  CONSTRAINT "ExamAttempt_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam" ("id")
);
CREATE INDEX "ExamAttempt_examId_idx" ON "ExamAttempt" ("examId");
