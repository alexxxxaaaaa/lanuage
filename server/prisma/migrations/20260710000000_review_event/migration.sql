-- Per-rating event log for weekly-review analytics. Written on every
-- Word / Grammar review submission; used to compute count + correctness
-- rate for arbitrary time windows.

CREATE TABLE "ReviewEvent" (
  "id"        TEXT     PRIMARY KEY,
  "userId"    TEXT     NOT NULL,
  "kind"      TEXT     NOT NULL,
  "itemId"    TEXT     NOT NULL,
  "rating"    TEXT     NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReviewEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id")
);
CREATE INDEX "ReviewEvent_userId_createdAt_idx" ON "ReviewEvent" ("userId", "createdAt");
