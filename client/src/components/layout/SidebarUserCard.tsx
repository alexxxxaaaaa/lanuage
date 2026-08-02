import { Avatar } from '@heroui/react'

import type { AuthUser } from '../../api/auth'

type SidebarUserCardProps = {
  user: AuthUser
  collapsed?: boolean
}

export function SidebarUserCard({ user, collapsed = false }: SidebarUserCardProps) {
  const displayName = user.username
  const initials = displayName.slice(0, 2).toUpperCase() || '?'

  return (
    <div
      className="mt-3 flex h-16 shrink-0 items-center"
      title={collapsed ? displayName : undefined}
    >
      <div className="flex h-16 w-16 shrink-0 items-center justify-center">
        <Avatar size="md" className="shrink-0">
          <Avatar.Fallback>{initials}</Avatar.Fallback>
        </Avatar>
      </div>
      <div
        aria-hidden={collapsed || undefined}
        className={
          'min-w-0 flex-1 pr-3 transition-[opacity,transform] duration-200 ' +
          (collapsed
            ? 'pointer-events-none -translate-x-1 opacity-0'
            : 'translate-x-0 opacity-100')
        }
      >
        <p className="truncate text-base leading-none font-semibold">{displayName}</p>
        <p className="mt-1.5 truncate text-xs text-muted">Word Sprint</p>
      </div>
    </div>
  )
}
