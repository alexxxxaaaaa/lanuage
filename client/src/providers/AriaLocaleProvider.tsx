import { I18nProvider as AriaI18nProvider } from '@heroui/react'
import type { ReactNode } from 'react'

import { DATE_LOCALES } from '../lib/datetime'
import { useI18n } from '../i18n'

/**
 * 把界面语言告诉 react-aria。
 *
 * HeroUI 的日期、数字类组件底层是 react-aria，它们默认跟随**浏览器**语言 ——
 * 于是界面明明是中文，日期输入框却排成 `7 / 1 / 2026` 这种美式顺序。这里把
 * 应用自己的语言选择转成 BCP 47 标签接进去，两边就一致了。
 *
 * 必须套在应用的 I18nProvider 里面，因为要先读得到当前语言。
 */
export function AriaLocaleProvider({ children }: { children: ReactNode }) {
  const { language } = useI18n()
  return <AriaI18nProvider locale={DATE_LOCALES[language]}>{children}</AriaI18nProvider>
}
