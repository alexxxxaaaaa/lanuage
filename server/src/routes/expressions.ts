import { Hono } from 'hono'
import {
  createExpressionFolder,
  createExpression,
  deleteExpression,
  getExpressionFolderById,
  getExpressionFolders,
  getExpressionById,
  getExpressions,
  updateExpression,
} from '../services/expressionService'
import { getUserId, type AppEnv } from '../middleware/requireAuth'

export const expressionsRouter = new Hono<AppEnv>()

expressionsRouter.get('/folders', async (c) => {
  const folders = await getExpressionFolders(getUserId(c))
  return c.json(folders)
})

expressionsRouter.get('/folders/:id', async (c) => {
  const folder = await getExpressionFolderById(getUserId(c), c.req.param('id'))
  return c.json(folder)
})

expressionsRouter.post('/folders', async (c) => {
  const { name, language } = await c.req.json<{ name?: string; language?: string }>()
  const folder = await createExpressionFolder(getUserId(c), {
    name: name ?? '',
    language: language ?? '',
  })
  return c.json(folder, 201)
})

expressionsRouter.get('/', async (c) => {
  const q = c.req.query('q')
  const sceneTag = c.req.query('sceneTag')
  const folderId = c.req.query('folderId')
  const isMasteredRaw = c.req.query('isMastered')
  const isMastered =
    typeof isMasteredRaw === 'string' ? isMasteredRaw === 'true' : undefined

  const expressions = await getExpressions(getUserId(c), {
    q,
    sceneTag,
    isMastered,
    folderId,
  })
  return c.json(expressions)
})

expressionsRouter.get('/:id', async (c) => {
  const expression = await getExpressionById(getUserId(c), c.req.param('id'))
  return c.json(expression)
})

expressionsRouter.post('/', async (c) => {
  const body = await c.req.json<{
    zhText?: string
    folderId?: string
    enCasual?: string
    jpCasual?: string
    sceneTag?: string
    note?: string
    isMastered?: boolean
  }>()
  const created = await createExpression(getUserId(c), {
    zhText: body.zhText ?? '',
    folderId: body.folderId ?? '',
    enCasual: body.enCasual,
    jpCasual: body.jpCasual,
    sceneTag: body.sceneTag,
    note: body.note,
    isMastered: body.isMastered,
  })
  return c.json(created, 201)
})

expressionsRouter.patch('/:id', async (c) => {
  const body = await c.req.json<{
    zhText?: string
    folderId?: string
    enCasual?: string
    jpCasual?: string
    sceneTag?: string
    note?: string
    isMastered?: boolean
  }>()
  const updated = await updateExpression(getUserId(c), c.req.param('id'), body)
  return c.json(updated)
})

expressionsRouter.delete('/:id', async (c) => {
  const result = await deleteExpression(getUserId(c), c.req.param('id'))
  return c.json(result)
})
