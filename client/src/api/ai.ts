import { apiClient } from './client'

export type AiFillWordPayload = {
  word: string
  /** Legacy: kept for backwards compatibility with existing callers. */
  language?: 'en' | 'jp'
  /** What language the user typed in. `zh` enables translation mode. */
  sourceLanguage?: 'en' | 'jp' | 'zh'
  /** Only meaningful when sourceLanguage='zh' — what to translate INTO. */
  targetLanguage?: 'en' | 'jp'
  extended?: boolean
}

export type AiFillWordResult = {
  word: string
  language: 'en' | 'jp'
  reading: string
  partOfSpeech: string
  meaning: string
  example: string
  note: string
}

export type AiQuizResult = {
  question: string
  options: string[]
  answerIndex: number
  explanation: string
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

export async function generateWordQuiz(payload: {
  word: string
  reading: string
  meaning: string
  example: string
  language: 'en' | 'jp'
}) {
  const response = await apiClient.post<AiQuizResult>('/api/ai/quiz-word', payload)
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
