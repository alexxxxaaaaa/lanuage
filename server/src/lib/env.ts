import { AsyncLocalStorage } from 'node:async_hooks'

const envStorage = new AsyncLocalStorage<Record<string, string | undefined>>()

export function getEnv(key: string): string | undefined {
  const stored = envStorage.getStore()
  if (stored && key in stored) return stored[key]
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key]
  }
  return undefined
}

export function withEnv<T>(
  env: Record<string, string | undefined>,
  fn: () => Promise<T>,
): Promise<T> {
  return envStorage.run(env, fn)
}
