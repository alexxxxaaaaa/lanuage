import { apiClient } from './client'

export type WeeklyReviewSummary = {
  windowStart: string
  windowEnd: string
  words: {
    learned: number
    reviewed: number
    correct: number
    correctRate: number
  }
  grammars: {
    learned: number
    reviewed: number
    correct: number
    correctRate: number
  }
  podcasts: {
    touched: number
    titles: string[]
  }
  perDay: Array<{
    date: string
    wordEvents: number
    grammarEvents: number
  }>
}

export async function getWeeklyReview() {
  const r = await apiClient.get<WeeklyReviewSummary>('/api/weekly-review')
  return r.data
}
