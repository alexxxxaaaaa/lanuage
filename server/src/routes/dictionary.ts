import { Hono } from 'hono'
import { lookupDictionary } from '../services/dictionaryService'
import type { AppEnv } from '../middleware/requireAuth'

export const dictionaryRouter = new Hono<AppEnv>()

dictionaryRouter.get('/lookup', async (c) => {
  const term = c.req.query('term') ?? ''
  const language = c.req.query('language') ?? 'en'
  const items = await lookupDictionary(term, language as 'en' | 'jp')
  return c.json({ items })
})
