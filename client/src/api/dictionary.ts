import { apiClient } from './client'

export type DictionaryLookupItem = {
  word: string
  reading: string
  meaning: string
  example: string
  note: string
  language: 'en' | 'jp'
}

type DictionaryLookupResponse = {
  items: DictionaryLookupItem[]
}

export async function lookupDictionary(term: string, language: 'en' | 'jp') {
  const response = await apiClient.get<DictionaryLookupResponse>('/api/dictionary/lookup', {
    params: { term, language },
  })
  return response.data.items ?? []
}
