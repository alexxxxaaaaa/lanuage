import { Hono } from 'hono'
import { lookupDictionary } from '../services/dictionaryService'
import {
  backfillAiDictFromWords,
  clearAiDictEntry,
  lookupLocalDict,
} from '../services/dictEntryService'
import { getUserId, type AppEnv } from '../middleware/requireAuth'

export const dictionaryRouter = new Hono<AppEnv>()

/** 外部词典（jisho / dictionaryapi.dev）—— 搜索框的输入建议在用。 */
dictionaryRouter.get('/lookup', async (c) => {
  const term = c.req.query('term') ?? ''
  const language = c.req.query('language') ?? 'en'
  const items = await lookupDictionary(term, language as 'en' | 'jp')
  return c.json({ items })
})

/**
 * 本地 Wiktextract 词库 + AI 缓存行的词头精确匹配。direction 省略则全方向查。
 * 日语活用形（「食べました」）查不到时随结果带回辞書形建议，见 baseForm。
 */
dictionaryRouter.get('/entries', async (c) => {
  const word = c.req.query('word') ?? ''
  const direction = c.req.query('direction')
  const { entries, baseForm } = await lookupLocalDict(word, direction)
  return c.json({ entries, baseForm })
})

/** 清除 AI 生成的缓存行（词典视图里的「清除」按钮）。direction 可选。 */
dictionaryRouter.delete('/ai-entry', async (c) => {
  const word = c.req.query('word') ?? ''
  const direction = c.req.query('direction')
  const deleted = await clearAiDictEntry(word, direction)
  return c.json({ deleted })
})

/** 一次性回填：把我的单词库里已有内容的词补进 AI 词典缓存（老数据迁移用，幂等）。 */
dictionaryRouter.post('/ai-backfill', async (c) => {
  const result = await backfillAiDictFromWords(getUserId(c))
  return c.json(result)
})
