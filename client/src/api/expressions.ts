import { apiClient } from './client'
import type { Expression, ExpressionFolder } from '../types'

export type ExpressionFolderDetail = ExpressionFolder & {
  expressions: Expression[]
}

export async function getExpressionFolders() {
  const response = await apiClient.get<ExpressionFolder[]>('/api/expressions/folders')
  return response.data
}

export async function getExpressionFolderById(id: string) {
  const response = await apiClient.get<ExpressionFolderDetail>(`/api/expressions/folders/${id}`)
  return response.data
}

export async function createExpressionFolder(payload: {
  name: string
  language: 'en' | 'jp'
}) {
  const response = await apiClient.post<ExpressionFolder>('/api/expressions/folders', payload)
  return response.data
}

export async function getExpressions(params?: {
  folderId?: string
  q?: string
  sceneTag?: string
  isMastered?: boolean
}) {
  const response = await apiClient.get<Expression[]>('/api/expressions', { params })
  return response.data
}

export async function createExpression(payload: {
  zhText: string
  folderId: string
  enCasual?: string
  jpCasual?: string
  sceneTag?: string
  note?: string
  isMastered?: boolean
}) {
  const response = await apiClient.post<Expression>('/api/expressions', payload)
  return response.data
}

export async function updateExpression(
  id: string,
  payload: {
    zhText?: string
    folderId?: string
    enCasual?: string
    jpCasual?: string
    sceneTag?: string
    note?: string
    isMastered?: boolean
  },
) {
  const response = await apiClient.patch<Expression>(`/api/expressions/${id}`, payload)
  return response.data
}

export async function deleteExpression(id: string) {
  const response = await apiClient.delete<{ id: string }>(`/api/expressions/${id}`)
  return response.data
}
