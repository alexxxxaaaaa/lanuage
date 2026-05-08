import type { Request, Response } from 'express'
import { lookupDictionary } from '../services/dictionaryService'

export async function lookupDictionaryController(request: Request, response: Response) {
  const term = typeof request.query.term === 'string' ? request.query.term : ''
  const language =
    typeof request.query.language === 'string' ? request.query.language : 'en'

  const items = await lookupDictionary(term, language as 'en' | 'jp')
  return response.json({ items })
}
