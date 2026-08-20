-- GrammarQuestion 加「考点」列：答完题后显示这道题考的是什么。
--
-- 外部导入的题库不按语法点归类（题挂在一行占位语法上），而且考点常常在题干
-- 里而不在选项里，还混着词汇辨析题 —— 靠 pattern 匹配只能覆盖约 15%，所以
-- 逐题标注存在这里。空串 = 还没标，前端不显示。
ALTER TABLE "GrammarQuestion" ADD COLUMN "testedPoint" TEXT NOT NULL DEFAULT '';
