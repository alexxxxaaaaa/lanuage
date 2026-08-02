import { useMemo } from 'react'
import { useLocation } from 'react-router'

import { useI18n } from '../i18n'
import { getRouteChain } from '../lib/routes'
import { useBreadcrumbOverrides } from '../providers/breadcrumbContext'

export interface Crumb {
  /** Concrete URL for this crumb. Empty string on the current page. */
  href: string
  label: string
  isCurrent: boolean
}

/**
 * Breadcrumb chain for the current pathname, derived from the route registry.
 * Routes marked `breadcrumb: false` are skipped.
 */
export function useBreadcrumbs(): Crumb[] {
  const { pathname } = useLocation()
  const { t } = useI18n()
  const overrides = useBreadcrumbOverrides()

  return useMemo(() => {
    const chain = getRouteChain(pathname).filter(
      (entry) => entry.route.breadcrumb !== false,
    )

    return chain.map((entry, i) => {
      const isCurrent = i === chain.length - 1
      return {
        href: isCurrent ? '' : entry.href,
        label: overrides[entry.href] ?? t(`routes.${entry.route.titleKey}`),
        isCurrent,
      }
    })
  }, [pathname, t, overrides])
}
