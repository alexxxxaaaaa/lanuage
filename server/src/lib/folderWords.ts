import { prisma } from './prisma'

/**
 * 「某个词单里有哪些词」——只走原生 SQL 取 id，别用 Prisma 的
 * `folders: { some: { folderId } }`。
 *
 * 那个 to-many 关系过滤在 Prisma 的 D1 adapter 上会绑错参数，报出来的是
 *   Missing data field (Value): 'id'; data: {"undefined":"<userId>"}
 * ——「undefined」是被吞掉的参数名，值是第一个标量参数。同样的 include 换成
 * `id: { in: [...] }` 就正常。to-one 的关系过滤（review.word.userId）没问题，
 * 坏的只有 to-many 的 some。
 *
 * 顺序也在 SQL 里定好：统一的 pinnedAt 时间线（置顶会刷新 pinnedAt，新词
 * 建的时候 pinnedAt = createdAt）。调用方拿 id 的下标去重排即可 —— 不要给
 * Prisma 挂 orderBy，取回来的顺序不保证。
 */
export async function wordIdsInFolder(folderId: string, userId: string) {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT w.id FROM Word w
    JOIN WordFolder wf ON wf.wordId = w.id
    WHERE wf.folderId = ${folderId} AND w.userId = ${userId}
    ORDER BY w.pinnedAt DESC, w.createdAt DESC
  `
  return rows.map((row) => row.id)
}

/**
 * D1 的绑定参数上限在 100 上下，而一个词单动辄几千个词，`id: { in: [...] }`
 * 一次塞不下。切成小块逐批查，调用方负责把结果拼起来。
 */
export const ID_CHUNK = 90

export function chunkIds(ids: string[], size = ID_CHUNK): string[][] {
  const out: string[][] = []
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size))
  return out
}

/** 按 ids 的先后顺序重排取回来的行。 */
export function sortByIdOrder<T extends { id: string }>(rows: T[], ids: string[]) {
  const rank = new Map(ids.map((id, index) => [id, index]))
  return rows.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
}
