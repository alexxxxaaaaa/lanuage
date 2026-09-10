/**
 * 新学时从词单的哪一头开始。
 *
 * - `forward`：和词单详情页里看到的顺序一致（置顶在前，然后新词在前）。
 * - `reverse`：严格倒过来，从词单最下面那个词开始学。
 *
 * 之所以在前端翻而不是给接口加个 order 参数：`/api/words/today-new` 返回的是
 * 完整的未学列表（服务端那条 SQL 明确没有 LIMIT），而「学习个数」的截断发生
 * 在拿到列表之后。所以先整体翻转再截断，得到的就是词单顺序的严格倒序 ——
 * 倒序取 20 个 = 词单最后 20 个未学的词。
 *
 * 哪天服务端改成分页返回，这个前提就不成立了，那时候要把顺序推到 SQL 里去。
 */
export type LearnOrder = 'forward' | 'reverse'

export function applyLearnOrder<T>(items: readonly T[], order: LearnOrder): T[] {
  return order === 'reverse' ? [...items].reverse() : [...items]
}
