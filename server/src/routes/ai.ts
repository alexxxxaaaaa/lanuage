import { Hono } from 'hono'
import {
  fillGrammarByAi,
  fillWordByAi,
  fillWordByAiAuto,
  generateExampleOnlyByAi,
  generateExpressionCasualByAi,
  generateWordQuizByAi,
  getAiUsageSummary,
  translateExpressionToZhByAi,
} from '../services/aiService'
import { getUserId, type AppEnv } from '../middleware/requireAuth'

export const aiRouter = new Hono<AppEnv>()

aiRouter.post('/fill-word', async (c) => {
  const { word, language, sourceLanguage, targetLanguage, extended } =
    await c.req.json<{
      word?: string
      language?: 'en' | 'jp'
      sourceLanguage?: 'en' | 'jp' | 'zh'
      targetLanguage?: 'en' | 'jp'
      extended?: boolean
    }>()
  const userId = getUserId(c)
  // sourceLanguage is the new contract; fall back to the legacy `language`
  // field so existing callers (e.g. fillExamplesInFolder script) keep working.
  const source = sourceLanguage ?? language
  if (source === 'zh' || source === 'en' || source === 'jp') {
    const result = await fillWordByAi({
      word: word ?? '',
      // Legacy field; for zh source we still need *some* SupportedLanguage —
      // use the target (or jp default) so the param check passes.
      language: source === 'zh' ? targetLanguage ?? 'jp' : source,
      sourceLanguage: source,
      targetLanguage,
      extended: !!extended,
      userId,
    })
    return c.json(result)
  }
  const result = await fillWordByAiAuto(userId, word ?? '', !!extended)
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
