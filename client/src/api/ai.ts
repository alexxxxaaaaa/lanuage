import { apiClient } from './client'

export type AiFillWordPayload = {
  word: string
  /** What language the user typed in. `zh` enables translation mode. */
  sourceLanguage: 'en' | 'jp' | 'zh'
  /** Only meaningful when sourceLanguage='zh' — what to translate INTO. */
  targetLanguage?: 'en' | 'jp'
  extended?: boolean
  /** 已有 AI 缓存时强制重新生成（「重新生成」按钮）。 */
  refresh?: boolean
  /**
   * 日语活用形是否直接校准到辞書形，默认 true（加词页、批量加词走这个 ——
   * 词单里该存辞書形）。查词页传 false：那边在结果第一行给建议，改不改由
   * 用户点，输入的词不背着人换掉。
   */
  normalize?: boolean
  /**
   * 划词加词时选中文本所在的整句。传了它服务端切到语境模式：还原原形、
   * 按句中义项给释义、翻译整句，且不再生成自造例句。
   */
  context?: string
}

export type AiFillWordResult = {
  word: string
  language: 'en' | 'jp'
  reading: string
  partOfSpeech: string
  meaning: string
  example: string
  note: string
  /** true = 命中服务端 DictEntry 缓存，没烧 token。 */
  cached: boolean
  /**
   * 辞書形/原形。词头真被换掉时才有值（「食べました」→「食べる」）：划词加词的
   * 语境模式，以及 normalize 生效的手输查词。此时 word 已经等于它，留着这个
   * 字段是为了让 UI 能提示「已还原为原形」。
   */
  baseForm?: string
  /** 语境句的中文翻译，只有语境模式带值。 */
  sentenceZh?: string
}

/**
 * Only the fields the UI reads. `/api/ai/usage` also returns per-day,
 * per-feature and per-call breakdowns; the dashboard shows totals alone, so
 * they are deliberately left off the type rather than typed-and-unused.
 */
export type AiUsageSummary = {
  model: string
  /**
   * List price of `model` in USD per 1M tokens, or null when the server holds
   * no price for it. The bill itself is computed server-side — this is here so
   * the card can show the rate it was charged at, not to multiply by.
   */
  rates: {
    input: number
    cachedInput: number
    cacheWrite: number
    output: number
  } | null
  days: number
  totals: {
    calls: number
    /** The whole prompt; `cachedTokens` is a subset of it, not an extra. */
    promptTokens: number
    cachedTokens: number
    completionTokens: number
    costUsd: number
    /** Calls on a model with no price on file — excluded from `costUsd`. */
    unpricedCalls: number
  }
}

export type AiExpressionCasualResult = {
  zhText: string
  enCasual: string
  jpCasual: string
  sceneTag: string
}

export type AiFillGrammarResult = {
  pattern: string
  connection: string
  meaning: string
  example: string
  exampleZh: string
  note: string
}

export async function fillGrammarByAi(pattern: string) {
  const response = await apiClient.post<AiFillGrammarResult>('/api/ai/fill-grammar', {
    pattern,
  })
  return response.data
}

export async function fillWordByAi(payload: AiFillWordPayload) {
  const response = await apiClient.post<AiFillWordResult>('/api/ai/fill-word', payload)
  return response.data
}

export async function getAiUsage(days = 7) {
  const response = await apiClient.get<AiUsageSummary>('/api/ai/usage', {
    params: { days },
  })
  return response.data
}

export async function generateExpressionCasual(payload: {
  zhText: string
  language?: 'en' | 'jp'
}) {
  const response = await apiClient.post<AiExpressionCasualResult>(
    '/api/ai/expression-casual',
    payload,
  )
  return response.data
}

export type AiExpressionTranslateResult = {
  zhText: string
  sceneTag: string
}

export async function translateExpressionToZh(payload: {
  text: string
  language: 'en' | 'jp'
}) {
  const response = await apiClient.post<AiExpressionTranslateResult>(
    '/api/ai/expression-translate-zh',
    payload,
  )
  return response.data
}
