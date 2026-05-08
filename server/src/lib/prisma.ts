import { AsyncLocalStorage } from 'node:async_hooks'
import { PrismaClient } from '@prisma/client'

/**
 * In Node (local dev), we use a single PrismaClient instance pointed at SQLite.
 * In Workers (production), each request creates a PrismaClient bound to the
 * D1 adapter — see src/worker.ts. The request-scoped client is stored in
 * AsyncLocalStorage so existing service code (which imports the singleton)
 * keeps working unchanged.
 */

const requestStorage = new AsyncLocalStorage<PrismaClient>()

let nodeSingleton: PrismaClient | null = null

function getNodeSingleton(): PrismaClient {
  if (!nodeSingleton) {
    nodeSingleton = new PrismaClient({ log: ['warn', 'error'] })
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
