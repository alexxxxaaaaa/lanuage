import { createContext, useContext } from 'react'

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
 * Publishes this page's own breadcrumb label, e.g. a note's title in place of
 * the generic "笔记详情". Pass `null` while the data is still loading.
 */
export function usePageTitle(href: string, label: string | null): void {
  useSetBreadcrumbOverride(href, label)
}
