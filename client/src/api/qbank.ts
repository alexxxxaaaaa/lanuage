import { apiClient } from './client'

/** 后端一次最多返回这么多道题的正文，见 server/src/services/qbankService.ts。 */
export const QBANK_PAGE_SIZE = 20

export type QbankScope = 'all' | 'favorite' | 'wrong'

export type QbankSetFilter = {
  category?: string
  mondaiNo?: number
  year?: number
  month?: number
  scope?: QbankScope
}

export type QbankOverviewGroup = {
  category: string
  mondaiNo: number
  total: number
  answered: number
  correct: number
  papers: Array<{
    year: number
    month: number
    total: number
    answered: number
    correct: number
  }>
}

export type QbankOverview = {
  groups: QbankOverviewGroup[]
  favoriteCount: number
  wrongCount: number
}

export type QbankSetItem = {
  id: string
  seq: string
  year: number
  month: number
  category: string
  mondaiNo: number
  status: 'correct' | 'wrong' | null
  favorite: boolean
}

export type QbankQuestion = {
  id: string
  seq: string
  year: number
  month: number
  category: string
  mondaiNo: number
  stemJp: string
  stemZh: string
  options: string[]
  answer: number
  explain: string
  audioUrl: string
  dispute: string
  passage: { code: string; type: string; content: string } | null
  status: 'correct' | 'wrong' | null
  selected: number | null
  favorite: boolean
}

function filterParams(filter: QbankSetFilter) {
  return {
    ...(filter.category ? { category: filter.category } : {}),
    ...(filter.mondaiNo ? { mondaiNo: filter.mondaiNo } : {}),
    ...(filter.year && filter.month ? { year: filter.year, month: filter.month } : {}),
    ...(filter.scope && filter.scope !== 'all' ? { scope: filter.scope } : {}),
  }
}

export async function getQbankOverview() {
  const r = await apiClient.get<QbankOverview>('/api/qbank/overview')
  return r.data
}

/** 练习集目录：只有题号和对错，正文按需再取。 */
export async function getQbankSet(filter: QbankSetFilter) {
  const r = await apiClient.get<{ total: number; items: QbankSetItem[] }>('/api/qbank/set', {
    params: filterParams(filter),
  })
  return r.data
}

export async function getQbankQuestions(ids: string[]) {
  if (ids.length === 0) return []
  const r = await apiClient.get<QbankQuestion[]>('/api/qbank/questions', {
    params: { ids: ids.join(',') },
  })
  return r.data
}

export async function submitQbankAttempt(questionId: string, selected: number) {
  const r = await apiClient.post<{ isCorrect: boolean; answer: number }>('/api/qbank/attempts', {
    questionId,
    selected,
  })
  return r.data
}

export async function clearQbankAttempts(filter: QbankSetFilter) {
  const r = await apiClient.delete<{ cleared: number }>('/api/qbank/attempts', {
    params: filterParams(filter),
  })
  return r.data
}

export async function setQbankFavorite(questionId: string, favorite: boolean) {
  const url = `/api/qbank/favorites/${questionId}`
  const r = favorite
    ? await apiClient.put<{ favorite: boolean }>(url)
    : await apiClient.delete<{ favorite: boolean }>(url)
  return r.data
}
