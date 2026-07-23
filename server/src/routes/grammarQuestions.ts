import { Hono } from 'hono'
import {
  listAllQuestions,
  listQuestionsForGrammar,
  submitAttempt,
} from '../services/grammarQuestionService'
import { getUserId, type AppEnv } from '../middleware/requireAuth'

export const grammarQuestionsRouter = new Hono<AppEnv>()

// Flat list for the practice page. Client shuffles for the "mixed drill" UX.
// ?mode=all|wrong (default all).
grammarQuestionsRouter.get('/', async (c) => {
  const modeRaw = c.req.query('mode')
  const mode: 'all' | 'wrong' = modeRaw === 'wrong' ? 'wrong' : 'all'
  const questions = await listAllQuestions(getUserId(c), mode)
  return c.json(questions)
})

// Questions attached to one grammar row — used by the grammar detail page.
grammarQuestionsRouter.get('/by-grammar/:grammarId', async (c) => {
  const questions = await listQuestionsForGrammar(
    getUserId(c),
    c.req.param('grammarId'),
  )
  return c.json(questions)
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
