import type { Request, Response } from 'express'
import { getTodayReviews, updateReview } from '../services/reviewService'

export async function getTodayReviewsController(
  _request: Request,
  response: Response,
) {
  const items = await getTodayReviews()

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
