import { PrismaD1 } from '@prisma/adapter-d1'
import { PrismaClient } from '@prisma/client'
import { createApp } from './app'
import { withPrisma } from './lib/prisma'
import { withEnv } from './lib/env'

export type WorkerBindings = {
  DB: D1Database
  JWT_SECRET: string
  OPENAI_API_KEY?: string
  OPENAI_MODEL?: string
  ADMIN_USERNAMES?: string
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
    const adapter = new PrismaD1(env.DB)
    const prisma = new PrismaClient({ adapter })

    const envBag: Record<string, string | undefined> = {
      JWT_SECRET: env.JWT_SECRET,
      OPENAI_API_KEY: env.OPENAI_API_KEY,
      OPENAI_MODEL: env.OPENAI_MODEL,
      ADMIN_USERNAMES: env.ADMIN_USERNAMES,
      DAILY_AI_TOKEN_BUDGET: env.DAILY_AI_TOKEN_BUDGET,
      SUBTITLE_PROXY_URL: env.SUBTITLE_PROXY_URL,
      SUBTITLE_PROXY_TOKEN: env.SUBTITLE_PROXY_TOKEN,
      QBANK_MEDIA_BASE: env.QBANK_MEDIA_BASE,
      GRAMMAR_MEDIA_BASE: env.GRAMMAR_MEDIA_BASE,
    }

    try {
      return await withEnv(envBag, async () =>
        withPrisma(prisma, async () => app.fetch(request, env, ctx)),
      )
    } finally {
      ctx.waitUntil(prisma.$disconnect())
    }
  },
}
