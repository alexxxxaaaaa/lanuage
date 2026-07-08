import { Hono } from 'hono'
import {
  createExam,
  deleteAttempt,
  deleteExam,
  getAttempt,
  getExamById,
  listAttempts,
  listExams,
  patchAttempt,
  startAttempt,
  submitAttempt,
} from '../services/examService'
import { getUserId, type AppEnv } from '../middleware/requireAuth'
import { requireAdmin } from '../middleware/requireAdmin'

export const examsRouter = new Hono<AppEnv>()

/** GET /api/exams — global exam library (all logged-in users see the same
 *  admin-curated list). Metadata only; parsedData loaded via detail. */
examsRouter.get('/', async (c) => {
  const rows = await listExams()
  return c.json(rows)
})

/** GET /api/exams/:id — one exam with fully parsed question tree. */
examsRouter.get('/:id', async (c) => {
  const row = await getExamById(c.req.param('id'))
  return c.json(row)
})

/** POST /api/exams — ADMIN ONLY. Client renders PDF pages to JPEG data URLs
 *  with pdf.js and posts them here; server feeds them to a vision-capable
 *  model that OCRs + structures the JLPT exam layout in one shot.
 *  Body: { title, year?, level?, pages: string[], solutionPages?: string[], audioUrl? }. */
examsRouter.post('/', requireAdmin, async (c) => {
  const body = await c.req.json<{
    title?: string
    year?: string
    level?: string
    pages?: string[]
    solutionPages?: string[]
    audioUrl?: string
  }>()
  const exam = await createExam({
    userId: getUserId(c),
    title: body.title ?? '',
    year: body.year,
    level: body.level,
    pages: body.pages ?? [],
    solutionPages: body.solutionPages,
    audioUrl: body.audioUrl,
  })
  return c.json(exam, 201)
})

/** DELETE /api/exams/:id — ADMIN ONLY. Cascades all users' attempts. */
examsRouter.delete('/:id', requireAdmin, async (c) => {
  const result = await deleteExam(c.req.param('id'))
  return c.json(result)
})

// ---- Attempts (做题会话) ----

examsRouter.get('/:examId/attempts', async (c) => {
  const rows = await listAttempts(getUserId(c), c.req.param('examId'))
  return c.json(rows)
})

examsRouter.post('/:examId/attempts', async (c) => {
  const created = await startAttempt(getUserId(c), c.req.param('examId'))
  return c.json(created, 201)
})

examsRouter.get('/:examId/attempts/:attemptId', async (c) => {
  const attempt = await getAttempt(
    getUserId(c),
    c.req.param('examId'),
    c.req.param('attemptId'),
  )
  return c.json(attempt)
})

examsRouter.patch('/:examId/attempts/:attemptId', async (c) => {
  const body = await c.req.json<{ answers?: Record<string, number> }>()
  const updated = await patchAttempt(
    getUserId(c),
    c.req.param('examId'),
    c.req.param('attemptId'),
    { answers: body.answers },
  )
  return c.json(updated)
})

examsRouter.post('/:examId/attempts/:attemptId/submit', async (c) => {
  const body = await c.req.json<{ answers?: Record<string, number> }>()
  const finalized = await submitAttempt(
    getUserId(c),
    c.req.param('examId'),
    c.req.param('attemptId'),
    { answers: body.answers },
  )
  return c.json(finalized)
})

examsRouter.delete('/:examId/attempts/:attemptId', async (c) => {
  const result = await deleteAttempt(
    getUserId(c),
    c.req.param('examId'),
    c.req.param('attemptId'),
  )
  return c.json(result)
})
