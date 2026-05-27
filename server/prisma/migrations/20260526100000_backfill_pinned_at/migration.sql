-- Backfill pinnedAt for all existing Words so the unified "top of list" sort
-- by pinnedAt DESC works without NULL sentinels. New words (created from now
-- on) auto-receive pinnedAt = createdAt at insertion time, so this only needs
-- to fix historical rows.
UPDATE "Word" SET "pinnedAt" = "createdAt" WHERE "pinnedAt" IS NULL;
