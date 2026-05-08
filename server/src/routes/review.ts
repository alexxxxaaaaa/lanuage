import { Router } from 'express'
import {
  getTomorrowReviewStatsController,
  getTodayLearnedStatsController,
  getTodayReviewsController,
  updateReviewController,
} from '../controllers/reviewController'

export const reviewRouter = Router()

reviewRouter.get('/today', getTodayReviewsController)
reviewRouter.get('/today-learned', getTodayLearnedStatsController)
reviewRouter.get('/tomorrow', getTomorrowReviewStatsController)
reviewRouter.post('/update', updateReviewController)
