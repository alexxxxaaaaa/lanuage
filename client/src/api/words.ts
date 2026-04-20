import { apiClient } from './client'
import type { CreateWordPayload, UpdateWordPayload, Word } from '../types'

export async function createWord(payload: CreateWordPayload) {
  const response = await apiClient.post<Word>('/api/words', payload)
  return response.data
}

export async function updateWord(id: string, payload: UpdateWordPayload) {
  const response = await apiClient.patch<Word>(`/api/words/${id}`, payload)
  return response.data
}

export async function deleteWord(id: string) {
  const response = await apiClient.delete<{ id: string }>(`/api/words/${id}`)
  return response.data
}

export async function getWords(params?: { folderId?: string; q?: string }) {
  const response = await apiClient.get<Word[]>('/api/words', {
    params,
  })
  return response.data
}
