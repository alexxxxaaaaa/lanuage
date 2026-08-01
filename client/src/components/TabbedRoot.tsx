import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useLocation, useNavigate, useRoutes } from 'react-router'
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

  // Track latest scroll position via a scroll listener. We DON'T just read
  // window.scrollY — CSS in this app (overflow-x: clip on #root, etc.) means
  // the actual scrolling element can be document.scrollingElement, body, or
  // #root rather than the viewport itself. Use document-level capture phase
  // so we catch the event no matter which ancestor scrolls.
  const liveScrollRef = useRef(0)
  const readScroll = () =>
    document.scrollingElement?.scrollTop ??
    window.scrollY ??
    document.documentElement?.scrollTop ??
    document.body?.scrollTop ??
    0
  const doScroll = (top: number) => {
    window.scrollTo(0, top)
    if (document.scrollingElement) document.scrollingElement.scrollTop = top
    if (document.documentElement) document.documentElement.scrollTop = top
    if (document.body) document.body.scrollTop = top
    const root = document.getElementById('root')
    if (root) root.scrollTop = top
  }
  useEffect(() => {
    liveScrollRef.current = readScroll()
    const onScroll = () => {
      liveScrollRef.current = readScroll()
    }
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () =>
      document.removeEventListener('scroll', onScroll, { capture: true })
  }, [])

  // Save the outgoing tab's scrollY on every store update where activeId
  // actually moves. Uses the live ref above instead of reading scrollY again.
  useEffect(() => {
    const unsub = useTabsStore.subscribe((state, prev) => {
      if (state.activeId !== prev.activeId && prev.activeId) {
        scrollByTab.current[prev.activeId] = liveScrollRef.current
      }
      // Garbage-collect entries for tabs that were just closed.
      const liveIds = new Set(state.tabs.map((t) => t.id))
      for (const id of Object.keys(scrollByTab.current)) {
        if (!liveIds.has(id)) delete scrollByTab.current[id]
      }
    })
    return unsub
  }, [])

  // Disable the browser's own scroll-restoration so it doesn't fight us on
  // back/forward navigation between tabs.
  useEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual'
    }
  }, [])

  // Restore the incoming tab's scrollY after React commits. We fire BOTH a
  // sync scrollTo (immediately after DOM commit) AND a rAF retry, because in
  // some browsers the document height needs one paint frame to reflect the
  // newly-visible tab's content — the first scrollTo gets clamped if the
  // doc is still measuring the OLD tab.
  useLayoutEffect(() => {
    if (!activeId) return
    const target = scrollByTab.current[activeId] ?? 0
    // Single sync scroll. We do NOT retry in a later rAF — if we did, that
    // retry would fire AFTER child pages' useEffects (e.g. PodcastDetailPage's
    // scrollIntoView for the current playing line) and undo their work,
    // bouncing the page back to top.
    doScroll(target)
    liveScrollRef.current = target
    // doScroll / readScroll are stable module-level-style helpers; safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            <TabProvider tabId={tab.id} isActive={tab.id === activeId}>
              <TabContent path={tab.path} routes={routes} />
            </TabProvider>
          </div>
        ))}
      </div>
    </>
  )
}
