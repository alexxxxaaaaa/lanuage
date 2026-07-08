-- Real exams become globally visible (admin-uploaded shared library).
-- Attempts remain per-user, so add userId to ExamAttempt and backfill from
-- the exam's original uploader (their old "creator" was the same person who
-- would have taken attempts against it in the old per-user model).

ALTER TABLE "ExamAttempt" ADD COLUMN "userId" TEXT NOT NULL DEFAULT '';

UPDATE "ExamAttempt"
SET "userId" = (
  SELECT "Exam"."userId"
  FROM "Exam"
  WHERE "Exam"."id" = "ExamAttempt"."examId"
)
WHERE "userId" = '';

CREATE INDEX "ExamAttempt_userId_idx" ON "ExamAttempt" ("userId");
