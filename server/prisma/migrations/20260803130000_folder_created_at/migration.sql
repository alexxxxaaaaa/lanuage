-- Folder 加创建时间,支撑"最新词单排最前"。
-- SQLite 不允许 ADD COLUMN 用非常量默认(CURRENT_TIMESTAMP),故用常量默认;
-- 老行统一回填为该常量(相互顺序不重要),之后新建词单 now() 更晚,自然排最前。
ALTER TABLE "Folder" ADD COLUMN "createdAt" DATETIME NOT NULL DEFAULT '2026-01-01 00:00:00';
