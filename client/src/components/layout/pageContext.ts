import { createContext, useContext, useEffect, useRef } from 'react'

import { useSetBreadcrumbOverride } from '../../providers/breadcrumbContext'

/** Set by `KeepAliveOutlet` around each mounted page. */
export const PageActiveContext = createContext(true)

/**
 * True when this page is the one on screen.
 *
 * Kept-alive pages stay mounted while the user is elsewhere, so any effect
 * that grabs the viewport — auto-scroll, `scrollIntoView`, autofocus, audio —
 * must gate on this or it will fight the foreground page.
 */
export function usePageActive(): boolean {
  return useContext(PageActiveContext)
}

/**
 * Runs `onReactivate` each time this page comes back to the foreground —
 * never on the first render, which is a plain mount rather than a return.
 *
 * Lets a kept-alive page refresh what went stale while it sat in the
 * background without re-running its whole mount path.
 */
export function useOnPageReactivated(onReactivate: () => void): void {
  const isActive = usePageActive()
  const latest = useRef(onReactivate)
  const wasActive = useRef(isActive)

  // Keep the callback fresh so it sees this render's state, without making it
  // a dependency of the effect below (which must fire only on the transition).
  useEffect(() => {
    latest.current = onReactivate
  })

  useEffect(() => {
    if (isActive && !wasActive.current) latest.current()
    wasActive.current = isActive
  }, [isActive])
}

/**
 * Publishes this page's own breadcrumb label, e.g. a note's title in place of
 * the generic "笔记详情". Pass `null` while the data is still loading.
 */
export function usePageTitle(href: string, label: string | null): void {
  useSetBreadcrumbOverride(href, label)
}
