import { RouterProvider } from '@heroui/react'
import { useCallback, type ReactNode } from 'react'
import { useHref, useNavigate } from 'react-router'

/**
 * 把 react-aria 的链接导航接到 react-router 上。
 *
 * HeroUI 里凡是能带 `href` 的东西（Link、Table 的行、ListBox 项、Breadcrumbs）
 * 底层都是 react-aria 的链接。默认它们会走浏览器原生跳转 —— 在这个 SPA 里就是
 * 整页重载，keep-alive 的页面状态全丢。接上之后它们和 `<Link>` 行为一致。
 *
 * 必须放在 BrowserRouter 里面，因为要用 useNavigate / useHref。
 */
export function AriaRouterProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  // react-aria 传的是自己的 options，这里只用得到路径。
  const handleNavigate = useCallback((to: string) => void navigate(to), [navigate])

  return (
    <RouterProvider navigate={handleNavigate} useHref={useHref}>
      {children}
    </RouterProvider>
  )
}
