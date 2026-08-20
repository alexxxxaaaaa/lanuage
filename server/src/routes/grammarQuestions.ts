import { Hono } from 'hono'
import {
  DEFAULT_PAGE_SIZE,
  listAllQuestions,
  listQuestionsForGrammar,
  submitAttempt,
  updateQuestionNote,
} from '../services/grammarQuestionService'
import { getUserId, type AppEnv } from '../middleware/requireAuth'

export const grammarQuestionsRouter = new Hono<AppEnv>()

// Flat list for the practice page. Client shuffles for the "mixed drill" UX.
// ?mode=all|wrong (default all).
grammarQuestionsRouter.get('/', async (c) => {
  const modeRaw = c.req.query('mode')
  const mode: 'all' | 'wrong' = modeRaw === 'wrong' ? 'wrong' : 'all'
  const pageRaw = Number(c.req.query('page'))
  const sizeRaw = Number(c.req.query('pageSize'))
  const result = await listAllQuestions(
    getUserId(c),
    mode,
    Number.isFinite(pageRaw) ? pageRaw : 1,
    Number.isFinite(sizeRaw) ? sizeRaw : DEFAULT_PAGE_SIZE,
    c.req.query('q') ?? '',
  )
  return c.json(result)
})

// Questions attached to one grammar row — used by the grammar detail page.
grammarQuestionsRouter.get('/by-grammar/:grammarId', async (c) => {
  const questions = await listQuestionsForGrammar(
    getUserId(c),
    c.req.param('grammarId'),
  )
  return c.json(questions)
})

// 手写备注。空串 = 删掉备注，所以没有单独的 DELETE。
grammarQuestionsRouter.patch('/:questionId/note', async (c) => {
  const body = await c.req.json<{ note?: string }>()
  const result = await updateQuestionNote(
    getUserId(c),
    c.req.param('questionId'),
    body.note ?? '',
  )
  return c.json(result)
})

grammarQuestionsRouter.post('/:questionId/attempt', async (c) => {
  const body = await c.req.json<{ selectedIndex?: number }>()
  const result = await submitAttempt(
    getUserId(c),
    c.req.param('questionId'),
    body.selectedIndex ?? -1,
  )
  return c.json(result)
})
