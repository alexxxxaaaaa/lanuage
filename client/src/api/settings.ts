import { apiClient } from './client'
import type { ExamMode } from './qbankExam'
import type { UiLanguage } from '../i18n'

/** 空串 = 跟随系统，由 ThemeProvider 解析成 light / dark。 */
export type ThemeChoice = '' | 'light' | 'dark'

/** 设置页的全部偏好，跟账号走。 */
export type UserSettings = {
  theme: ThemeChoice
  uiLanguage: UiLanguage
  examMode: ExamMode
  localDictEnabled: boolean
}

/** `saved=false` 表示这个账号还没存过设置，此时以本机的选择为准。 */
export async function fetchSettings() {
  const response = await apiClient.get<{ settings: UserSettings; saved: boolean }>(
    '/api/settings',
  )
  return response.data
}

export async function patchSettings(patch: Partial<UserSettings>) {
  const response = await apiClient.patch<UserSettings>('/api/settings', patch)
  return response.data
}
