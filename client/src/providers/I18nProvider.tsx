import { useCallback, useMemo, type ReactNode } from 'react'

import {
  I18nContext,
  interpolate,
  lookup,
  messages,
  type I18nContextValue,
  type UiLanguage,
} from '../i18n'
import { useSettings } from '../store/useSettings'

export function I18nProvider({ children }: { children: ReactNode }) {
  const language = useSettings((state) => state.settings.uiLanguage)
  const update = useSettings((state) => state.update)

  const setLanguage = useCallback(
    (next: UiLanguage) => update({ uiLanguage: next }),
    [update],
  )

  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      setLanguage,
      t: (key, vars) => interpolate(lookup(messages[language], key), vars),
    }),
    [language, setLanguage],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
