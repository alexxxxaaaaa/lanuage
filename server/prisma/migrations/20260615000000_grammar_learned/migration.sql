-- Manual "learned" flag for Grammar. Independent from FSRS state — user can
-- toggle on/off from the list UI; LearnGrammarPage's initial review also
-- auto-sets this to true so the list filter Just Works after a learn session.
ALTER TABLE "Grammar" ADD COLUMN "isLearned" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: any Grammar that already has a GrammarReview row counts as learned.
UPDATE "Grammar"
SET "isLearned" = true
WHERE EXISTS (SELECT 1 FROM "GrammarReview" gr WHERE gr."grammarId" = "Grammar"."id");
