import { Router } from 'express'
import {
  getTodayReviewsController,
  updateReviewController,
} from '../controllers/reviewController'

export const reviewRouter = Router()

reviewRouter.get('/today', getTodayReviewsController)
reviewRouter.post('/update', updateReviewController)
