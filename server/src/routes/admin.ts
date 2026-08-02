import { Hono } from 'hono'
import {
  deleteExpression,
  deleteFolder,
  deleteNote,
  deleteUser,
  deleteWord,
  getNoteDetail,
  getStats,
  getUserDetail,
  listAiUsage,
  listExpressions,
  listFolders,
  listNotes,
  listUsers,
  listWords,
  resetUserPassword,
} from '../services/adminService'
import type { AppEnv } from '../middleware/requireAuth'

export const adminRouter = new Hono<AppEnv>()

function readPaging(c: any) {
  const page = Math.max(1, Number(c.req.query('page') ?? '1') || 1)
  const pageSize = Math.min(
    200,
    Math.max(1, Number(c.req.query('pageSize') ?? '20') || 20),
  )
  return { page, pageSize }
}

adminRouter.get('/stats', async (c) => c.json(await getStats()))

adminRouter.get('/users', async (c) => {
  const { page, pageSize } = readPaging(c)
  const keyword = c.req.query('keyword') ?? undefined
  const includeHash = c.req.query('includeHash') === 'true'
  return c.json(await listUsers({ keyword, page, pageSize, includeHash }))
})

adminRouter.get('/users/:id', async (c) => c.json(await getUserDetail(c.req.param('id'))))

adminRouter.post('/users/:id/reset-password', async (c) => {
  const { password } = await c.req.json<{ password?: string }>()
  return c.json(await resetUserPassword(c.req.param('id'), password ?? ''))
})

adminRouter.delete('/users/:id', async (c) => {
  return c.json(await deleteUser(c.req.param('id')))
})

adminRouter.get('/folders', async (c) => {
  const { page, pageSize } = readPaging(c)
  return c.json(
    await listFolders({
      userId: c.req.query('userId') ?? undefined,
      language: c.req.query('language') ?? undefined,
      keyword: c.req.query('keyword') ?? undefined,
      page,
      pageSize,
    }),
  )
})

adminRouter.delete('/folders/:id', async (c) => c.json(await deleteFolder(c.req.param('id'))))

adminRouter.get('/words', async (c) => {
  const { page, pageSize } = readPaging(c)
  return c.json(
    await listWords({
      userId: c.req.query('userId') ?? undefined,
      folderId: c.req.query('folderId') ?? undefined,
      language: c.req.query('language') ?? undefined,
      keyword: c.req.query('keyword') ?? undefined,
      page,
      pageSize,
    }),
  )
})

adminRouter.delete('/words/:id', async (c) => c.json(await deleteWord(c.req.param('id'))))

adminRouter.get('/notes', async (c) => {
  const { page, pageSize } = readPaging(c)
  return c.json(
    await listNotes({
      userId: c.req.query('userId') ?? undefined,
      course: c.req.query('course') ?? undefined,
      keyword: c.req.query('keyword') ?? undefined,
      page,
      pageSize,
    }),
  )
})

adminRouter.get('/notes/:id', async (c) => c.json(await getNoteDetail(c.req.param('id'))))

adminRouter.delete('/notes/:id', async (c) => c.json(await deleteNote(c.req.param('id'))))

adminRouter.get('/expressions', async (c) => {
  const { page, pageSize } = readPaging(c)
  return c.json(
    await listExpressions({
      userId: c.req.query('userId') ?? undefined,
      folderId: c.req.query('folderId') ?? undefined,
      keyword: c.req.query('keyword') ?? undefined,
      page,
      pageSize,
    }),
  )
})

adminRouter.delete('/expressions/:id', async (c) =>
  c.json(await deleteExpression(c.req.param('id'))),
)

adminRouter.get('/ai-usage', async (c) => {
  const { page, pageSize } = readPaging(c)
  return c.json(
    await listAiUsage({
      userId: c.req.query('userId') ?? undefined,
      feature: c.req.query('feature') ?? undefined,
      keyword: c.req.query('keyword') ?? undefined,
      page,
      pageSize,
    }),
  )
})
