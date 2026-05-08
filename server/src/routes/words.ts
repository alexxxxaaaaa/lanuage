import { Hono } from 'hono'
import {
  createWord,
  deleteWord,
  getTodayNewWords,
  getWords,
  updateWord,
} from '../services/wordService'
import { getUserId, type AppEnv } from '../middleware/requireAuth'

export const wordsRouter = new Hono<AppEnv>()

wordsRouter.post('/', async (c) => {
  const body = await c.req.json<{
    word?: string
    reading?: string
    meaning?: string
    example?: string
    note?: string
    partOfSpeech?: string
    sourceNoteId?: string
    language?: string
    folderId?: string
  }>()
  const created = await createWord(getUserId(c), {
    word: body.word ?? '',
    reading: body.reading ?? '',
    meaning: body.meaning ?? '',
    example: body.example ?? '',
    note: body.note ?? '',
    partOfSpeech: body.partOfSpeech ?? '',
    sourceNoteId: body.sourceNoteId,
    language: body.language ?? '',
    folderId: body.folderId ?? '',
  })
  return c.json(created, 201)
})

wordsRouter.get('/today-new', async (c) => {
  const folderId = c.req.query('folderId')
  const words = await getTodayNewWords(getUserId(c), folderId)
  return c.json(words)
})

function csvEscape(value: unknown) {
  const str = value === null || value === undefined ? '' : String(value)
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

wordsRouter.get('/export', async (c) => {
  const folderId = c.req.query('folderId')
  const words = await getWords(getUserId(c), folderId, undefined)

  const header = [
    'word',
    'reading',
    'partOfSpeech',
    'meaning',
    'example',
    'note',
    'language',
    'folder',
    'createdAt',
    'lastReviewedAt',
    'nextReviewDate',
    'repetition',
    'interval',
    'difficultyScore',
  ]

  const rows = words.map((word: any) =>
    [
      word.word,
      word.reading,
      word.partOfSpeech,
      word.meaning,
      word.example,
      word.note,
      word.language,
      word.folder?.name ?? '',
      word.createdAt instanceof Date ? word.createdAt.toISOString() : word.createdAt,
      word.review?.lastReviewedAt instanceof Date
        ? word.review.lastReviewedAt.toISOString()
        : word.review?.lastReviewedAt ?? '',
      word.review?.nextReviewDate instanceof Date
        ? word.review.nextReviewDate.toISOString()
        : word.review?.nextReviewDate ?? '',
      word.review?.repetition ?? 0,
      word.review?.interval ?? 0,
      word.review?.difficultyScore ?? 0,
    ]
      .map(csvEscape)
      .join(','),
  )

  const csv = [header.join(','), ...rows].join('\n')
  const fileName = folderId ? `words-${folderId.slice(0, 8)}.csv` : 'words-all.csv'

  return new Response('﻿' + csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    },
  })
})

wordsRouter.get('/', async (c) => {
  const folderId = c.req.query('folderId')
  const query = c.req.query('q')
  const words = await getWords(getUserId(c), folderId, query)
  return c.json(words)
})

wordsRouter.patch('/:id', async (c) => {
  const body = await c.req.json<{
    word?: string
    reading?: string
    meaning?: string
    example?: string
    note?: string
    partOfSpeech?: string
    sourceNoteId?: string | null
    folderId?: string
  }>()
  const updated = await updateWord(getUserId(c), c.req.param('id'), body)
  return c.json(updated)
})

wordsRouter.delete('/:id', async (c) => {
  const result = await deleteWord(getUserId(c), c.req.param('id'))
  return c.json(result)
})
