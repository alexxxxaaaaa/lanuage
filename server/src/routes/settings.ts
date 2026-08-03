import { Hono } from 'hono'
import { getSettings, updateSettings } from '../services/settingsService'
import { getUserId, type AppEnv } from '../middleware/requireAuth'

export const settingsRouter = new Hono<AppEnv>()

settingsRouter.get('/', async (c) => {
  return c.json(await getSettings(getUserId(c)))
})

settingsRouter.patch('/', async (c) => {
  const body = await c.req.json<Record<string, unknown>>()
  const settings = await updateSettings(getUserId(c), body ?? {})
  return c.json(settings)
})
