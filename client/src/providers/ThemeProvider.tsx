import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { ThemeContext, type Theme, type ThemeContextValue } from './themeContext'

const STORAGE_KEY = 'theme'
const MEDIA_QUERY = '(prefers-color-scheme: dark)'

function getSystemTheme(): 'light' | 'dark' {
  return window.matchMedia(MEDIA_QUERY).matches ? 'dark' : 'light'
}

function resolveTheme(theme: Theme): 'light' | 'dark' {
  return theme === 'system' ? getSystemTheme() : theme
}

function applyToDOM(resolved: 'light' | 'dark') {
  const el = document.documentElement
  el.classList.remove('light', 'dark')
  el.classList.add(resolved)
  el.setAttribute('data-theme', resolved)
  el.style.colorScheme = resolved
  // Keep the PWA / mobile browser chrome in step with the app background.
  // The two <meta name="theme-color"> tags in index.html are media-scoped, so
  // we only need to flip which one the browser sees as matching.
  document
    .querySelector('meta[name="theme-color"]:not([media])')
    ?.setAttribute('content', resolved === 'dark' ? '#0a0a0b' : '#f7f7f7')
}

/**
 * Read the stored theme and apply it to <html> **synchronously**, at module
 * evaluation time — before React's first render. This is what keeps the app
 * from flashing light-mode chrome on a dark-mode reload.
 */
let initialTheme: Theme = 'system'
try {
  initialTheme = (localStorage.getItem(STORAGE_KEY) as Theme) || 'system'
} catch {
  /* private browsing */
}
applyToDOM(resolveTheme(initialTheme))

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initialTheme)
  // When theme === 'system' the resolved value depends on the OS preference,
  // so we track a counter that bumps whenever the media query fires. It lives
  // in state (not a ref written during render) so `resolved` stays a pure
  // derivation.
  const [systemTick, setSystemTick] = useState(0)

  const resolved = useMemo(() => {
    void systemTick
    return resolveTheme(theme)
  }, [theme, systemTick])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* quota exceeded */
    }
    applyToDOM(resolveTheme(next))
  }, [])

  useEffect(() => {
    applyToDOM(resolved)
  }, [resolved])

  // Only subscribe to the OS preference while following it.
  useEffect(() => {
    if (theme !== 'system') return
    const mq = window.matchMedia(MEDIA_QUERY)
    const handler = () => setSystemTick((n) => n + 1)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [theme])

  // Sync across browser tabs.
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return
      const next = e.newValue as Theme
      setThemeState(next)
      applyToDOM(resolveTheme(next))
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme: resolved, setTheme }),
    [theme, resolved, setTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
