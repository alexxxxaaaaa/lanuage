import type { NextFunction, Request, Response } from 'express'
import { AppError } from '../errors/AppError'

export function errorHandler(
  error: unknown,
  _request: Request,
  response: Response,
  _next: NextFunction,
) {
  if (error instanceof AppError) {
    return response.status(error.statusCode).json({
      message: error.message,
    })
  }

  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = String((error as { code?: unknown }).code ?? '')
    const meta =
      'meta' in error && typeof (error as { meta?: unknown }).meta === 'object'
        ? ((error as { meta?: Record<string, unknown> }).meta ?? {})
        : {}

    if (code === 'P2000') {
      const field = typeof meta.column_name === 'string' ? meta.column_name : 'field'
      return response.status(400).json({
        message: `字段内容过长，请缩短后重试（${field}）`,
      })
    }
    if (code === 'P2002') {
      return response.status(409).json({
        message: '数据重复，请检查后重试',
      })
    }
    if (code === 'P2003') {
      return response.status(400).json({
        message: '关联数据无效，请检查分类或来源笔记',
      })
    }
  }

  console.error(error)

  return response.status(500).json({
    message: 'Internal server error',
  })
}
