import type { MiddlewareHandler } from 'hono'
import { prisma } from '../lib/prisma'
import { isUserAdmin, verifyToken } from '../services/authService'
import type { AppEnv } from './requireAuth'

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header('authorization') ?? c.req.header('Authorization') ?? ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match) {
    return c.json({ message: '未登录或登录已过期' }, 401)
  }

  let userId = ''
  try {
    const payload = await verifyToken(match[1].trim())
    userId = payload.sub
  } catch (error) {
    const status =
      error && typeof error === 'object' && 'statusCode' in error
        ? Number((error as { statusCode?: unknown }).statusCode) || 401
        : 401
    const message =
      error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message ?? '未登录或登录已过期')
        : '未登录或登录已过期'
    return c.json({ message }, status as 401 | 500)
  }

  c.set('userId', userId)

  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) {
    return c.json({ message: '用户不存在' }, 401)
  }

  if (!isUserAdmin(user.username)) {
    return c.json({ message: '无管理员权限' }, 403)
  }

  await next()
}
