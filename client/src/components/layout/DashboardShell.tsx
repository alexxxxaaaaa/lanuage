import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'

import { KeepAliveOutlet } from './KeepAliveOutlet'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { BackstageNote } from '../BackstageNote'
import { QuickSearchFloat } from '../QuickSearchFloat'
import { Modal } from '../ui/Modal'
import type { AuthUser } from '../../api/auth'
import { APP_SCROLLER_ID } from '../../lib/scroll'
import { useSessionSync } from '../../hooks/useSessionSync'

const COLLAPSED_STORAGE_KEY = 'ws:sidebar-collapsed'

function readStoredCollapsed(): boolean {
  return window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === '1'
}

/**
 * Responsive app shell:
 *   - md+ : permanent left rail, collapsible to a 64px icon strip. The
 *           collapsed flag is persisted in localStorage.
 *   - <md : the rail lives in a fullscreen overlay opened from the topbar
 *           hamburger, dismissed by the close button, ESC, or a nav tap.
 *
 * The shell is `fixed inset-0`, so `<main>` — not the document — is the only
 * scrolling element. `KeepAliveOutlet` restores per-page offsets against it.
 */
export function DashboardShell({ user }: { user: AuthUser }) {
  const { pathname } = useLocation()
  const [collapsed, setCollapsed] = useState(readStoredCollapsed)
  const [isBackstageOpen, setIsBackstageOpen] = useState(false)
  const mainRef = useRef<HTMLElement>(null)

  useSessionSync()

  // The mobile menu is stored as "which route was it opened on" rather than a
  // boolean, so *any* navigation closes it by derivation — including ones that
  // don't go through a nav row (breadcrumb, in-page link, browser Back). A
  // boolean would need an effect to reset it, which is a cascading render.
  const [menuOpenedAt, setMenuOpenedAt] = useState<string | null>(null)
  const mobileOpen = menuOpenedAt === pathname
  const closeMenu = () => setMenuOpenedAt(null)

  // Body scroll lock + ESC-to-close while the mobile menu is open.
  useEffect(() => {
    if (!mobileOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpenedAt(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [mobileOpen])

  // `Z` anywhere outside a field toggles the backstage note.
  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)
      ) {
        return
      }
      if (event.key.toLowerCase() !== 'z' || event.ctrlKey || event.metaKey || event.altKey) return
      event.preventDefault()
      setIsBackstageOpen((prev) => !prev)
    }
    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [])

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev
      window.localStorage.setItem(COLLAPSED_STORAGE_KEY, next ? '1' : '0')
      return next
    })
  }

  return (
    <div className="fixed inset-0 flex bg-background text-foreground">
      {/* Desktop rail */}
      <div className="hidden md:flex">
        <Sidebar
          user={user}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          onOpenBackstage={() => setIsBackstageOpen(true)}
        />
      </div>

      {/* Mobile fullscreen menu */}
      {mobileOpen && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 md:hidden">
          <Sidebar user={user} mobile onClose={closeMenu} />
        </div>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenMenu={() => setMenuOpenedAt(pathname)} />
        <main
          id={APP_SCROLLER_ID}
          ref={mainRef}
          className="min-h-0 flex-1 overflow-auto overscroll-contain px-6 pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom))] pr-[max(1.5rem,env(safe-area-inset-right))] max-md:px-4"
        >
          <KeepAliveOutlet scrollRef={mainRef} />
        </main>
      </div>

      {/* The add-word page already is the full version of this popup. */}
      {pathname !== '/words/new' && <QuickSearchFloat />}
      <Modal isOpen={isBackstageOpen} size="full" onClose={() => setIsBackstageOpen(false)}>
        <BackstageNote />
      </Modal>
    </div>
  )
}
