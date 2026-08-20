import { apiClient } from './client'
import type { Grammar, GrammarReviewItem, ReviewRating } from '../types'

type TodayResponse = { count: number; items: GrammarReviewItem[] }
type UnlearnedResponse = { count: number; items: Grammar[] }
type CountsResponse = { due: number; unlearned: number }

export async function getTodayGrammarReviews() {
  const response = await apiClient.get<TodayResponse>('/api/grammar-reviews/today')
  return response.data
}

export async function getUnlearnedGrammars(level?: string) {
  const response = await apiClient.get<UnlearnedResponse>(
    '/api/grammar-reviews/unlearned',
    { params: level ? { level } : undefined },
  )
  return response.data
}

export async function getGrammarReviewCounts() {
  const response = await apiClient.get<CountsResponse>(
    '/api/grammar-reviews/counts',
  )
  return response.data
}

export async function submitGrammarReviewResult(payload: {
  grammarId: string
  rating: ReviewRating
}) {
  const response = await apiClient.post<GrammarReviewItem>(
    '/api/grammar-reviews/update',
    payload,
  )
  return response.data
}

export async function initGrammarReview(payload: {
  grammarId: string
  rating: ReviewRating
}) {
  const response = await apiClient.post<GrammarReviewItem>(
    '/api/grammar-reviews/init',
    payload,
  )
  return response.data
}
