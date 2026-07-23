import { Hono } from 'hono'
import { getWeeklyReview } from '../services/weeklyReviewService'
import { getUserId, type AppEnv } from '../middleware/requireAuth'

export const weeklyReviewRouter = new Hono<AppEnv>()

/** GET /api/weekly-review — trailing-7-day analytics for the current user.
 *  Read-only aggregation over ReviewEvent + firstLearnedAt + Podcast.updatedAt.
 *  Serves the "Friday recap" UI on the home page. */
weeklyReviewRouter.get('/', async (c) => {
  const summary = await getWeeklyReview(getUserId(c))
  return c.json(summary)
})
