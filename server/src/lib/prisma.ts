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

const requestStorage = new AsyncLocalStorage<PrismaClient>()

let nodeSingleton: PrismaClient | null = null

function getNodeSingleton(): PrismaClient {
  if (!nodeSingleton) {
    nodeSingleton = createNodePrismaClient()
  }
  return nodeSingleton
}

function resolveClient(): PrismaClient {
  const requestPrisma = requestStorage.getStore()
  if (requestPrisma) return requestPrisma
  return getNodeSingleton()
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = resolveClient() as unknown as Record<string | symbol, unknown>
    const value = client[prop]
    return typeof value === 'function' ? (value as Function).bind(client) : value
  },
})

export function withPrisma<T>(client: PrismaClient, fn: () => Promise<T>): Promise<T> {
  return requestStorage.run(client, fn)
}
