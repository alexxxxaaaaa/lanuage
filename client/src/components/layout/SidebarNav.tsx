import { Link, useLocation } from 'react-router'

import { SidebarRow } from './SidebarRow'
import { useI18n } from '../../i18n'
import { SIDEBAR_ROUTES, isRouteVisible } from '../../lib/routes'
import { useAuthStore } from '../../store/authStore'

type SidebarNavProps = {
  collapsed?: boolean
  /** Called after a nav item is clicked — the mobile menu uses it to close. */
  onNavigate?: () => void
}

export function SidebarNav({ collapsed = false, onNavigate }: SidebarNavProps) {
  const { t } = useI18n()
  const { pathname } = useLocation()
  const canSeePodcast = useAuthStore((s) => !!s.user?.canSeePodcast)

  const visibleRoutes = SIDEBAR_ROUTES.filter((route) =>
    isRouteVisible(route, { podcast: canSeePodcast }),
  )

  return (
    <nav
      className="flex-1 overflow-x-hidden overflow-y-auto py-2"
      aria-label={t('sidebar.primaryNav')}
    >
      <ul className="flex flex-col">
        {visibleRoutes.map((route) => {
          const Icon = route.icon
          // `/` would otherwise prefix-match every path, so it is exact-only.
          const active =
            route.path === '/'
              ? pathname === '/'
              : pathname === route.path || pathname.startsWith(`${route.path}/`)
          return (
            <li key={route.path}>
              <SidebarRow
                as={Link}
                to={route.path}
                onClick={onNavigate}
                collapsed={collapsed}
                active={active}
                tone="accent"
                icon={Icon ? <Icon className="size-4" aria-hidden /> : null}
                label={t(`routes.${route.titleKey}`)}
              />
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
