import { useCallback, useMemo, useState, type ReactNode } from 'react'

import {
  I18nContext,
  LANGUAGE_KEY,
  interpolate,
  loadLanguage,
  lookup,
  messages,
  type I18nContextValue,
  type UiLanguage,
} from '../i18n'

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<UiLanguage>(loadLanguage)

  const setLanguage = useCallback((next: UiLanguage) => {
    setLanguageState(next)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(LANGUAGE_KEY, next)
    }
  }, [])

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
