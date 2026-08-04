-- 让 Grammar 装得下「日语文法蓝宝书 N1-N5」的整本内容。
--
-- 书里一个句型带 1-25 条例句，每条例句自己有中译、真题年份标签和一段朗读音频；
-- N5 部分还有活用表图片。原来的 example / exampleZh 是换行拼接的纯文本，按行号
-- 配对渲染（见 GrammarDetailPage），装得下例句本身，装不下挂在每条例句上的那些
-- 东西。所以新加一个 examples 列存结构化的 [{jp, zh, tag, audio}]。
--
-- 两个字段并存不是过渡态：example / exampleZh 仍然是搜索和纯文本场景读的那一份
-- （getGrammars 的 contains 查询直接打在它们上面），examples 是渲染读的那一份。
-- 导入时两份一起写，手工新建的条目只有前一份，前端按行判断走哪条路径。
--
-- 唯一键从 (userId, pattern) 换成 (userId, pattern, level)：书里「～たところで」
-- 「～てまで」这类句型 N1 和 N2 各收一条、讲不同的用法，共 12 个句型是这种情况。
-- 沿用旧键的话第二条会被 INSERT OR IGNORE 静默吞掉。现有数据每个用户的 pattern
-- 本来就唯一，加一列进键不会让任何一行冲突。

-- 1) 新列一律带常量默认值 —— 老行（含另一个账号的全部语法）读到的就是「没有这些
--    东西」，展示和复习进度不受影响。
ALTER TABLE "Grammar" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'user';
ALTER TABLE "Grammar" ADD COLUMN "sourceId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Grammar" ADD COLUMN "orderNo" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Grammar" ADD COLUMN "examples" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "Grammar" ADD COLUMN "images" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "Grammar" ADD COLUMN "audioKey" TEXT NOT NULL DEFAULT '';

-- 2) 唯一键加上 level。
--    索引这几句都带 IF EXISTS / IF NOT EXISTS：上面的 ALTER 在重跑时必定报
--    duplicate column 并中断整个文件，所以真正需要能重跑的是它前面就已经跑过
--    的部分；万一第一次执行是在中途断的，重跑也能把索引补齐。
DROP INDEX IF EXISTS "Grammar_userId_pattern_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Grammar_userId_pattern_level_key" ON "Grammar"("userId", "pattern", "level");

-- 3) 学习队列按「级别 + 书内顺序」取未学条目，走这条索引。
--    老行 orderNo 全是 0，排序里 orderNo 并列后由 createdAt 兜底，
--    顺序和加这一列之前完全一样。
CREATE INDEX IF NOT EXISTS "Grammar_userId_level_orderNo_idx" ON "Grammar"("userId", "level", "orderNo");
