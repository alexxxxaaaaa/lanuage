import type { Context, MiddlewareHandler } from 'hono'
import { verifyToken } from '../services/authService'

export type AppEnv = {
  Variables: {
    userId: string
  }
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header('authorization') ?? c.req.header('Authorization') ?? ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match) {
    return c.json({ message: '未登录或登录已过期' }, 401)
  }

  try {
    const payload = await verifyToken(match[1].trim())
    c.set('userId', payload.sub)
    await next()
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
}

export function getUserId(c: Context<AppEnv>): string {
  const userId = c.get('userId')
  if (!userId) {
    throw new Error('userId missing — requireAuth middleware not applied')
  }
  return userId
}
