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

  console.error(error)

  return response.status(500).json({
    message: 'Internal server error',
  })
}
