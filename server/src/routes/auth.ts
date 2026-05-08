import { Hono } from 'hono'
import { getUserById, login, register } from '../services/authService'
import { requireAuth, type AppEnv } from '../middleware/requireAuth'

export const authRouter = new Hono<AppEnv>()

authRouter.post('/register', async (c) => {
  const { username, password } = await c.req.json<{
    username?: string
    password?: string
  }>()
  const result = await register(username ?? '', password ?? '')
  return c.json(result, 201)
})

authRouter.post('/login', async (c) => {
  const { username, password } = await c.req.json<{
    username?: string
    password?: string
  }>()
  const result = await login(username ?? '', password ?? '')
  return c.json(result)
})

authRouter.get('/me', requireAuth, async (c) => {
  const userId = c.get('userId')
  const user = await getUserById(userId)
  return c.json(user)
})
