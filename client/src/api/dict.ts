import { apiClient } from './client'
import type { DictDirection } from '../lib/dictIndex'

/**
 * 词条方向。'en-zh' 只有 AI 生成的缓存行（英语词的中文释义）——
 * 静态 .idx 索引栏仍只有两个方向，所以不动 lib/dictIndex 的 DictDirection。
 */
export type DictEntryDirection = DictDirection | 'en-zh'

export type DictSense = {
  glosses: string[]
  examples?: { text: string; translation?: string }[]
  pos?: string
  /** 仅 AI 生成的行有值 —— 用法/变形提示。 */
  note?: string
}

/** 本地 Wiktextract 词库（或 AI 缓存，source='ai'）的一条义项。 */
export type DictEntry = {
  id: number
  word: string
  reading: string
  romaji: string
  pos: string
  senses: DictSense[]
  direction: DictEntryDirection
  source: string
}

type DictEntriesResponse = {
  entries: DictEntry[]
}

/** 词头精确匹配。不传 direction 就全方向查（含 AI 缓存行）。 */
export async function fetchDictEntries(
  word: string,
  options?: { direction?: DictEntryDirection; signal?: AbortSignal },
) {
  const response = await apiClient.get<DictEntriesResponse>('/api/dictionary/entries', {
    params: { word, ...(options?.direction ? { direction: options.direction } : {}) },
    signal: options?.signal,
  })
  return response.data.entries ?? []
}

/** 清除 AI 生成的缓存行。返回删掉的行数。 */
export async function clearAiDictEntry(word: string, direction?: DictEntryDirection) {
  const response = await apiClient.delete<{ deleted: number }>('/api/dictionary/ai-entry', {
    params: { word, ...(direction ? { direction } : {}) },
  })
  return response.data.deleted
}
