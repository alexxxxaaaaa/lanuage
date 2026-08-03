import type { UiLanguage } from '../i18n'

/** UI 语言 → `toLocaleDateString` 要的 BCP 47 标签。 */
export const DATE_LOCALES: Record<UiLanguage, string> = {
  zh: 'zh-CN',
  en: 'en-US',
  jp: 'ja-JP',
}

/**
 * 列表里的日期。今年的只给月日，往年的才带年份 —— 一列日期扫下去，年份重复
 * 出现只是噪音。
 */
export function formatListDate(iso: string, language: UiLanguage): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const isThisYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString(DATE_LOCALES[language], {
    year: isThisYear ? undefined : 'numeric',
    month: 'short',
    day: 'numeric',
  })
}
