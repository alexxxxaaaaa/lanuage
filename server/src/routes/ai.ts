import { Router } from 'express'
import {
  fillWordByAiController,
  generateExpressionCasualController,
  generateWordQuizController,
  getAiUsageController,
  translateExpressionToZhController,
} from '../controllers/aiController'

export const aiRouter = Router()

aiRouter.post('/fill-word', fillWordByAiController)
aiRouter.post('/quiz-word', generateWordQuizController)
aiRouter.post('/expression-casual', generateExpressionCasualController)
aiRouter.post('/expression-translate-zh', translateExpressionToZhController)
aiRouter.get('/usage', getAiUsageController)
