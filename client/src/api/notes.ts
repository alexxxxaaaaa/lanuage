import { apiClient } from './client'
import type { NoteListItem } from '../types'

/** 笔记里引用到的单词，够渲染一张卡片就行。 */
export type NoteWord = {
  id: string
  word: string
  reading: string
  meaning: string
  /** 词单是挂在词上的标签，可能有多个。 */
  folderIds: string[]
  folders: { id: string; name: string }[]
}

export type NoteDetail = {
  id: string
  title: string
  /** BlockNote 文档的 JSON。老笔记可能还是 HTML 或 Slate JSON，见 noteContent.ts。 */
  content: string
  course: string
  lessonAt: string
  createdAt: string
  updatedAt: string | null
  words: NoteWord[]
}

export type CourseOption = {
  course: string
  count: number
}

/** 自动保存打的补丁：只发改过的字段。 */
export type NotePatch = {
  title?: string
  content?: string
  course?: string
  /** ISO 字符串；`null` = 退回创建时间。 */
  lessonAt?: string | null
}

export async function getNotes(params: { course?: string; q?: string } = {}) {
  const response = await apiClient.get<NoteListItem[]>('/api/notes', {
    params: {
      course: params.course || undefined,
      q: params.q || undefined,
    },
  })
  return response.data
}

export async function getCourses() {
  const response = await apiClient.get<CourseOption[]>('/api/notes/courses')
  return response.data
}

export async function getNoteById(id: string) {
  const response = await apiClient.get<NoteDetail>(`/api/notes/${id}`)
  return response.data
}

/** 新建的笔记还没有关联单词，接口也就不带 `words`。 */
export async function createNote(payload: NotePatch = {}) {
  const response = await apiClient.post<Omit<NoteDetail, 'words'>>('/api/notes', payload)
  return response.data
}

export async function updateNote(id: string, payload: NotePatch) {
  const response = await apiClient.patch<NoteDetail>(`/api/notes/${id}`, payload)
  return response.data
}

export async function deleteNote(id: string) {
  await apiClient.delete(`/api/notes/${id}`)
}
