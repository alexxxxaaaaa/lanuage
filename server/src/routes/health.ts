import { Router } from 'express'

export const healthRouter = Router()

healthRouter.get('/', (_request, response) => {
  response.json({
    message: 'Server is running',
    timestamp: new Date().toISOString(),
  })
})
