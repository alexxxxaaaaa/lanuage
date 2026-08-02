import { useCallback, useMemo, useState, type ReactNode } from 'react'

import { BreadcrumbOverrideContext } from './breadcrumbContext'

/**
 * Lets a page supply the human-readable label for its own breadcrumb entry
 * once its data loads — e.g. `/notes/abc123` renders as "笔记 › 面试笔记"
 * instead of "笔记 › 笔记详情".
 */
export function BreadcrumbOverrideProvider({ children }: { children: ReactNode }) {
  const [overrides, setOverrides] = useState<Record<string, string>>({})

  const setOverride = useCallback((href: string, label: string | null) => {
    setOverrides((prev) => {
      if (label == null) {
        if (!(href in prev)) return prev
        const next = { ...prev }
        delete next[href]
        return next
      }
      if (prev[href] === label) return prev
      return { ...prev, [href]: label }
    })
  }, [])

  const value = useMemo(() => ({ overrides, setOverride }), [overrides, setOverride])

  return (
    <BreadcrumbOverrideContext.Provider value={value}>
      {children}
    </BreadcrumbOverrideContext.Provider>
  )
}
