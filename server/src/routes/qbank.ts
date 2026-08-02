import { Hono } from 'hono'
import {
  MAX_QUESTION_IDS,
  clearAttempts,
  getOverview,
  getQuestions,
  getSet,
  parseSetFilter,
  setFavorite,
  submitAttempt,
} from '../services/qbankService'
import { getUserId, type AppEnv } from '../middleware/requireAuth'

export const qbankRouter = new Hono<AppEnv>()

/** 目录树：每个題型/年份的题量 + 本人已做/做对数，外加收藏和错题的总数。 */
qbankRouter.get('/overview', async (c) => {
  const level = c.req.query('level') || 'N1'
  return c.json(await getOverview(getUserId(c), level))
})

/**
 * 一个练习集的目录（只有题号和状态，没有正文）。
 * ?category=&mondaiNo=&year=&month=&scope=all|favorite|wrong
 */
qbankRouter.get('/set', async (c) => {
  const filter = parseSetFilter(c.req.query())
  return c.json(await getSet(getUserId(c), filter))
})

/** 按 id 批量取正文，一次最多 MAX_QUESTION_IDS 道。 */
qbankRouter.get('/questions', async (c) => {
  const ids = (c.req.query('ids') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_QUESTION_IDS)
  return c.json(await getQuestions(getUserId(c), ids))
})

qbankRouter.post('/attempts', async (c) => {
  const body = await c.req.json<{ questionId?: string; selected?: number }>()
  const result = await submitAttempt(
    getUserId(c),
    String(body.questionId ?? ''),
    Number(body.selected),
  )
  return c.json(result)
})

/** 清空答题卡，筛选参数与 /set 一致。 */
qbankRouter.delete('/attempts', async (c) => {
  const cleared = await clearAttempts(getUserId(c), parseSetFilter(c.req.query()))
  return c.json({ cleared })
})

qbankRouter.put('/favorites/:questionId', async (c) =>
  c.json(await setFavorite(getUserId(c), c.req.param('questionId'), true)),
)

qbankRouter.delete('/favorites/:questionId', async (c) =>
  c.json(await setFavorite(getUserId(c), c.req.param('questionId'), false)),
)
