-- 下线「真题」和「精读」两个板块，连表一起删。
--
-- 这两块共用 Exam / ExamAttempt：真题是整卷 PDF 经 AI 解析成 parsedData，
-- 精读是把其中的读解拆成一条条 `精读·` 前缀的 Exam 行。二者的内容
-- （2010.07 / 2011.07 / 2011.12 三套卷）在 QbankQuestion 里都有，
-- 整卷计时考改由 QbankExamAttempt 承担，见 20260802120000_qbank_exam。
--
-- 一并作废的外部资源（SQL 删不掉，要手动收拾）：
--   R2 桶 jlpt 里的 n1-2011-07.mp3 / n1-2011-12.mp3
--   client/public/exam-media/*.srt（已随本次提交删除）

DROP TABLE IF EXISTS "ExamAttempt";
DROP TABLE IF EXISTS "Exam";
