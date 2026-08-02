import { Button } from '@heroui/react'
import { ChevronsLeft, Code, X } from 'lucide-react'

import { SidebarAccount } from './SidebarAccount'
import { SidebarNav } from './SidebarNav'
import { SidebarRow } from './SidebarRow'
import type { AuthUser } from '../../api/auth'
import { useI18n } from '../../i18n'

type SidebarProps = {
  user: AuthUser
  /** Desktop collapsed-rail mode. Ignored when `mobile` is true. */
  collapsed?: boolean
  /** Desktop only — toggles the collapsed state. Hidden when not provided. */
  onToggleCollapsed?: () => void
  /** Desktop only — opens the backstage note. Hidden when not provided. */
  onOpenBackstage?: () => void
  /** Mobile fullscreen mode — fills the viewport, shows a close affordance. */
  mobile?: boolean
  /** Called when the user navigates or explicitly closes the mobile overlay. */
  onClose?: () => void
}

/**
 * One component, two layouts:
 *
 *   - Desktop (`mobile=false`): a floating surface card inset 16px from the
 *     viewport, in a rail that is 256px wide expanded and 84px collapsed.
 *     The collapsed width is not a free choice — it is exactly what the
 *     horizontal steps add up to (see `SidebarRow`), so the row fits the card
 *     without clipping and icons stay put across the transition.
 *
 *   - Mobile (`mobile=true`): the same rows rendered fullscreen with an
 *     explicit close button, no card. The collapse toggle is hidden — the
 *     whole menu is dismissable via the close button or by tapping a nav item.
 */
export function Sidebar({
  user,
  collapsed = false,
  onToggleCollapsed,
  onOpenBackstage,
  mobile = false,
  onClose,
}: SidebarProps) {
  const { t } = useI18n()
  const isCollapsed = !mobile && collapsed

  const rows = (
    <>
      {/* Unpadded: the 40px icon button lands in the rows' own icon column. */}
      {mobile && (
        <div className="flex h-14 shrink-0 items-center">
          <Button isIconOnly variant="ghost" aria-label={t('sidebar.closeMenu')} onPress={onClose}>
            <X className="size-5" aria-hidden />
          </Button>
        </div>
      )}

      <SidebarAccount user={user} collapsed={isCollapsed} onNavigate={onClose} />

      <SidebarNav collapsed={isCollapsed} onNavigate={onClose} />

      {onOpenBackstage && !mobile && (
        <SidebarRow
          as="button"
          type="button"
          onClick={onOpenBackstage}
          collapsed={isCollapsed}
          className="text-muted"
          label={t('backstage.label')}
          title={t('backstage.tooltip')}
          icon={<Code className="size-4" aria-hidden />}
        />
      )}

      {onToggleCollapsed && !mobile && (
        <SidebarRow
          as="button"
          type="button"
          onClick={onToggleCollapsed}
          label={null}
          collapsed={isCollapsed}
          className="text-muted"
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
    </>
  )

  if (mobile) {
    return (
      <aside
        data-mobile
        aria-label={t('sidebar.primaryNav')}
        className="flex h-full w-full flex-col bg-background px-4 pl-[max(1rem,env(safe-area-inset-left))]"
      >
        {rows}
      </aside>
    )
  }

  return (
    <aside
      data-collapsed={isCollapsed || undefined}
      aria-label={t('sidebar.primaryNav')}
      className={
        'h-full shrink-0 p-3 pl-[max(0.75rem,env(safe-area-inset-left))] ' +
        'transition-[width] duration-200 ease-out ' +
        (isCollapsed ? 'w-21' : 'w-64')
      }
    >
      {/* Opaque `bg-surface`, not frosted glass: the shell background is a
          flat colour and nothing scrolls behind the rail, so a backdrop blur
          would cost a compositor layer and render nothing.

          `p-1.5` is what keeps a selected row's tint clear of the 24px corner
          curve — see the step table in `SidebarRow`. */}
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-3xl border border-border/60 bg-surface p-1.5 shadow-overlay">
        {rows}
      </div>
    </aside>
  )
}
