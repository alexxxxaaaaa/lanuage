import { createContext, useContext, useEffect } from 'react'

export type BreadcrumbOverrideContextValue = {
  overrides: Record<string, string>
  setOverride: (href: string, label: string | null) => void
}

export const BreadcrumbOverrideContext =
  createContext<BreadcrumbOverrideContextValue | null>(null)

/** Reads the override map. Empty object when no provider is mounted. */
export function useBreadcrumbOverrides(): Record<string, string> {
  return useContext(BreadcrumbOverrideContext)?.overrides ?? {}
}

/**
 * Registers a breadcrumb label for `href` while the caller is mounted. Pass
 * `null` while data is still loading — the crumb falls back to the route's
 * own title until then.
 */
export function useSetBreadcrumbOverride(href: string, label: string | null): void {
  // Depend on the stable setter rather than the context value: that value
  // object changes on every override write, which would turn this into a
  // cleanup → re-add loop.
  const setOverride = useContext(BreadcrumbOverrideContext)?.setOverride
  useEffect(() => {
    if (!setOverride) return
    setOverride(href, label)
    return () => setOverride(href, null)
  }, [setOverride, href, label])
}
