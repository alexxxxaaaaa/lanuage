import { PrismaD1 } from '@prisma/adapter-d1'
import { PrismaClient } from '@prisma/client'
import { createApp } from './app'
import { createPrismaSlot, withPrisma } from './lib/prisma'
import { withEnv } from './lib/env'
import { withD1 } from './lib/d1'

export type WorkerBindings = {
  DB: D1Database
  JWT_SECRET: string
  OPENAI_API_KEY?: string
  OPENAI_MODEL?: string
  ADMIN_USERNAMES?: string
  ALLOWED_ORIGINS?: string
  DAILY_AI_TOKEN_BUDGET?: string
  SUBTITLE_PROXY_URL?: string
  SUBTITLE_PROXY_TOKEN?: string
  QBANK_MEDIA_BASE?: string
  GRAMMAR_MEDIA_BASE?: string
}

// Cloudflare D1 returns COUNT()/aggregate results as BigInt. JSON.stringify
// throws on BigInt, so any endpoint returning a Prisma `_count` / `groupBy`
// (folder detail word counts, notes word counts, …) 500s in production while
// working locally (better-sqlite3 returns plain numbers). Teach BigInt to
// serialize as a number so those responses go through Hono's c.json() cleanly.
;(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function () {
  return Number(this)
}

const app = createApp()

export default {
  async fetch(
    request: Request,
    env: WorkerBindings,
    ctx: ExecutionContext,
  ): Promise<Response> {
    // 按需构造：Prisma 的 WASM 引擎每次实例化都要十几毫秒 CPU，无条件建一个
    // 等于每个请求都先交这笔钱。走原生 D1 的热路径（播放进度保存）从此完全
    // 不碰它。槽位在 finally 里检查，没造出来就不用 disconnect。
    const slot = createPrismaSlot(
      () => new PrismaClient({ adapter: new PrismaD1(env.DB) }),
    )

    const envBag: Record<string, string | undefined> = {
      JWT_SECRET: env.JWT_SECRET,
      OPENAI_API_KEY: env.OPENAI_API_KEY,
      OPENAI_MODEL: env.OPENAI_MODEL,
      ADMIN_USERNAMES: env.ADMIN_USERNAMES,
      ALLOWED_ORIGINS: env.ALLOWED_ORIGINS,
      DAILY_AI_TOKEN_BUDGET: env.DAILY_AI_TOKEN_BUDGET,
      SUBTITLE_PROXY_URL: env.SUBTITLE_PROXY_URL,
      SUBTITLE_PROXY_TOKEN: env.SUBTITLE_PROXY_TOKEN,
      QBANK_MEDIA_BASE: env.QBANK_MEDIA_BASE,
      GRAMMAR_MEDIA_BASE: env.GRAMMAR_MEDIA_BASE,
    }

    try {
      return await withEnv(envBag, async () =>
        withD1(env.DB, async () =>
          withPrisma(slot, async () => app.fetch(request, env, ctx)),
        ),
      )
    } finally {
      if (slot.client) ctx.waitUntil(slot.client.$disconnect())
    }
  },
}
