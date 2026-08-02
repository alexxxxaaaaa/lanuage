import { Link, useLocation } from 'react-router'

import { SidebarRow } from './SidebarRow'
import { useI18n } from '../../i18n'
import { SIDEBAR_ROUTES, sectionOf } from '../../lib/routes'
import { useSectionLocations } from '../../store/useSectionLocations'

type SidebarNavProps = {
  collapsed?: boolean
  /** Called after a nav item is clicked — the mobile menu uses it to close. */
  onNavigate?: () => void
}

export function SidebarNav({ collapsed = false, onNavigate }: SidebarNavProps) {
  const { t } = useI18n()
  const { pathname } = useLocation()
  const lastVisited = useSectionLocations((state) => state.bySection)
  const currentSection = sectionOf(pathname)

  return (
    <nav
      className="flex-1 overflow-x-hidden overflow-y-auto py-1"
      aria-label={t('sidebar.primaryNav')}
    >
      <ul className="flex flex-col gap-0.5">
        {SIDEBAR_ROUTES.map((route) => {
          const Icon = route.icon
          const active = currentSection === route.path
          return (
            <li key={route.path}>
              <SidebarRow
                as={Link}
                // Coming from elsewhere resumes the section where it was left
                // — the page is still mounted, and its own URL is what keeps
                // it that way. Clicking the section you are already in is the
                // way back out to its root.
                to={active ? route.path : (lastVisited[route.path] ?? route.path)}
                onClick={onNavigate}
                collapsed={collapsed}
                active={active}
                aria-current={active ? 'page' : undefined}
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
