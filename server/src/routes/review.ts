import { Hono } from 'hono'
import {
  correctReview,
  getTomorrowReviewStats,
  getTodayLearnedStats,
  getTodayReviews,
  markWordMastered,
  updateReview,
} from '../services/reviewService'
import { getUserId, type AppEnv } from '../middleware/requireAuth'

export const reviewRouter = new Hono<AppEnv>()

reviewRouter.get('/today', async (c) => {
  const folderId = c.req.query('folderId')
  const items = await getTodayReviews(getUserId(c), folderId)
  return c.json({ count: items.length, items })
})

reviewRouter.get('/today-learned', async (c) => {
  const stats = await getTodayLearnedStats(getUserId(c))
  return c.json(stats)
})

reviewRouter.get('/tomorrow', async (c) => {
  const stats = await getTomorrowReviewStats(getUserId(c))
  return c.json(stats)
})

reviewRouter.post('/update', async (c) => {
  const { wordId, rating } = await c.req.json<{
    wordId?: string
    rating?: string
  }>()
  const review = await updateReview(getUserId(c), wordId ?? '', rating ?? '')
  return c.json(review)
})

reviewRouter.post('/correct', async (c) => {
  const body = await c.req.json<{
    wordId?: string
    snapshot?: {
      interval?: number
      repetition?: number
      easeFactor?: number
      difficultyScore?: number
      recentRatings?: string
      firstLearnedAt?: string | null
      lastReviewedAt?: string | null
    }
    newRating?: string
  }>()
  const snap = body.snapshot ?? {}
  const review = await correctReview(
    getUserId(c),
    body.wordId ?? '',
    {
      interval: snap.interval ?? 1,
      repetition: snap.repetition ?? 0,
      easeFactor: snap.easeFactor ?? 2.5,
      difficultyScore: snap.difficultyScore ?? 0,
      recentRatings: snap.recentRatings ?? '',
      firstLearnedAt: snap.firstLearnedAt ? new Date(snap.firstLearnedAt) : null,
      lastReviewedAt: snap.lastReviewedAt ? new Date(snap.lastReviewedAt) : null,
    },
    body.newRating ?? '',
  )
  return c.json(review)
})

reviewRouter.post('/mark-mastered', async (c) => {
  const { wordId } = await c.req.json<{ wordId?: string }>()
  const review = await markWordMastered(getUserId(c), wordId ?? '')
  return c.json(review)
})
