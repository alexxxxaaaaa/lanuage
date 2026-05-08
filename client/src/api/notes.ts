import { apiClient } from './client'
import type { Note, Word } from '../types'

export type NoteDetail = Note & {
  words: Word[]
}

export async function getNotes() {
  const response = await apiClient.get<Note[]>('/api/notes')
  return response.data
}

export async function getNoteById(id: string) {
  const response = await apiClient.get<NoteDetail>(`/api/notes/${id}`)
  return response.data
}

export async function createNote(payload: {
  title: string
  content: string
  course?: string
  lesson?: string
}) {
  const response = await apiClient.post<Note>('/api/notes', payload)
  return response.data
}

export async function updateNote(
  id: string,
  payload: {
    title?: string
    content?: string
    course?: string
    lesson?: string
  },
) {
  const response = await apiClient.patch<Note>(`/api/notes/${id}`, payload)
  return response.data
}
