import { Hono } from 'hono'
import {
  createNote,
  deleteNote,
  getCourses,
  getNoteById,
  getNotes,
  updateNote,
} from '../services/noteService'
import { getUserId, type AppEnv } from '../middleware/requireAuth'

export const notesRouter = new Hono<AppEnv>()

type NoteBody = {
  title?: string
  content?: string
  course?: string
  /** ISO 字符串；`null` = 退回创建时间。 */
  lessonAt?: string | null
}

notesRouter.get('/', async (c) => {
  const notes = await getNotes(getUserId(c), {
    course: c.req.query('course'),
    q: c.req.query('q'),
  })
  return c.json(notes)
})

// 必须排在 `/:id` 前面，否则会被它当成一个笔记 id 吃掉。
notesRouter.get('/courses', async (c) => {
  const courses = await getCourses(getUserId(c))
  return c.json(courses)
})

notesRouter.get('/:id', async (c) => {
  const note = await getNoteById(getUserId(c), c.req.param('id'))
  return c.json(note)
})

notesRouter.post('/', async (c) => {
  const body = await c.req.json<NoteBody>()
  const note = await createNote(getUserId(c), body)
  return c.json(note, 201)
})

notesRouter.patch('/:id', async (c) => {
  const body = await c.req.json<NoteBody>()
  const note = await updateNote(getUserId(c), c.req.param('id'), body)
  return c.json(note)
})

notesRouter.delete('/:id', async (c) => {
  const result = await deleteNote(getUserId(c), c.req.param('id'))
  return c.json(result)
})
