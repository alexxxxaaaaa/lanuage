import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useLocation, useNavigate, useRoutes } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { useTabsStore, normPath } from '../store/tabsStore'
import { buildRoutes } from '../routesConfig'
import { TabProvider } from './TabContext'
import { TabStrip } from './TabStrip'

// One tab's content. Resolves the matching route element using the tab's path
// (decoupled from the browser URL — that's the whole point of keep-alive).
function TabContent({ path, routes }: { path: string; routes: ReturnType<typeof buildRoutes> }) {
  const element = useRoutes(routes, path)
  return element
}

export function TabbedRoot() {
  const location = useLocation()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const tabs = useTabsStore((s) => s.tabs)
  const activeId = useTabsStore((s) => s.activeId)
  // Per-tab window.scrollY. Saved on tab switch (synchronously, before React
  // commits the display:none/block swap so we read the OLD tab's scroll),
  // restored after the new tab paints. Tabs that haven't been visited yet
  // start at the top.
  const scrollByTab = useRef<Record<string, number>>({})

  const routes = useMemo(
    () => buildRoutes({ canSeePodcast: !!user?.canSeePodcast }),
    [user?.canSeePodcast],
  )

  // URL → tabs: ensure home tab exists, then open/activate the current URL.
  useEffect(() => {
    const store = useTabsStore.getState()
    if (!store.tabs.some((t) => t.path === '/')) {
      store.openOrActivate({ path: '/', title: '首页', closable: false })
    }
    const currentPath = normPath(location.pathname + (location.search || '') + (location.hash || ''))
    if (currentPath !== '/') {
      store.openOrActivate({ path: currentPath })
    } else {
      // Browser is at /, make sure home is the active tab.
      const home = useTabsStore.getState().tabs.find((t) => t.path === '/')
      if (home) store.activate(home.id)
    }
  }, [location.pathname, location.search])

  // active tab → URL: keep address bar in sync when user clicks a different
  // tab pill. Guarded by a path equality check to prevent loops with the effect
  // above.
  useEffect(() => {
    if (!activeId) return
    const active = useTabsStore.getState().tabs.find((t) => t.id === activeId)
    if (!active) return
    const currentPath = normPath(location.pathname + (location.search || '') + (location.hash || ''))
    if (active.path !== currentPath) {
      navigate(active.path)
    }
    // location intentionally omitted: this only reacts to active-tab changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  // Capture the outgoing tab's scrollY *synchronously* on store update — must
  // run before React commits the display swap, otherwise document height has
  // already collapsed and window.scrollY no longer reflects the old tab.
  useEffect(() => {
    const unsub = useTabsStore.subscribe((state, prev) => {
      if (state.activeId !== prev.activeId && prev.activeId) {
        scrollByTab.current[prev.activeId] = window.scrollY
      }
      // Garbage-collect entries for tabs that were just closed.
      const liveIds = new Set(state.tabs.map((t) => t.id))
      for (const id of Object.keys(scrollByTab.current)) {
        if (!liveIds.has(id)) delete scrollByTab.current[id]
      }
    })
    return unsub
  }, [])

  // Restore the incoming tab's scrollY after React commits (layout phase, pre
  // paint) so the user never sees the jump-to-top flash.
  useLayoutEffect(() => {
    if (!activeId) return
    const target = scrollByTab.current[activeId] ?? 0
    window.scrollTo({ top: target, left: 0, behavior: 'instant' as ScrollBehavior })
  }, [activeId])

  return (
    <>
      <TabStrip />
      <div className="tab-pages">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className="tab-page"
            style={{ display: tab.id === activeId ? 'block' : 'none' }}
          >
            <TabProvider tabId={tab.id}>
              <TabContent path={tab.path} routes={routes} />
            </TabProvider>
          </div>
        ))}
      </div>
    </>
  )
}
