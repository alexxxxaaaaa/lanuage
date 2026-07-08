import { apiClient } from './client'
import type { ExamListItem, ExamDetail } from '../types'

export async function listExams() {
  const r = await apiClient.get<ExamListItem[]>('/api/exams')
  return r.data
}

export async function getExam(id: string) {
  const r = await apiClient.get<ExamDetail>(`/api/exams/${id}`)
  return r.data
}

/** Upload rendered PDF page images for AI (vision) parsing. Client renders
 *  each page to a JPEG data URL with pdf.js; server feeds those to a
 *  vision-capable model to extract sections & questions. `pages` order matches
 *  the PDF's page order.
 *
 *  When `solutionPages` are provided, the server ALSO parses those and
 *  merges per-question answer + explanation onto the corresponding questions.
 *
 *  Override the default 10s axios timeout — vision-based parsing runs
 *  multiple parallel OpenAI calls on the server, easily taking 60-180s total
 *  when both PDFs are provided.
 */
export async function createExam(payload: {
  title: string
  year?: string
  level?: string
  pages: string[]
  solutionPages?: string[]
  audioUrl?: string
}) {
  const r = await apiClient.post<ExamListItem>('/api/exams', payload, {
    timeout: 300000, // 5 minutes
  })
  return r.data
}

export async function deleteExam(id: string) {
  const r = await apiClient.delete<{ id: string }>(`/api/exams/${id}`)
  return r.data
}

// ---- Attempts ----

export type ExamAttempt = {
  id: string
  examId: string
  answers: string           // JSON string
  score: number | null      // 0-100
  scoreByType: string       // JSON string
  startedAt: string
  finishedAt: string | null
}

export async function listAttempts(examId: string) {
  const r = await apiClient.get<ExamAttempt[]>(`/api/exams/${examId}/attempts`)
  return r.data
}

export async function startAttempt(examId: string) {
  const r = await apiClient.post<ExamAttempt>(`/api/exams/${examId}/attempts`)
  return r.data
}

export async function getAttempt(examId: string, attemptId: string) {
  const r = await apiClient.get<ExamAttempt>(
    `/api/exams/${examId}/attempts/${attemptId}`,
  )
  return r.data
}

/** Auto-save partial answers during a session. Called every N seconds and on
 *  page unload so a network drop or refresh doesn't lose progress. */
export async function patchAttempt(
  examId: string,
  attemptId: string,
  answers: Record<string, number>,
) {
  const r = await apiClient.patch<ExamAttempt>(
    `/api/exams/${examId}/attempts/${attemptId}`,
    { answers },
  )
  return r.data
}

export async function submitAttempt(
  examId: string,
  attemptId: string,
  answers: Record<string, number>,
) {
  const r = await apiClient.post<ExamAttempt>(
    `/api/exams/${examId}/attempts/${attemptId}/submit`,
    { answers },
  )
  return r.data
}

export async function deleteAttempt(examId: string, attemptId: string) {
  const r = await apiClient.delete<{ id: string }>(
    `/api/exams/${examId}/attempts/${attemptId}`,
  )
  return r.data
}
