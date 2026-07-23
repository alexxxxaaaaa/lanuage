-- N1-style multiple-choice questions attached to each Grammar row.
-- `options` is a JSON-stringified array of 4 strings; `answerIndex` is 0..3.

CREATE TABLE "GrammarQuestion" (
  "id"          TEXT     PRIMARY KEY,
  "grammarId"   TEXT     NOT NULL,
  "prompt"      TEXT     NOT NULL,
  "options"     TEXT     NOT NULL,
  "answerIndex" INTEGER  NOT NULL,
  "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GrammarQuestion_grammarId_fkey" FOREIGN KEY ("grammarId") REFERENCES "Grammar" ("id") ON DELETE CASCADE
);
CREATE INDEX "GrammarQuestion_grammarId_idx" ON "GrammarQuestion" ("grammarId");

-- One row per (user, question) attempt. We overwrite on re-answer so the
-- wrong-questions view reflects the user's latest attempt.
CREATE TABLE "GrammarQuestionAttempt" (
  "id"            TEXT     PRIMARY KEY,
  "userId"        TEXT     NOT NULL,
  "questionId"    TEXT     NOT NULL,
  "selectedIndex" INTEGER  NOT NULL,
  "isCorrect"     BOOLEAN  NOT NULL,
  "createdAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GrammarQuestionAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id"),
  CONSTRAINT "GrammarQuestionAttempt_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "GrammarQuestion" ("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "GrammarQuestionAttempt_userId_questionId_key" ON "GrammarQuestionAttempt" ("userId", "questionId");
CREATE INDEX "GrammarQuestionAttempt_userId_isCorrect_idx" ON "GrammarQuestionAttempt" ("userId", "isCorrect");
