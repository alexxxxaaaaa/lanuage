import type { Context, MiddlewareHandler } from 'hono'
import { prisma } from '../lib/prisma'
import { AppError } from '../errors/AppError'
import { isUserAdmin, verifyToken } from '../services/authService'

export type AuthedUser = {
  id: string
  username: string
  isAdmin: boolean
}

export type AppEnv = {
  Variables: {
    userId: string
    user: AuthedUser
  }
}

const BEARER_RE = /^Bearer\s+(.+)$/i

/**
 * 认证。解析 Bearer → 验签 → 回查 User 比对 tokenVersion。
 *
 * 这里不 try/catch：verifyToken 抛的就是 AppError，app.onError 上挂的
 * handleError 会把它翻成对应状态码。中间件里再抄一遍错误处理，只会多出一份要
 * 同步维护的映射。
 *
 * 每个受保护请求多一次按主键的 User 查询，换来的是 token 可撤销：改密码、删账号
 * 时 tokenVersion +1，在外的 token 立刻全废。没有这次查询，无状态 JWT 只能等它
 * 自己到期（30 天）—— 重置密码就踢不掉已经泄露的凭证。顺带把「用户已删但 token
 * 还在」这条路也堵上了。
 */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  // 幂等：app.ts 的 /api/* 守卫已经认过一遍，requireAdmin 里再串一次时直接放行，
  // 不重复查库。
  if (c.get('user')) return next()

  const header = c.req.header('authorization') ?? ''
  const match = header.match(BEARER_RE)
  if (!match) {
    throw new AppError('未登录或登录已过期', 401)
  }

  const payload = await verifyToken(match[1].trim())

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, username: true, tokenVersion: true },
  })
  if (!user || user.tokenVersion !== payload.tokenVersion) {
    throw new AppError('登录已过期，请重新登录', 401)
  }

  c.set('userId', user.id)
  c.set('user', {
    id: user.id,
    username: user.username,
    isAdmin: isUserAdmin(user.username),
  })

  await next()
}

export function getUserId(c: Context<AppEnv>): string {
  const userId = c.get('userId')
  if (!userId) {
    throw new Error('userId missing — requireAuth middleware not applied')
  }
  return userId
}
