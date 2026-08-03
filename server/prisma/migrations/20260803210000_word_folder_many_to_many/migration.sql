-- 词单归属从 Word 行上拆出来，改成 Word ↔ Folder 多对多。
--
-- 改之前：Word 一行同时是「词条内容 + 归属某个词单 + 学习状态的锚点」，唯一键是
-- (folderId, word)。同一个词加进两个词单就是两行 Word + 两条 Review —— 今日复习
-- 里出现两次、各自独立算 FSRS，掌握度不共享，改释义要改两处。
--
-- 改之后：Word = 「我的词」，一个用户一个词一行（唯一键 (userId, word, language)），
-- Review 依旧 1:1 挂在它上面；词单退化成挂在词上的标签，存在 WordFolder 里。
--
-- 顺带删掉 Word.isPinned：全仓库只有 `isPinned: true` 的写入，没有任何查询读它，
-- 排序一律用 pinnedAt。旧索引 (folderId, isPinned, pinnedAt) 中间夹着这个不参与
-- 查询的列，ORDER BY pinnedAt 根本用不上它，新索引换成 (userId, pinnedAt)。
--
-- SQLite 不能 DROP 掉带外键约束的列，所以 Word 走「建新表 → 搬数据 → 换名」。
-- 麻烦的是 Review 有外键指向 Word：DROP TABLE 会隐式清空全表，D1 默认强制外键，
-- 于是每一行 Review 都被记成一次违规。`PRAGMA defer_foreign_keys` 在这里救不了 ——
-- 它只是把检查推迟到 COMMIT，而违规计数不会因为后面把新表改名回 Word 就被抵消，
-- 照样在提交时炸（本地用开启外键的连接验证过）。
--
-- 所以 Review 也一起重建：先把它的行抄进一张没有外键的临时表并把原表删掉，这样
-- Word 被 DROP 的那一刻没有任何表引用它；等 Word 换名到位，再按原样把 Review 建
-- 回来。全程不依赖任何 PRAGMA，外键开或关都能跑。

-- 1) Word 重建会丢掉 folderId，先把「词 → 词单 / 归属人」的对应关系抄出来。
CREATE TABLE "_word_migration" (
    "wordId" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "canonicalId" TEXT
);

INSERT INTO "_word_migration" ("wordId", "folderId", "userId", "createdAt")
SELECT w."id", w."folderId", f."userId", w."createdAt"
FROM "Word" w
JOIN "Folder" f ON f."id" = w."folderId";

-- 2) 同一个用户的同一个词散在多个词单里的，合并成一行：保留复习进度最靠前的那条
--    （repetition 最大，并列时取创建最早的），其余的词单归属改指向它。
--
--    用窗口函数一趟算出每组的胜者再按 wordId 回填。最初写的是对每行跑相关子查询
--    的 UPDATE —— O(n²) 还嵌套 Review 查询，本地 SQLite 几秒跑完，D1 直接
--    「exceeded its CPU time limit」整体回滚（线上实测）。
CREATE TABLE "_canonical" AS
SELECT "wordId", "canonicalId" FROM (
    SELECT m."wordId",
           FIRST_VALUE(m."wordId") OVER (
               PARTITION BY m."userId", w."word", w."language"
               ORDER BY COALESCE(r."repetition", -1) DESC, w."createdAt" ASC, m."wordId" ASC
           ) AS "canonicalId"
    FROM "_word_migration" m
    JOIN "Word" w ON w."id" = m."wordId"
    LEFT JOIN "Review" r ON r."wordId" = m."wordId"
);

CREATE INDEX "_canonical_wordId_idx" ON "_canonical"("wordId");

UPDATE "_word_migration"
SET "canonicalId" = (
    SELECT c."canonicalId" FROM "_canonical" c WHERE c."wordId" = "_word_migration"."wordId"
);

DROP TABLE "_canonical";

DELETE FROM "Review"
WHERE "wordId" IN (SELECT "wordId" FROM "_word_migration" WHERE "wordId" <> "canonicalId");

DELETE FROM "Word"
WHERE "id" IN (SELECT "wordId" FROM "_word_migration" WHERE "wordId" <> "canonicalId");

