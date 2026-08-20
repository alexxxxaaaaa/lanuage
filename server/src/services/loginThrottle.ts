/**
 * 登录限流。按来源 IP 计数，连错 MAX_FAILURES 次锁 LOCK_MINUTES 分钟。
 *
 * 为什么按 IP 而不是按账号：按账号锁等于把「锁死别人的号」这件事白送给攻击者，
 * 随便找个用户名连错 8 次就能让本人登不进来。按 IP 没有这个副作用，代价是分布式
 * 来源拦不住 —— 但那个量级的攻击本来就该在 Cloudflare 的 WAF 那层挡。
 *
 * 成本上只有失败才写库：登录成功的路径是一次读（下面的 check），命中空行就结束。
 */
import { prisma } from '../lib/prisma'
import { AppError } from '../errors/AppError'

const MAX_FAILURES = 8
/** 计数窗口：距首次失败超过这个时长就重新计数，免得零星错几次也攒成封禁。 */
const WINDOW_MS = 15 * 60 * 1000
const LOCK_MS = 15 * 60 * 1000

export type ThrottleState = {
  key: string
  /** check 时读到的行，成功登录后拿它判断要不要发清零的那次写。 */
  hadRecord: boolean
}

/**
 * 取限流用的 key。Workers 上 `CF-Connecting-IP` 由平台注入、伪造不了；本地 Node
 * 直连没有这个头，此时返回 null = 不限流，否则本地调试连错几次就把自己关在门外。
 */
export function throttleKeyFromHeaders(headerLookup: (name: string) => string | undefined): string | null {
  const ip = headerLookup('cf-connecting-ip')?.trim()
  return ip ? `ip:${ip}` : null
}

/** 登录前调。已被锁就抛 429，否则返回状态给后面的 record/clear 用。 */
export async function checkThrottle(key: string | null): Promise<ThrottleState | null> {
  if (!key) return null

  const row = await prisma.loginThrottle.findUnique({ where: { key } })
  if (!row) return { key, hadRecord: false }

  if (row.lockedUntil && row.lockedUntil.getTime() > Date.now()) {
    const minutes = Math.ceil((row.lockedUntil.getTime() - Date.now()) / 60_000)
    throw new AppError(`登录失败次数过多，请在 ${minutes} 分钟后重试`, 429)
  }

  return { key, hadRecord: true }
}

/** 密码验错时调。 */
export async function recordFailure(state: ThrottleState | null): Promise<void> {
  if (!state) return

  const now = new Date()
  const row = await prisma.loginThrottle.findUnique({ where: { key: state.key } })

  // 没有行、或者窗口已经过期（含上一轮封禁早已解除的情况）：从 1 开始重新计数。
  const windowExpired = !row || now.getTime() - row.firstFailAt.getTime() > WINDOW_MS
  const failures = windowExpired ? 1 : row.failures + 1
  const data = {
    failures,
    firstFailAt: windowExpired ? now : row.firstFailAt,
    lockedUntil: failures >= MAX_FAILURES ? new Date(now.getTime() + LOCK_MS) : null,
  }

  await prisma.loginThrottle.upsert({
    where: { key: state.key },
    create: { key: state.key, ...data },
    update: data,
  })
}

/** 登录成功时调。之前没失败过就不发这次写。 */
export async function clearFailures(state: ThrottleState | null): Promise<void> {
  if (!state?.hadRecord) return
  await prisma.loginThrottle.deleteMany({ where: { key: state.key } })
}
