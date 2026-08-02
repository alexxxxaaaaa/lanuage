import { http } from '@/lib/http'
import type {
  AdminAiUsageResponse,
  AdminExpressionRow,
  AdminFolderRow,
  AdminNoteDetail,
  AdminNoteRow,
  AdminStats,
  AdminUserDetail,
  AdminUserRow,
  AdminWordRow,
  Paged,
} from '@/types/api'

interface PagingParams {
  page?: number
  pageSize?: number
  keyword?: string
}

export const adminApi = {
  stats: () => http.get<AdminStats>('/api/admin/stats').then((r) => r.data),

  listUsers: (params: PagingParams & { includeHash?: boolean } = {}) =>
    http
      .get<Paged<AdminUserRow>>('/api/admin/users', { params })
      .then((r) => r.data),

  getUserDetail: (id: string) =>
    http.get<AdminUserDetail>(`/api/admin/users/${id}`).then((r) => r.data),

  resetUserPassword: (id: string, password: string) =>
    http
      .post<{ ok: boolean }>(`/api/admin/users/${id}/reset-password`, { password })
      .then((r) => r.data),

  deleteUser: (id: string) =>
    http.delete<{ ok: boolean }>(`/api/admin/users/${id}`).then((r) => r.data),

  listFolders: (
    params: PagingParams & { userId?: string; language?: string } = {},
  ) =>
    http
      .get<Paged<AdminFolderRow>>('/api/admin/folders', { params })
      .then((r) => r.data),

  deleteFolder: (id: string) =>
    http.delete<{ ok: boolean }>(`/api/admin/folders/${id}`).then((r) => r.data),

  listWords: (
    params: PagingParams & {
      userId?: string
      folderId?: string
      language?: string
    } = {},
  ) =>
    http
      .get<Paged<AdminWordRow>>('/api/admin/words', { params })
      .then((r) => r.data),

  deleteWord: (id: string) =>
    http.delete<{ ok: boolean }>(`/api/admin/words/${id}`).then((r) => r.data),

  listNotes: (params: PagingParams & { userId?: string; course?: string } = {}) =>
    http
      .get<Paged<AdminNoteRow>>('/api/admin/notes', { params })
      .then((r) => r.data),

  getNoteDetail: (id: string) =>
    http.get<AdminNoteDetail>(`/api/admin/notes/${id}`).then((r) => r.data),

  deleteNote: (id: string) =>
    http.delete<{ ok: boolean }>(`/api/admin/notes/${id}`).then((r) => r.data),

  listExpressions: (
    params: PagingParams & { userId?: string; folderId?: string } = {},
  ) =>
    http
      .get<Paged<AdminExpressionRow>>('/api/admin/expressions', { params })
      .then((r) => r.data),

  deleteExpression: (id: string) =>
    http
      .delete<{ ok: boolean }>(`/api/admin/expressions/${id}`)
      .then((r) => r.data),

  listAiUsage: (
    params: PagingParams & { userId?: string; feature?: string } = {},
  ) =>
    http
      .get<AdminAiUsageResponse>('/api/admin/ai-usage', { params })
      .then((r) => r.data),
}
