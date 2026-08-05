import { Hono } from 'hono'
import { getUserById, login } from '../services/authService'
import { throttleKeyFromHeaders } from '../services/loginThrottle'
import { getUserId, type AppEnv } from '../middleware/requireAuth'

export const authRouter = new Hono<AppEnv>()

// 没有 /register：建号只走管理后台的 POST /api/admin/users。
authRouter.post('/login', async (c) => {
  const { username, password } = await c.req.json<{
    username?: string
    password?: string
  }>()
  const throttleKey = throttleKeyFromHeaders((name) => c.req.header(name))
  const result = await login(username ?? '', password ?? '', throttleKey)
  return c.json(result)
})

// 鉴权由 app.ts 的 /api/* 守卫统一做，这里不用再挂一次。
authRouter.get('/me', async (c) => c.json(await getUserById(getUserId(c))))
