import { Hono } from 'hono'
import {
  createGrammar,
  deleteGrammar,
  getGrammar,
  getGrammars,
  updateGrammar,
} from '../services/grammarService'
import { getUserId, type AppEnv } from '../middleware/requireAuth'

export const grammarRouter = new Hono<AppEnv>()

grammarRouter.post('/', async (c) => {
  const body = await c.req.json<{
    pattern?: string
    connection?: string
    meaning?: string
    example?: string
    exampleZh?: string
    note?: string
    level?: string
  }>()
  const created = await createGrammar(getUserId(c), {
    pattern: body.pattern ?? '',
    connection: body.connection,
    meaning: body.meaning,
    example: body.example,
    exampleZh: body.exampleZh,
    note: body.note,
    level: body.level,
  })
  return c.json(created, 201)
})

grammarRouter.get('/', async (c) => {
  const query = c.req.query('q')
  const level = c.req.query('level')
  const grammars = await getGrammars(getUserId(c), query, level)
  return c.json(grammars)
})

grammarRouter.get('/:id', async (c) => {
  const grammar = await getGrammar(getUserId(c), c.req.param('id'))
  return c.json(grammar)
})

grammarRouter.patch('/:id', async (c) => {
  const body = await c.req.json<{
    pattern?: string
    connection?: string
    meaning?: string
    example?: string
    exampleZh?: string
    note?: string
    level?: string
  }>()
  const updated = await updateGrammar(getUserId(c), c.req.param('id'), body)
  return c.json(updated)
})

grammarRouter.delete('/:id', async (c) => {
  const result = await deleteGrammar(getUserId(c), c.req.param('id'))
  return c.json(result)
})
