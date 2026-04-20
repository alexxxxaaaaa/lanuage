import { apiClient } from './client'
import type {
  CreateFolderPayload,
  Folder,
  FolderDetail,
  UpdateFolderPayload,
} from '../types'

export async function getFolders() {
  const response = await apiClient.get<Folder[]>('/api/folders')
  return response.data
}

export async function getFolderById(id: string) {
  const response = await apiClient.get<FolderDetail>(`/api/folders/${id}`)
  return response.data
}

export async function createFolder(payload: CreateFolderPayload) {
  const response = await apiClient.post<Folder>('/api/folders', payload)
  return response.data
}

export async function updateFolder(id: string, payload: UpdateFolderPayload) {
  const response = await apiClient.patch<Folder>(`/api/folders/${id}`, payload)
  return response.data
}

export async function deleteFolder(id: string) {
  const response = await apiClient.delete<{ id: string }>(`/api/folders/${id}`)
  return response.data
}
