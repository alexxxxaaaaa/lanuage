import type { Request, Response } from 'express'
import {
  getTomorrowReviewStats,
  getTodayLearnedStats,
  getTodayReviews,
  updateReview,
} from '../services/reviewService'

export async function getTodayReviewsController(request: Request, response: Response) {
  const folderId =
    typeof request.query.folderId === 'string' ? request.query.folderId : undefined

  const items = await getTodayReviews(folderId)

  return response.json({
    count: items.length,
    items,
  })
}

export async function updateReviewController(request: Request, response: Response) {
  const { wordId, rating } = request.body as {
    wordId?: string
    rating?: string
  }

  const review = await updateReview(wordId ?? '', rating ?? '')

  return response.json(review)
}

export async function getTodayLearnedStatsController(
  _request: Request,
  response: Response,
) {
  const stats = await getTodayLearnedStats()
  return response.json(stats)
}

export async function getTomorrowReviewStatsController(
  _request: Request,
  response: Response,
) {
  const stats = await getTomorrowReviewStats()
  return response.json(stats)
}
