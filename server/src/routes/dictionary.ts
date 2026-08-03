import { Hono } from 'hono'
import { lookupDictionary } from '../services/dictionaryService'
import { clearAiDictEntry, lookupLocalDict } from '../services/dictEntryService'
import type { AppEnv } from '../middleware/requireAuth'

export const dictionaryRouter = new Hono<AppEnv>()

/** 外部词典（jisho / dictionaryapi.dev）—— 搜索框的输入建议在用。 */
dictionaryRouter.get('/lookup', async (c) => {
  const term = c.req.query('term') ?? ''
  const language = c.req.query('language') ?? 'en'
  const items = await lookupDictionary(term, language as 'en' | 'jp')
  return c.json({ items })
})

/** 本地 Wiktextract 词库 + AI 缓存行的词头精确匹配。direction 省略则全方向查。 */
dictionaryRouter.get('/entries', async (c) => {
  const word = c.req.query('word') ?? ''
  const direction = c.req.query('direction')
  const entries = await lookupLocalDict(word, direction)
  return c.json({ entries })
})

/** 清除 AI 生成的缓存行（词典视图里的「清除」按钮）。direction 可选。 */
dictionaryRouter.delete('/ai-entry', async (c) => {
  const word = c.req.query('word') ?? ''
  const direction = c.req.query('direction')
  const deleted = await clearAiDictEntry(word, direction)
  return c.json({ deleted })
})
