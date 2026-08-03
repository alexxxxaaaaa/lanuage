import { Hono } from 'hono'
import {
  fillGrammarByAi,
  fillWordByAi,
  generateExampleOnlyByAi,
  generateExpressionCasualByAi,
  getAiUsageSummary,
  translateExpressionToZhByAi,
} from '../services/aiService'
import { AppError } from '../errors/AppError'
import { getUserId, type AppEnv } from '../middleware/requireAuth'

export const aiRouter = new Hono<AppEnv>()

aiRouter.post('/fill-word', async (c) => {
  const { word, sourceLanguage, targetLanguage, extended, refresh } =
    await c.req.json<{
      word?: string
      sourceLanguage?: 'en' | 'jp' | 'zh'
      targetLanguage?: 'en' | 'jp'
      extended?: boolean
      refresh?: boolean
    }>()
  if (
    sourceLanguage !== 'zh' &&
    sourceLanguage !== 'en' &&
    sourceLanguage !== 'jp'
  ) {
    throw new AppError('sourceLanguage must be en, jp, or zh', 400)
  }
  const result = await fillWordByAi({
    word: word ?? '',
    sourceLanguage,
    targetLanguage,
    extended: !!extended,
    refresh: !!refresh,
    userId: getUserId(c),
  })
  return c.json(result)
})

aiRouter.post('/fill-grammar', async (c) => {
  const { pattern } = await c.req.json<{ pattern?: string }>()
  const result = await fillGrammarByAi({
    pattern: pattern ?? '',
    userId: getUserId(c),
  })
  return c.json(result)
})

aiRouter.post('/example-only', async (c) => {
  const body = await c.req.json<{
    word?: string
    reading?: string
    meaning?: string
    language?: 'en' | 'jp'
  }>()
  const result = await generateExampleOnlyByAi({
    word: body.word ?? '',
    reading: body.reading,
    meaning: body.meaning,
    language: body.language === 'jp' ? 'jp' : 'en',
    userId: getUserId(c),
  })
  return c.json(result)
})

aiRouter.post('/expression-casual', async (c) => {
  const { zhText, language } = await c.req.json<{
    zhText?: string
    language?: 'en' | 'jp'
  }>()
  const result = await generateExpressionCasualByAi({
    zhText: zhText ?? '',
    language: language === 'jp' ? 'jp' : language === 'en' ? 'en' : undefined,
    userId: getUserId(c),
  })
  return c.json(result)
})

aiRouter.post('/expression-translate-zh', async (c) => {
  const { text, language } = await c.req.json<{
    text?: string
    language?: 'en' | 'jp'
  }>()
  const result = await translateExpressionToZhByAi({
    text: text ?? '',
    language: language === 'jp' ? 'jp' : 'en',
    userId: getUserId(c),
  })
  return c.json(result)
})

aiRouter.get('/usage', async (c) => {
  const daysRaw = c.req.query('days')
  const days = daysRaw ? Number(daysRaw) : 7
  const result = await getAiUsageSummary(getUserId(c), days)
  return c.json(result)
})