-- 3) 把 Review 挪到无外键的临时表并删掉原表，好让下一步能安全地 DROP Word。
CREATE TABLE "_review_backup" (
    "id" TEXT NOT NULL,
    "wordId" TEXT NOT NULL,
    "interval" INTEGER NOT NULL,
    "repetition" INTEGER NOT NULL,
    "easeFactor" REAL NOT NULL,
    "difficultyScore" INTEGER NOT NULL,
    "lastRating" TEXT NOT NULL,
    "recentRatings" TEXT NOT NULL,
    "firstLearnedAt" DATETIME,
    "nextReviewDate" DATETIME NOT NULL,
    "lastReviewedAt" DATETIME
);

INSERT INTO "_review_backup"
SELECT "id", "wordId", "interval", "repetition", "easeFactor", "difficultyScore",
       "lastRating", "recentRatings", "firstLearnedAt", "nextReviewDate", "lastReviewedAt"
FROM "Review";

DROP TABLE "Review";

-- 4) 重建 Word：挂 userId，去掉 folderId / isPinned。id 保持不变 —— Review.wordId、
--    ReviewEvent.itemId 和前端的 #word-<id> 锚点都指着它。
CREATE TABLE "new_Word" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "word" TEXT NOT NULL,
    "reading" TEXT NOT NULL,
    "meaning" TEXT NOT NULL,
    "example" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "partOfSpeech" TEXT NOT NULL DEFAULT '',
    "language" TEXT NOT NULL,
    "sourceNoteId" TEXT,
    "pinnedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Word_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Word_sourceNoteId_fkey" FOREIGN KEY ("sourceNoteId") REFERENCES "Note" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_Word" ("id", "userId", "word", "reading", "meaning", "example", "note", "partOfSpeech", "language", "sourceNoteId", "pinnedAt", "createdAt")
SELECT w."id", m."userId", w."word", w."reading", w."meaning", w."example", w."note",
       w."partOfSpeech", w."language", w."sourceNoteId", w."pinnedAt", w."createdAt"
FROM "Word" w
JOIN (SELECT DISTINCT "wordId", "userId" FROM "_word_migration") m ON m."wordId" = w."id";

DROP TABLE "Word";
ALTER TABLE "new_Word" RENAME TO "Word";

CREATE UNIQUE INDEX "Word_userId_word_language_key" ON "Word"("userId", "word", "language");
CREATE INDEX "Word_userId_pinnedAt_idx" ON "Word"("userId", "pinnedAt");

-- 5) 按原样把 Review 建回来（外键这时指向的已经是新的 Word）。
CREATE TABLE "Review" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "wordId" TEXT NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "repetition" INTEGER NOT NULL DEFAULT 0,
    "easeFactor" REAL NOT NULL DEFAULT 2.5,
    "difficultyScore" INTEGER NOT NULL DEFAULT 0,
    "lastRating" TEXT NOT NULL DEFAULT '',
    "recentRatings" TEXT NOT NULL DEFAULT '',
    "firstLearnedAt" DATETIME,
    "nextReviewDate" DATETIME NOT NULL,
    "lastReviewedAt" DATETIME,
    CONSTRAINT "Review_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "Word" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

INSERT INTO "Review"
SELECT "id", "wordId", "interval", "repetition", "easeFactor", "difficultyScore",
       "lastRating", "recentRatings", "firstLearnedAt", "nextReviewDate", "lastReviewedAt"
FROM "_review_backup";

CREATE UNIQUE INDEX "Review_wordId_key" ON "Review"("wordId");

DROP TABLE "_review_backup";

-- 6) 归属表。词单删掉时归属跟着删（级联），词本身由服务端决定是否成了孤词。
CREATE TABLE "WordFolder" (
    "wordId" TEXT NOT NULL,
    "folderId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WordFolder_wordId_fkey" FOREIGN KEY ("wordId") REFERENCES "Word" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WordFolder_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    PRIMARY KEY ("wordId", "folderId")
);

INSERT OR IGNORE INTO "WordFolder" ("wordId", "folderId", "createdAt")
SELECT "canonicalId", "folderId", "createdAt" FROM "_word_migration";

CREATE INDEX "WordFolder_folderId_idx" ON "WordFolder"("folderId");

DROP TABLE "_word_migration";
