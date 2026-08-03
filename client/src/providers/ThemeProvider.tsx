import { useCallback, useEffect, useMemo, type ReactNode } from 'react'

import { ThemeContext, type Theme, type ThemeContextValue } from './themeContext'
import { useSettings } from '../store/useSettings'
import type { ThemeChoice } from '../api/settings'

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
 * 设置里存的是「用户选过什么」，空串表示没选过 —— 那就跟随系统。系统偏好只在
 * 启动时读一次：它后来变了也不该顶掉用户已经明确选定的值。
 */
let prefersDark = false
try {
  prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
} catch {
  /* 无痕模式 / 不支持 matchMedia */
}

function resolveTheme(choice: ThemeChoice): Theme {
  return choice || (prefersDark ? 'dark' : 'light')
}

// 在 React 首帧之前把主题落到 <html> 上。设置的本机快照是同步读出来的
// （见 store/useSettings.ts），所以深色模式下刷新不会先闪一屏浅色 ——
// 跟服务端对账是之后的事，对上了再重渲染一次。
applyToDOM(resolveTheme(useSettings.getState().settings.theme))

/**
 * 主题的读写口子。存在哪、怎么和账号同步全在 useSettings 里，这里只负责
 * 把「用户的选择」解析成实际生效的 light / dark 并落到 DOM 上。
 * 跨标签页同步也在 store 里，不必再单独监听 storage。
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const choice = useSettings((state) => state.settings.theme)
  const update = useSettings((state) => state.update)
  const theme = resolveTheme(choice)

  useEffect(() => {
    applyToDOM(theme)
  }, [theme])

  const setTheme = useCallback((next: Theme) => update({ theme: next }), [update])

  const value = useMemo<ThemeContextValue>(() => ({ theme, setTheme }), [theme, setTheme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
