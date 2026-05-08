import { Hono } from 'hono'
import {
  createFolder,
  deleteFolder,
  getFolderById,
  getFolders,
  updateFolder,
} from '../services/folderService'
import { getUserId, type AppEnv } from '../middleware/requireAuth'

export const foldersRouter = new Hono<AppEnv>()

foldersRouter.post('/', async (c) => {
  const { name, language } = await c.req.json<{
    name?: string
    language?: string
  }>()
  const folder = await createFolder(getUserId(c), name ?? '', language ?? '')
  return c.json(folder, 201)
})

foldersRouter.get('/', async (c) => {
  const folders = await getFolders(getUserId(c))
  return c.json(folders)
})

foldersRouter.get('/:id', async (c) => {
  const folder = await getFolderById(getUserId(c), c.req.param('id'))
  return c.json(folder)
})

foldersRouter.patch('/:id', async (c) => {
  const { name, language } = await c.req.json<{
    name?: string
    language?: string
  }>()
  const folder = await updateFolder(getUserId(c), c.req.param('id'), { name, language })
  return c.json(folder)
})

foldersRouter.delete('/:id', async (c) => {
  const result = await deleteFolder(getUserId(c), c.req.param('id'))
  return c.json(result)
})
