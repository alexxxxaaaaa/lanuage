import { Button } from '@heroui/react'
import { ChevronsLeft, X } from 'lucide-react'

import { SidebarLogout } from './SidebarLogout'
import { SidebarNav } from './SidebarNav'
import { SidebarRow } from './SidebarRow'
import { SidebarUserCard } from './SidebarUserCard'
import type { AuthUser } from '../../api/auth'
import { useI18n } from '../../i18n'

type SidebarProps = {
  user: AuthUser
  /** Desktop collapsed-rail mode. Ignored when `mobile` is true. */
  collapsed?: boolean
  /** Desktop only — toggles the collapsed state. Hidden when not provided. */
  onToggleCollapsed?: () => void
  /** Mobile fullscreen mode — fills the viewport, shows a close affordance. */
  mobile?: boolean
  /** Called when the user navigates or explicitly closes the mobile overlay. */
  onClose?: () => void
}

/**
 * One component, two layouts:
 *
 *   - Desktop (`mobile=false`): a fixed-width left rail (`w-64`) collapsible
 *     to a 64px icon strip. Icons stay pinned in their 64px column across the
 *     transition; only the trailing labels fade out.
 *
 *   - Mobile (`mobile=true`): the same rail rendered full-width with an
 *     explicit close button. The collapse toggle is hidden — the whole menu
 *     is dismissable via the close button or by tapping a nav item.
 */
export function Sidebar({
  user,
  collapsed = false,
  onToggleCollapsed,
  mobile = false,
  onClose,
}: SidebarProps) {
  const { t } = useI18n()
  const isCollapsed = !mobile && collapsed

  return (
    <aside
      data-collapsed={isCollapsed || undefined}
      data-mobile={mobile || undefined}
      className={
        'flex h-full flex-col overflow-hidden border-r border-border bg-surface ' +
        'pl-[env(safe-area-inset-left)] transition-[width] duration-200 ease-out ' +
        (mobile ? 'w-full border-r-0' : isCollapsed ? 'w-16' : 'w-64')
      }
      aria-label={t('sidebar.primaryNav')}
    >
      {mobile && (
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
          <Button isIconOnly variant="ghost" aria-label={t('sidebar.closeMenu')} onPress={onClose}>
            <X className="size-5" aria-hidden />
          </Button>
        </div>
      )}

      <SidebarUserCard user={user} collapsed={isCollapsed} />

      <SidebarNav collapsed={isCollapsed} onNavigate={onClose} />

      <SidebarLogout collapsed={isCollapsed} />

      {onToggleCollapsed && !mobile && (
        <SidebarRow
          as="button"
          type="button"
          onClick={onToggleCollapsed}
          label={null}
          collapsed={isCollapsed}
          title={isCollapsed ? t('sidebar.expand') : t('sidebar.collapse')}
          aria-label={isCollapsed ? t('sidebar.expand') : t('sidebar.collapse')}
          icon={
            <ChevronsLeft
              className={
                'size-4 transition-transform duration-200 ' + (isCollapsed ? 'rotate-180' : '')
              }
              aria-hidden
            />
          }
        />
      )}
    </aside>
  )
}
