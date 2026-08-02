import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { ThemeContext, type Theme, type ThemeContextValue } from './themeContext'

const STORAGE_KEY = 'theme'

function applyToDOM(theme: Theme) {
  const el = document.documentElement
  el.classList.remove('light', 'dark')
  el.classList.add(theme)
  el.setAttribute('data-theme', theme)
  el.style.colorScheme = theme
  // Keep the PWA / mobile browser chrome in step with the app background.
  // The two <meta name="theme-color"> tags in index.html are media-scoped, so
  // we only need to flip which one the browser sees as matching.
  document
    .querySelector('meta[name="theme-color"]:not([media])')
    // Keep these two in step with `--background` in theme.css.
    ?.setAttribute('content', theme === 'dark' ? '#0b0c0f' : '#f0f1f3')
}

/**
 * Resolve the theme and apply it to <html> **synchronously**, at module
 * evaluation time — before React's first render. This is what keeps the app
 * from flashing light-mode chrome on a dark-mode reload.
 *
 * Only an explicit choice is stored. Anything else (first visit, or the
 * retired `'system'` value from an older build) falls back to the OS
 * preference once, and the next toggle pins it.
 */
let initialTheme: Theme = 'light'
try {
  const stored = localStorage.getItem(STORAGE_KEY)
  initialTheme =
    stored === 'light' || stored === 'dark'
      ? stored
      : window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
} catch {
  /* private browsing */
}
applyToDOM(initialTheme)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(initialTheme)

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* quota exceeded */
    }
  }, [])

  useEffect(() => {
    applyToDOM(theme)
  }, [theme])

  // Sync across browser tabs.
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return
      if (e.newValue === 'light' || e.newValue === 'dark') setThemeState(e.newValue)
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [])

  const value = useMemo<ThemeContextValue>(() => ({ theme, setTheme }), [theme, setTheme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
