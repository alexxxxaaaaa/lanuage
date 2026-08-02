import { ChevronRight } from 'lucide-react'
import { Fragment } from 'react'
import { Link } from 'react-router'

import { useBreadcrumbs } from '../../hooks/useBreadcrumbs'

/**
 * Topbar breadcrumb trail for the current route.
 *
 * Deliberately hand-rolled instead of using HeroUI's `<Breadcrumbs>`: that one
 * renders react-aria links off a plain `href`, which in a SPA means a full
 * page reload on every crumb click.
 *
 * The trail reads as one accent-coloured "you are here" at the end of a grey
 * path: ancestors are muted and only pick up colour plus a soft pill on hover,
 * so the eye lands on the current page first.
 */
export function TopbarBreadcrumbs() {
  const crumbs = useBreadcrumbs()
  if (crumbs.length === 0) return null

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center">
      <ol className="flex min-w-0 items-center gap-0.5">
        {crumbs.map((crumb, i) => (
          <Fragment key={crumb.isCurrent ? `current:${crumb.label}` : crumb.href}>
            {i > 0 && (
              <ChevronRight className="size-3.5 shrink-0 text-muted/50" aria-hidden />
            )}
            <li className="flex min-w-0 shrink items-center">
              {crumb.isCurrent ? (
                <span
                  aria-current="page"
                  className="truncate rounded-lg px-1.5 py-1 text-sm leading-5 font-semibold text-accent"
                >
                  {crumb.label}
                </span>
              ) : (
                <Link
                  to={crumb.href}
                  className="truncate rounded-lg px-1.5 py-1 text-sm leading-5 font-medium text-muted no-underline transition-colors hover:bg-foreground/6 hover:text-foreground"
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
