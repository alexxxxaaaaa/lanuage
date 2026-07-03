import { Hono } from 'hono'
import {
  deletePodcast,
  getPodcast,
  importPodcast,
  inspectYoutubeUrl,
  listPodcasts,
  updatePodcastLine,
  updatePodcastPosition,
} from '../services/podcastService'
import { getUserId, type AppEnv } from '../middleware/requireAuth'

export const podcastsRouter = new Hono<AppEnv>()

/** GET /api/podcasts — list user's imported videos. */
podcastsRouter.get('/', async (c) => {
  const rows = await listPodcasts(getUserId(c))
  return c.json(rows)
})

/** GET /api/podcasts/inspect?url=... — preview metadata + available caption
 *  tracks for a URL. Used by the import form before committing. */
podcastsRouter.get('/inspect', async (c) => {
  const url = c.req.query('url') ?? ''
  const meta = await inspectYoutubeUrl(url)
  return c.json(meta)
})

podcastsRouter.post('/', async (c) => {
  const body = await c.req.json<{
    url?: string
    primaryLang?: 'jp' | 'en'
    primarySrt?: string
    zhSrt?: string
  }>()
  if (!body.url) {
    return c.json({ message: 'url is required' }, 400)
  }
  const lang = body.primaryLang === 'en' ? 'en' : 'jp'
  const created = await importPodcast(getUserId(c), {
    url: body.url,
    primaryLang: lang,
    primarySrt: body.primarySrt,
    zhSrt: body.zhSrt,
  })
  return c.json(created, 201)
})

podcastsRouter.get('/:id', async (c) => {
  const row = await getPodcast(getUserId(c), c.req.param('id'))
  return c.json(row)
})

podcastsRouter.delete('/:id', async (c) => {
  const result = await deletePodcast(getUserId(c), c.req.param('id'))
  return c.json(result)
})

/** Edit a single transcript line. Used by the inline fixer when imported
 *  captions have wrong text. Identified by array index (lineIndex). */
podcastsRouter.patch('/:id/lines/:lineIndex', async (c) => {
  const body = await c.req.json<{ text?: string; zh?: string | null }>()
  const line = await updatePodcastLine(
    getUserId(c),
    c.req.param('id'),
    Number.parseInt(c.req.param('lineIndex'), 10),
    { text: body.text, zh: body.zh },
  )
  return c.json(line)
})

/** Frequent write — called every ~5s during playback, on pause, and on
 *  page unload. Body: { sec: number }. */
podcastsRouter.patch('/:id/position', async (c) => {
  const body = await c.req.json<{ sec?: number }>()
  const result = await updatePodcastPosition(
    getUserId(c),
    c.req.param('id'),
    Number(body.sec ?? 0),
  )
  return c.json(result)
})
