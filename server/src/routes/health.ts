import { Hono } from 'hono'

export const healthRouter = new Hono()

healthRouter.get('/', (c) =>
  c.json({
    message: 'Server is running',
    timestamp: new Date().toISOString(),
  }),
)
