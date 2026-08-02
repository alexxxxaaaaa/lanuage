import { Link, useLocation } from 'react-router'

import { SidebarRow } from './SidebarRow'
import type { AuthUser } from '../../api/auth'

const HOME_PATH = '/'

type SidebarAccountProps = {
  user: AuthUser
  collapsed?: boolean
  /** Called after the row is clicked — the mobile menu uses it to close. */
  onNavigate?: () => void
}

/**
 * The sidebar's account entry: an ordinary nav row that happens to show
 * initials instead of an icon. It links to `/`, which is both the dashboard
 * and the account page — identity, sign out and AI usage all live there, so
 * there is no separate "Home" nav item below.
 *
 * The initials badge is hand-rolled rather than HeroUI's `<Avatar>` on
 * purpose. Avatar is a 32px disc with a solid `bg-default`, which next to the
 * 16px stroke icons in every other row reads as oversized, and — being opaque
 * — jumps in contrast whenever the row's own surface changes underneath it.
 * This badge is sized like an icon and tinted from `currentColor`, so it
 * tracks hover and selected exactly the way the lucide icons do.
 */
export function SidebarAccount({ user, collapsed = false, onNavigate }: SidebarAccountProps) {
  const { pathname } = useLocation()
  const active = pathname === HOME_PATH

  const displayName = user.username || '—'

  return (
    <SidebarRow
      as={Link}
      to={HOME_PATH}
      onClick={onNavigate}
      collapsed={collapsed}
      active={active}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? displayName : undefined}
      // Sets this row apart from the nav list below it — it is the account, not
      // one more destination in the same group.
      className="mb-2"
      icon={
        <span
          aria-hidden
          // Tailwind drops the opacity modifier on `bg-current`, so the mix is
          // spelled out — the badge tint has to follow the row's own colour.
          className="flex size-7 items-center justify-center rounded-full bg-[color-mix(in_oklab,currentColor_14%,transparent)] text-[11px] font-semibold"
        >
          {displayName.slice(0, 2).toUpperCase()}
        </span>
      }
      label={<span className="truncate font-semibold">{displayName}</span>}
    />
  )
}
