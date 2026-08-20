import { Hono } from 'hono'
import {
  fillGrammarByAi,
  fillWordByAi,
  generateExampleOnlyByAi,
  generateExpressionCasualByAi,
  getAiUsageSummary,
} from '../services/aiService'
import { chatWithAi, titleForChat } from '../services/aiChatService'
import { analyzeText, explainWordInSentence } from '../services/textAnalyzeService'
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
  const body = await c.req.json<{
    zhText?: string
    language?: 'en' | 'jp'
    sceneTags?: string[]
    polish?: boolean
    explain?: boolean
  }>()
  const result = await generateExpressionCasualByAi({
    zhText: body.zhText ?? '',
    language: body.language === 'jp' ? 'jp' : 'en',
    sceneTags: body.sceneTags,
    polish: body.polish,
    explain: body.explain,
    userId: getUserId(c),
  })
  return c.json(result)
})

/** 文解析：整段日文 → 逐句逐词 + 整句中文翻译。 */
aiRouter.post('/analyze-text', async (c) => {
  const { text } = await c.req.json<{ text?: string }>()
  const result = await analyzeText({ text: text ?? '', userId: getUserId(c) })
  return c.json(result)
})

/** 文解析：点开某个词，按它所在的整句给读音 / 辞書形 / 语法详解。 */
aiRouter.post('/analyze-word', async (c) => {
  const body = await c.req.json<{
    word?: string
    pos?: string
    kana?: string
    base?: string
    sentence?: string
  }>()
  const result = await explainWordInSentence({
    word: body.word ?? '',
    pos: body.pos,
    kana: body.kana,
    base: body.base,
    sentence: body.sentence ?? '',
    userId: getUserId(c),
  })
  return c.json(result)
})

/**
 * 询问 AI：多轮自由问答。会话存在浏览器，所以历史每次整份带上来，
 * 校验和截断都在 aiChatService 里。
 */
aiRouter.post('/chat', async (c) => {
  const body = await c.req.json<{ messages?: unknown; language?: unknown }>()
  const result = await chatWithAi({
    messages: body.messages,
    language: body.language,
    userId: getUserId(c),
  })
  return c.json(result)
})

/** 「生成笔记」时给这段对话起标题；笔记本身走 /api/notes。 */
aiRouter.post('/chat-title', async (c) => {
  const body = await c.req.json<{ messages?: unknown; language?: unknown }>()
  const result = await titleForChat({
    messages: body.messages,
    language: body.language,
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
