import { Hono } from 'hono'
import {
  fillWordByAi,
  fillWordByAiAuto,
  generateExpressionCasualByAi,
  generateWordQuizByAi,
  getAiUsageSummary,
  translateExpressionToZhByAi,
} from '../services/aiService'
import { getUserId, type AppEnv } from '../middleware/requireAuth'

export const aiRouter = new Hono<AppEnv>()

aiRouter.post('/fill-word', async (c) => {
  const { word, language, extended } = await c.req.json<{
    word?: string
    language?: 'en' | 'jp'
    extended?: boolean
  }>()
  const userId = getUserId(c)
  const result =
    language === 'en' || language === 'jp'
      ? await fillWordByAi({ word: word ?? '', language, extended: !!extended, userId })
      : await fillWordByAiAuto(userId, word ?? '', !!extended)
  return c.json(result)
})

aiRouter.post('/quiz-word', async (c) => {
  const body = await c.req.json<{
    word?: string
    reading?: string
    meaning?: string
    example?: string
    language?: 'en' | 'jp'
  }>()
  const result = await generateWordQuizByAi({
    word: body.word ?? '',
    reading: body.reading ?? '',
    meaning: body.meaning ?? '',
    example: body.example ?? '',
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
