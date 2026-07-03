import { apiClient } from './client'
import type { ReviewItem, ReviewRating } from '../types'

type ReviewTodayResponse = {
  count: number
  items: ReviewItem[]
}

type TodayLearnedStatsResponse = {
  en: number
  jp: number
  total: number
}

type TomorrowReviewStatsResponse = {
  en: number
  jp: number
  total: number
}

export async function getTodayReviews(params?: { folderId?: string }) {
  const response = await apiClient.get<ReviewTodayResponse>('/api/review/today', {
    params,
  })
  return response.data
}

export async function submitReviewResult(payload: {
  wordId: string
  rating: ReviewRating
}) {
  const response = await apiClient.post<ReviewItem>('/api/review/update', payload)
  return response.data
}

// Snapshot captured right BEFORE a rating is submitted, so the server can
// rewind FSRS state to this point and re-apply a corrected rating when the
// user fixes a misclick at session-done.
export type ReviewSnapshot = {
  interval: number
  repetition: number
  easeFactor: number
  difficultyScore: number
  recentRatings: string
  firstLearnedAt: string | null
  lastReviewedAt: string | null
}

export async function correctReviewResult(payload: {
  wordId: string
  snapshot: ReviewSnapshot
  newRating: 'hard' | 'easy'
}) {
  const response = await apiClient.post<ReviewItem>('/api/review/correct', payload)
  return response.data
}

export async function markWordMastered(wordId: string) {
  const response = await apiClient.post<ReviewItem>('/api/review/mark-mastered', {
    wordId,
  })
  return response.data
}

export async function getTodayLearnedStats() {
  const response = await apiClient.get<TodayLearnedStatsResponse>('/api/review/today-learned')
  return response.data
}

export async function getTomorrowReviewStats() {
  const response = await apiClient.get<TomorrowReviewStatsResponse>('/api/review/tomorrow')
  return response.data
}
