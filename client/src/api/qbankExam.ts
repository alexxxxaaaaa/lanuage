import { apiClient } from './client'
import type { QbankAiExplain } from './qbank'

/**
 * 模拟考试：整卷作答。题目和「精练」共用一套数据，但作答记录是另一张表，
 * 所以考试不会动到练习的答题卡和错题本（交卷后可以手动「收错题」）。
 *
 * 未交卷的阶段，服务端不下发 answer / explain / stemZh / 听力原文 ——
 * 这些字段在 ExamQuestion 上都是可选的，只有 phase = 'done' 时才有值。
 */

export type ExamMode = 'strict' | 'self'
export type ExamPhase = 'written' | 'listening' | 'done'
/** 先考哪一块。written = 官方顺序（笔试→听力）。 */
export type ExamSectionOrder = 'written' | 'listening'

export type ExamScore = {
  correct: number
  total: number
  /** 估算得点 0–180，官方换算表不公开。 */
  points: number
  passed: boolean
  sections: Array<{ key: string; correct: number; total: number; points: number }>
}

export type ExamPaper = {
  year: number
  month: number
  writtenTotal: number
  listeningTotal: number
  attempt: {
    mode: ExamMode
    sectionOrder: ExamSectionOrder
    phase: ExamPhase
    startedAt: string
    writtenSubmittedAt: string | null
    finishedAt: string | null
    isPaused: boolean
    answered: number
    score: ExamScore | null
  } | null
}

export type ExamQuestion = {
  id: string
  seq: string
  category: string
  mondaiNo: number
  stemJp: string
  options: string[]
  passageId: string | null
  audioUrl: string
  answer?: number
  /** 另一来源给的答案，0 = 无分歧。分歧题两个答案都判对。 */
  altAnswer?: number
  /** 人工写的争点说明，多数分歧没有。 */
  disputeNote?: string
  stemZh?: string
  explain?: string
  /** 已生成过的 AI 解析；缓存全局共享，精练页生成过的这里直接就有。 */
  aiExplain?: QbankAiExplain | null
}

export type ExamPassage = { id: string; code: string; type: string; content: string }

export type ExamState = {
  year: number
  month: number
  mode: ExamMode
  /** 先考哪一块，开考时定格。 */
  sectionOrder: ExamSectionOrder
  phase: ExamPhase
  startedAt: string
  /** 笔试倒计时的起点。先听力时是听力交卷那一刻，不是开考那一刻。 */
  writtenStartedAt: string
  listeningStartedAt: string
  writtenSubmittedAt: string | null
  listeningSubmittedAt: string | null
  finishedAt: string | null
  /** 非空 = 笔试正暂停着，倒计时冻在这一刻。 */
  pausedAt: string | null
  /** 此前累计暂停的毫秒，算剩余时间时从已用时里扣掉。 */
  pausedMs: number
  /** 笔试限时（分钟），官方 110 分。 */
  writtenMinutes: number
  /** 听力官方时长（分钟），仅作展示——实际由录音长度决定。 */
  listeningMinutes: number
  answers: Record<string, number>
  questions: ExamQuestion[]
  passages: ExamPassage[]
  score: ExamScore | null
}

const paperUrl = (year: number, month: number) => `/api/qbank/exams/${year}/${month}`

export async function getExamPapers() {
  const r = await apiClient.get<{ papers: ExamPaper[] }>('/api/qbank/exams')
  return r.data.papers
}

export async function startExam(
  year: number,
  month: number,
  mode: ExamMode,
  sectionOrder: ExamSectionOrder,
) {
  const r = await apiClient.post<ExamState>(paperUrl(year, month), { mode, sectionOrder })
  return r.data
}

export async function getExamState(year: number, month: number) {
  const r = await apiClient.get<ExamState>(paperUrl(year, month))
  return r.data
}

export async function resetExam(year: number, month: number) {
  const r = await apiClient.delete<{ reset: boolean }>(paperUrl(year, month))
  return r.data
}

/** 自动保存：整份覆盖当前阶段的作答。 */
export async function saveExamAnswers(
  year: number,
  month: number,
  answers: Record<string, number>,
) {
  const r = await apiClient.patch<{ answered: number }>(paperUrl(year, month), { answers })
  return r.data
}

/** 暂停 / 继续笔试倒计时。只有笔试阶段能调。 */
export async function setExamPaused(year: number, month: number, paused: boolean) {
  const r = await apiClient.post<ExamState>(`${paperUrl(year, month)}/pause`, { paused })
  return r.data
}

export async function submitExamPhase(
  year: number,
  month: number,
  phase: 'written' | 'listening',
) {
  const r = await apiClient.post<ExamState>(`${paperUrl(year, month)}/submit`, { phase })
  return r.data
}

export async function collectExamWrongQuestions(year: number, month: number) {
  const r = await apiClient.post<{ collected: number }>(`${paperUrl(year, month)}/collect-wrong`)
  return r.data
}
