import { every } from 'hono/combine'
import type { MiddlewareHandler } from 'hono'
import { AppError } from '../errors/AppError'
import { requireAuth, type AppEnv } from './requireAuth'

/**
 * 管理员。认证部分完全复用 requireAuth —— 之前这里抄了一份 Bearer 解析和错误
 * 处理，两份逻辑各自演化就是权限漏洞的常见来源。
 *
 * 管理员身份来自 requireAuth 已经查回来的那一行 User，不再单独查库。
 */
const adminOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!c.get('user').isAdmin) {
    throw new AppError('无管理员权限', 403)
  }
  await next()
}

export const requireAdmin = every(requireAuth, adminOnly)
