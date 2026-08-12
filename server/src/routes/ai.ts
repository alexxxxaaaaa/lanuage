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
  const {
    word,
    sourceLanguage,
    targetLanguage,
    extended,
    refresh,
    context,
    normalize,
  } = await c.req.json<{
    word?: string
    sourceLanguage?: 'en' | 'jp' | 'zh'
    targetLanguage?: 'en' | 'jp'
    extended?: boolean
    refresh?: boolean
    context?: string
    normalize?: boolean
  }>()
  if (
    sourceLanguage !== 'zh' &&
    sourceLanguage !== 'en' &&
    sourceLanguage !== 'jp'
  ) {
    throw new AppError('sourceLanguage must be en, jp, or zh', 400)
  }
  // 整句进 prompt，所以要拦长度：字幕行正常几十字，超长的多半是前端选错了
  // 节点（比如把整段 transcript 传上来），截断比让它烧 token 好。
  const trimmedContext = (context ?? '').trim().slice(0, 300)
  const result = await fillWordByAi({
    word: word ?? '',
    sourceLanguage,
    targetLanguage,
    extended: !!extended,
    refresh: !!refresh,
    // 只有显式传 false 才关掉辞書形校准（查词页那条路），漏传一律按开处理。
    normalize: normalize !== false,
    ...(trimmedContext ? { context: trimmedContext } : {}),
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
