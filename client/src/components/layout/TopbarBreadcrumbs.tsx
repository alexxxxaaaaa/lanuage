import { ChevronRight } from 'lucide-react'
import { Fragment } from 'react'
import { Link } from 'react-router'

import { useBreadcrumbs } from '../../hooks/useBreadcrumbs'

/**
 * Topbar breadcrumb trail for the current route.
 *
 * Deliberately hand-rolled instead of using HeroUI's `<Breadcrumbs>`: that one
 * renders react-aria links off a plain `href`, which in a SPA means a full
 * page reload on every crumb click. The classes below mirror HeroUI's own
 * breadcrumbs stylesheet so the two are visually indistinguishable.
 */
export function TopbarBreadcrumbs() {
  const crumbs = useBreadcrumbs()
  if (crumbs.length === 0) return null

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center">
      <ol className="flex min-w-0 items-center">
        {crumbs.map((crumb, i) => (
          <Fragment key={crumb.isCurrent ? `current:${crumb.label}` : crumb.href}>
            {i > 0 && (
              <ChevronRight className="size-3 shrink-0 text-muted" aria-hidden />
            )}
            <li className="flex min-w-0 shrink items-center justify-center gap-0.5 px-0.5">
              {crumb.isCurrent ? (
                <span
                  aria-current="page"
                  className="truncate px-0.5 text-sm leading-5 font-medium text-link"
                >
                  {crumb.label}
                </span>
              ) : (
                <Link
                  to={crumb.href}
                  className="truncate px-0.5 text-sm leading-5 font-medium text-muted no-underline hover:underline"
                >
                  {crumb.label}
                </Link>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  )
}
