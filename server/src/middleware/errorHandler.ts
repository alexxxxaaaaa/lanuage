import type { Context } from 'hono'
import { AppError } from '../errors/AppError'

export function handleError(error: unknown, c: Context) {
  if (error instanceof AppError) {
    return c.json({ message: error.message }, error.statusCode as 400 | 401 | 404 | 409 | 500)
  }

  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = String((error as { code?: unknown }).code ?? '')
    const meta =
      'meta' in error && typeof (error as { meta?: unknown }).meta === 'object'
        ? ((error as { meta?: Record<string, unknown> }).meta ?? {})
        : {}

    if (code === 'P2000') {
      const field = typeof meta.column_name === 'string' ? meta.column_name : 'field'
      return c.json({ message: `字段内容过长，请缩短后重试（${field}）` }, 400)
    }
    if (code === 'P2002') {
      return c.json({ message: '数据重复，请检查后重试' }, 409)
    }
    if (code === 'P2003') {
      return c.json({ message: '关联数据无效，请检查分类或来源笔记' }, 400)
    }
  }

  console.error(error)
  return c.json({ message: 'Internal server error' }, 500)
}
