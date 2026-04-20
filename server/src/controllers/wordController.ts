import type { Request, Response } from 'express'
import {
  createWord,
  deleteWord,
  getWords,
  updateWord,
} from '../services/wordService'

function getPathParam(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : ''
}

export async function createWordController(request: Request, response: Response) {
  const { word, reading, meaning, example, note, language, folderId } =
    request.body as {
      word?: string
      reading?: string
      meaning?: string
      example?: string
      note?: string
      language?: string
      folderId?: string
    }

  const createdWord = await createWord({
    word: word ?? '',
    reading: reading ?? '',
    meaning: meaning ?? '',
    example: example ?? '',
    note: note ?? '',
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

export async function updateWordController(request: Request, response: Response) {
  const { word, reading, meaning, example, note } = request.body as {
    word?: string
    reading?: string
    meaning?: string
    example?: string
    note?: string
  }

  const updated = await updateWord(getPathParam(request.params.id), {
    word,
    reading,
    meaning,
    example,
    note,
  })

  return response.json(updated)
}

export async function deleteWordController(request: Request, response: Response) {
  const result = await deleteWord(getPathParam(request.params.id))
  return response.json(result)
}
