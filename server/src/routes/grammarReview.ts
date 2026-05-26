import { Hono } from 'hono'
import {
  getGrammarReviewCounts,
  getTodayGrammarReviews,
  getUnlearnedGrammars,
  initGrammarReview,
  submitGrammarReview,
} from '../services/grammarReviewService'
import { getUserId, type AppEnv } from '../middleware/requireAuth'

export const grammarReviewRouter = new Hono<AppEnv>()

grammarReviewRouter.get('/today', async (c) => {
  const items = await getTodayGrammarReviews(getUserId(c))
  return c.json({ count: items.length, items })
})

grammarReviewRouter.get('/unlearned', async (c) => {
  const items = await getUnlearnedGrammars(getUserId(c))
  return c.json({ count: items.length, items })
})

grammarReviewRouter.get('/counts', async (c) => {
  const counts = await getGrammarReviewCounts(getUserId(c))
  return c.json(counts)
})

grammarReviewRouter.post('/update', async (c) => {
  const { grammarId, rating } = await c.req.json<{
    grammarId?: string
    rating?: string
  }>()
  const review = await submitGrammarReview(
    getUserId(c),
    grammarId ?? '',
    rating ?? '',
  )
  return c.json(review)
})

grammarReviewRouter.post('/init', async (c) => {
  const { grammarId, rating } = await c.req.json<{
    grammarId?: string
    rating?: string
  }>()
  const review = await initGrammarReview(
    getUserId(c),
    grammarId ?? '',
    rating ?? '',
  )
  return c.json(review)
})
