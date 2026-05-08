import { Hono } from 'hono'
import { createNote, getNoteById, getNotes, updateNote } from '../services/noteService'
import { getUserId, type AppEnv } from '../middleware/requireAuth'

export const notesRouter = new Hono<AppEnv>()

notesRouter.get('/', async (c) => {
  const notes = await getNotes(getUserId(c))
  return c.json(notes)
})

notesRouter.get('/:id', async (c) => {
  const note = await getNoteById(getUserId(c), c.req.param('id'))
  return c.json(note)
})

notesRouter.post('/', async (c) => {
  const { title, content, course, lesson } = await c.req.json<{
    title?: string
    content?: string
    course?: string
    lesson?: string
  }>()
  const note = await createNote(getUserId(c), {
    title: title ?? '',
    content: content ?? '',
    course,
    lesson,
  })
  return c.json(note, 201)
})

notesRouter.patch('/:id', async (c) => {
  const body = await c.req.json<{
    title?: string
    content?: string
    course?: string
    lesson?: string
  }>()
  const note = await updateNote(getUserId(c), c.req.param('id'), body)
  return c.json(note)
})
