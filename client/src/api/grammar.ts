import { apiClient } from './client'
import type {
  CreateGrammarPayload,
  Grammar,
  UpdateGrammarPayload,
} from '../types'

export async function getGrammars(params?: {
  q?: string
  level?: string
  learned?: 'learned' | 'unlearned'
}) {
  const response = await apiClient.get<Grammar[]>('/api/grammar', { params })
  return response.data
}

export async function getGrammar(id: string) {
  const response = await apiClient.get<Grammar>(`/api/grammar/${id}`)
  return response.data
}

export async function createGrammar(payload: CreateGrammarPayload) {
  const response = await apiClient.post<Grammar>('/api/grammar', payload)
  return response.data
}

export async function updateGrammar(id: string, payload: UpdateGrammarPayload) {
  const response = await apiClient.patch<Grammar>(`/api/grammar/${id}`, payload)
  return response.data
}

export async function deleteGrammar(id: string) {
  const response = await apiClient.delete<{ id: string }>(`/api/grammar/${id}`)
  return response.data
}
