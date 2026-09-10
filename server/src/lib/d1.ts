import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * 请求作用域的 D1 绑定，给「热且极简」的那几条路径绕开 Prisma 用。
 *
 * 为什么要绕：Workers 上的 Prisma 是 WASM 查询引擎，`new PrismaClient()` 本身
 * 就要十几毫秒 CPU。像播放进度保存那样每 5 秒一次、只做一条单行 UPDATE 的
 * 接口，19ms 的 CPU 里几乎全花在建引擎上，实测被 `exceededCpu` 杀掉的比例
 * 高达 14%。同样一条 UPDATE 直接走 D1 绑定是一两毫秒的事。
 *
 * 只在确实划算的地方用它 —— 单表、单条、不需要关系和类型的语句。别拿它重写
 * 业务逻辑：Prisma 那套类型和关系处理是有价值的，这里换来的只是 CPU。
 *
 * 本地开发（Node + better-sqlite3）没有 D1 绑定，getD1() 返回 null，调用方
 * 必须保留一条走 Prisma 的等价实现。
 */
const d1Storage = new AsyncLocalStorage<D1Database>()

export function withD1<T>(db: D1Database, fn: () => Promise<T>): Promise<T> {
  return d1Storage.run(db, fn)
}

export function getD1(): D1Database | null {
  return d1Storage.getStore() ?? null
}

/**
 * Prisma 的 SQLite 连接器把 DateTime 存成 TEXT，形如
 * `2026-06-04T06:28:32.038+00:00` —— 注意结尾是 `+00:00` 而不是 `Z`。
 * 原生 SQL 写时间戳必须用同一种写法，否则 Prisma 那头读回来会对不上。
 * （`CURRENT_TIMESTAMP` 给的是 `2026-06-04 06:28:32`，格式不对，别用。）
 */
export function prismaNow(): string {
  return new Date().toISOString().replace('Z', '+00:00')
}
