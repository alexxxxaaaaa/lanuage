import type { Request, Response } from 'express'
import {
  createWord,
  deleteWord,
  getTodayNewWords,
  getWords,
  updateWord,
} from '../services/wordService'

function getPathParam(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : ''
}

export async function createWordController(request: Request, response: Response) {
  const {
    word,
    reading,
    meaning,
    example,
    note,
    partOfSpeech,
    sourceNoteId,
    language,
    folderId,
  } =
    request.body as {
      word?: string
      reading?: string
      meaning?: string
      example?: string
      note?: string
      partOfSpeech?: string
      sourceNoteId?: string
      language?: string
      folderId?: string
    }

  const createdWord = await createWord({
    word: word ?? '',
    reading: reading ?? '',
    meaning: meaning ?? '',
    example: example ?? '',
    note: note ?? '',
    partOfSpeech: partOfSpeech ?? '',
    sourceNoteId,
    language: language ?? '',
    folderId: folderId ?? '',
  })

  return response.status(201).json(createdWord)
}

export async function getWordsController(request: Request, response: Response) {
  const folderId =
    typeof request.query.folderId === 'string' ? request.query.folderId : undefined
  const query = typeof request.query.q === 'string' ? request.query.q : undefined

  const words = await getWords(folderId, query)

  return response.json(words)
}

export async function getTodayNewWordsController(
  request: Request,
  response: Response,
) {
  const folderId =
    typeof request.query.folderId === 'string' ? request.query.folderId : undefined
  const words = await getTodayNewWords(folderId)
  return response.json(words)
}

function csvEscape(value: unknown) {
  const str = value === null || value === undefined ? '' : String(value)
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export async function exportWordsCsvController(request: Request, response: Response) {
  const folderId =
    typeof request.query.folderId === 'string' ? request.query.folderId : undefined
  const words = await getWords(folderId, undefined)

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

  // BOM for Excel UTF-8 compatibility
  response.setHeader('Content-Type', 'text/csv; charset=utf-8')
  response.setHeader('Content-Disposition', `attachment; filename="${fileName}"`)
  return response.send('﻿' + csv)
}

export async function updateWordController(request: Request, response: Response) {
  const { word, reading, meaning, example, note, partOfSpeech, sourceNoteId, folderId } =
    request.body as {
    word?: string
    reading?: string
    meaning?: string
    example?: string
    note?: string
    partOfSpeech?: string
    sourceNoteId?: string | null
    folderId?: string
  }

  const updated = await updateWord(getPathParam(request.params.id), {
    word,
    reading,
    meaning,
    example,
    note,
    partOfSpeech,
    sourceNoteId,
    folderId,
  })

  return response.json(updated)
}

export async function deleteWordController(request: Request, response: Response) {
  const result = await deleteWord(getPathParam(request.params.id))
  return response.json(result)
}
