import { apiClient } from './client'
import type { ReviewItem, ReviewRating } from '../types'

type ReviewTodayResponse = {
  count: number
  items: ReviewItem[]
}

export async function getTodayReviews() {
  const response = await apiClient.get<ReviewTodayResponse>('/api/review/today')
  return response.data
}

export async function submitReviewResult(payload: {
  wordId: string
  rating: ReviewRating
}) {
  const response = await apiClient.post<ReviewItem>('/api/review/update', payload)
  return response.data
}
