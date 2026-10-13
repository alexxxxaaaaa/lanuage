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
 *
 * 手机上只留当前页。原来所有层级都能收缩，窄屏下按比例挤到最后，被压没的
 * 恰恰是最右边的当前页 —— 实机上看到的是「JLPT ›」后面一片空白。祖先层级
 * 在手机上整条藏掉（连同分隔符），当前页则永不收缩、只截断，宽度优先给它。
 * 手机上要往上走有汉堡菜单，不靠面包屑。
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
              <ChevronRight
                className="hidden size-3.5 shrink-0 text-muted/50 md:block"
                aria-hidden
              />
            )}
            <li
              className={
                crumb.isCurrent
                  ? 'flex min-w-0 shrink items-center'
                  : 'hidden min-w-0 shrink items-center md:flex'
              }
            >
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
