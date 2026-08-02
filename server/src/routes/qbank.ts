import { Hono, type Context } from 'hono'
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
import {
  collectExamWrongQuestions,
  getExamState,
  listExamPapers,
  parseExamMode,
  resetExam,
  saveExamAnswers,
  startExam,
  submitExamPhase,
} from '../services/qbankExamService'
import { AppError } from '../errors/AppError'
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

// ===== 模拟考试 =====

/** 历年历次的考卷列表，带本人这套卷的考试状态。 */
qbankRouter.get('/exams', async (c) => {
  const level = c.req.query('level') || 'N1'
  return c.json({ papers: await listExamPapers(getUserId(c), level) })
})

/** 路径上的年月，例：/exams/2020/12 */
function paperOf(c: Context<AppEnv>) {
  const year = Number(c.req.param('year'))
  const month = Number(c.req.param('month'))
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new AppError('年月不合法', 400)
  }
  return { level: c.req.query('level') || 'N1', year, month }
}

qbankRouter.post('/exams/:year/:month', async (c) => {
  const { level, year, month } = paperOf(c)
  const body = await c.req.json<{ mode?: string }>().catch(() => ({}) as { mode?: string })
  await startExam(getUserId(c), level, year, month, parseExamMode(body.mode))
  return c.json(await getExamState(getUserId(c), level, year, month))
})

qbankRouter.get('/exams/:year/:month', async (c) => {
  const { level, year, month } = paperOf(c)
  return c.json(await getExamState(getUserId(c), level, year, month))
})

/** 重置：删掉这套卷的作答和成绩，回到未开考。 */
qbankRouter.delete('/exams/:year/:month', async (c) => {
  const { level, year, month } = paperOf(c)
  return c.json(await resetExam(getUserId(c), level, year, month))
})

/** 自动保存当前阶段的作答，整份覆盖。 */
qbankRouter.patch('/exams/:year/:month', async (c) => {
  const { level, year, month } = paperOf(c)
  const body = await c.req.json<{ answers?: Record<string, unknown> }>()
  return c.json(await saveExamAnswers(getUserId(c), level, year, month, body.answers ?? {}))
})

qbankRouter.post('/exams/:year/:month/submit', async (c) => {
  const { level, year, month } = paperOf(c)
  const body = await c.req.json<{ phase?: string }>()
  if (body.phase !== 'written' && body.phase !== 'listening') {
    throw new AppError('阶段不合法', 400)
  }
  await submitExamPhase(getUserId(c), level, year, month, body.phase)
  return c.json(await getExamState(getUserId(c), level, year, month))
})

/** 一键把这场考试的错题收进错题本。 */
qbankRouter.post('/exams/:year/:month/collect-wrong', async (c) => {
  const { level, year, month } = paperOf(c)
  return c.json(await collectExamWrongQuestions(getUserId(c), level, year, month))
})
