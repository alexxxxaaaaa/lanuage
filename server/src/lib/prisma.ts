import { AsyncLocalStorage } from 'node:async_hooks'
import { PrismaClient } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'

/**
 * In Node (local dev), we use a single PrismaClient instance pointed at SQLite.
 * In Workers (production), each request creates a PrismaClient bound to the
 * D1 adapter — see src/worker.ts. The request-scoped client is stored in
 * AsyncLocalStorage so existing service code (which imports the singleton)
 * keeps working unchanged.
 *
 * Prisma 7 dropped `datasource.url` from the schema: every client must be
 * handed a driver adapter explicitly. createNodePrismaClient() is the single
 * place that knows how to build the SQLite one, shared by the dev server and
 * the one-off scripts/ so the URL default can't drift between them.
 */

/**
 * Relative SQLite paths resolve against the process CWD (always server/ — both
 * `npm run -w server` and the scripts run from there), which matches how
 * prisma.config.ts resolves it for the CLI.
 */
const NODE_DATABASE_URL = process.env.DATABASE_URL ?? 'file:./prisma/dev.db'

export function createNodePrismaClient(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: NODE_DATABASE_URL }),
    log: ['warn', 'error'],
  })
}

/**
 * 请求作用域的客户端槽位。存的是「怎么造」而不是「已经造好的」——Workers 上
 * 的 Prisma 是 WASM 查询引擎，`new PrismaClient()` 是实打实的 CPU 开销，实测
 * 光是读一行设置的请求也要 15ms 左右。以前在 worker.ts 的 fetch 顶上无条件
 * 造一个，等于每个请求都先交这笔钱，哪怕它压根不查库；一簇并发请求撞上来就
 * 有人被 Cloudflare 以 `exceededCpu` 杀掉（实测 560 个请求里 30 个）。
 *
 * 现在推迟到第一次真正用到 prisma 时才造。走原生 D1 的那几条热路径（见
 * lib/d1）从此完全不碰这个引擎。
 */
export type PrismaSlot = {
  readonly factory: () => PrismaClient
  client: PrismaClient | null
}

export function createPrismaSlot(factory: () => PrismaClient): PrismaSlot {
  return { factory, client: null }
}

const requestStorage = new AsyncLocalStorage<PrismaSlot>()

let nodeSingleton: PrismaClient | null = null

function getNodeSingleton(): PrismaClient {
  if (!nodeSingleton) {
    nodeSingleton = createNodePrismaClient()
  }
  return nodeSingleton
}

function resolveClient(): PrismaClient {
  const slot = requestStorage.getStore()
  if (slot) {
    if (!slot.client) slot.client = slot.factory()
    return slot.client
  }
  return getNodeSingleton()
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = resolveClient() as unknown as Record<string | symbol, unknown>
    const value = client[prop]
    return typeof value === 'function' ? (value as Function).bind(client) : value
  },
})

export function withPrisma<T>(slot: PrismaSlot, fn: () => Promise<T>): Promise<T> {
  return requestStorage.run(slot, fn)
}
