import { apiClient } from './client'

export type AiFillWordPayload = {
  word: string
  language?: 'en' | 'jp'
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

export type AiUsageSummary = {
  model: string
  days: number
  totals: {
    calls: number
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
  byDay: Array<{
    date: string
    calls: number
    totalTokens: number
  }>
  byFeature: Array<{
    feature: string
    calls: number
    totalTokens: number
  }>
  logs: Array<{
    id: string
    word: string
    language: string
    model: string
    feature: string
    totalTokens: number
    createdAt: string
  }>
}

export type AiExpressionCasualResult = {
  zhText: string
  enCasual: string
  jpCasual: string
  sceneTag: string
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
