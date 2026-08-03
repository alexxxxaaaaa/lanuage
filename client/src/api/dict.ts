import { apiClient } from './client'
import type { DictDirection } from '../lib/dictIndex'

export type DictSense = {
  glosses: string[]
  examples?: { text: string; translation?: string }[]
  pos?: string
}

/** 本地 Wiktextract 词库的一条义项。 */
export type DictEntry = {
  id: number
  word: string
  reading: string
  romaji: string
  pos: string
  senses: DictSense[]
  direction: DictDirection
  source: string
}

type DictEntriesResponse = {
  entries: DictEntry[]
}

/** 词头精确匹配。不传 direction 就两个方向都查。 */
export async function fetchDictEntries(
  word: string,
  options?: { direction?: DictDirection; signal?: AbortSignal },
) {
  const response = await apiClient.get<DictEntriesResponse>('/api/dictionary/entries', {
    params: { word, ...(options?.direction ? { direction: options.direction } : {}) },
    signal: options?.signal,
  })
  return response.data.entries ?? []
}
