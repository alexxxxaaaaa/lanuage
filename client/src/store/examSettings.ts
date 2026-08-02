import { create } from 'zustand'
import type { ExamMode } from '../api/qbankExam'

/**
 * 模拟考试的考试模式。和主题/界面语言一样是本机偏好，存 localStorage。
 *
 * 只在**开考那一刻**被读一次：模式会随 attempt 存到服务端，中途改设置
 * 不会影响正在进行的那场考试。
 */

const KEY = 'word-sprint-exam-mode'

function load(): ExamMode {
  if (typeof window === 'undefined') return 'strict'
  try {
    return window.localStorage.getItem(KEY) === 'self' ? 'self' : 'strict'
  } catch {
    return 'strict'
  }
}

type ExamSettingsState = {
  mode: ExamMode
  setMode: (mode: ExamMode) => void
}

export const useExamSettings = create<ExamSettingsState>((set) => ({
  mode: load(),
  setMode: (mode) => {
    try {
      window.localStorage.setItem(KEY, mode)
    } catch {
      // 无痕模式 / 配额满：本次会话内仍然生效。
    }
    set({ mode })
  },
}))
