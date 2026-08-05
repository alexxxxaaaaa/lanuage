/**
 * 语法条目的级别取值。
 *
 * 蓝宝书导进来的条目带 N1-N5，手工建的默认落在 CUSTOM（前端显示成「自建」）。
 * level 这一列是自由文本，历史数据里除这六种之外还有别的值（早先服务端不带
 * level 就回落成 'N1'，也可能有人从接口直接写过别的），所以「自建」这一档在
 * 查询侧是「不属于 N1-N5」而不是「等于 CUSTOM」—— 否则前端筛出来的条数和
 * 学习队列拿到的条数对不上。
 */
export const JLPT_LEVELS = ['N1', 'N2', 'N3', 'N4', 'N5']

export const CUSTOM_LEVEL = 'CUSTOM'

/** 级别筛选的 where 片段。不传 level 就不筛。 */
export function levelFilter(level?: string) {
  if (!level) return {}
  return { level: level === CUSTOM_LEVEL ? { notIn: JLPT_LEVELS } : level }
}
