import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { Navigate, useLocation, useRoutes, type RouteObject } from 'react-router'

import { PageActiveContext } from './pageContext'
import { ROUTES, matchRoute } from '../../lib/routes'
import { useActiveSessions } from '../../store/useActiveSessions'

/** `ROUTES` in the shape `useRoutes` wants. Every page is reachable by every
 *  signed-in account, so this is a constant rather than a per-user table. */
const ROUTE_OBJECTS: RouteObject[] = ROUTES.map((r) => ({
  path: r.path,
  element: r.element,
}))

/**
 * How many pages stay mounted in the background. Each kept page holds its own
 * React tree, fetched data and DOM, so this is a memory ceiling, not a
 * correctness knob — the least-recently-viewed page beyond it is dropped and
 * simply re-fetches next time.
 */
const MAX_KEPT_PAGES = 10

/** Always kept: it is the landing page and the fallback for every eviction. */
const PINNED_KEY = '/'

type Entry = {
  /** Identity of a kept-alive page — its pathname, ignoring query and hash. */
  key: string
  /** Full path+search+hash last seen for this key; frozen while in background. */
  location: string
  /** Visit counter, for LRU eviction. Never affects render order. */
  seq: number
}

/**
 * Appends or refreshes `key` and drops the least-recently-visited entries once
 * the list is over budget.
 *
 * Render order is strictly insertion order and recency is tracked in `seq`
 * instead: reordering the array would make React move the corresponding DOM
 * nodes, and moving a node tears down and re-creates it — which would
 * interrupt a podcast playing in a backgrounded page.
 */
function upsert(entries: Entry[], key: string, location: string): Entry[] {
  const seq = entries.reduce((max, e) => Math.max(max, e.seq), 0) + 1
  const exists = entries.some((e) => e.key === key)
  const next = exists
    ? entries.map((e) => (e.key === key ? { ...e, location, seq } : e))
    : [...entries, { key, location, seq }]

  if (next.length <= MAX_KEPT_PAGES) return next
  // A half-finished learn/review session lives in its page's component state,
  // so evicting that page silently discards it. Those pages stay regardless of
  // recency — the budget is a memory hint, not a promise, and the exemption is
  // bounded by how many sessions the user can realistically have open.
  const busy = useActiveSessions.getState().sessions
  // Never evict the pinned page or the one being navigated to.
  const evictable = next
    .filter((e) => e.key !== PINNED_KEY && e.key !== key && !(e.key in busy))
    .sort((a, b) => a.seq - b.seq)
  const dropped = new Set(
    evictable.slice(0, next.length - MAX_KEPT_PAGES).map((e) => e.key),
  )
  return next.filter((e) => !dropped.has(e.key))
}

/** One kept-alive page, resolved against its own frozen location. */
function KeepAlivePage({
  location,
  isActive,
}: {
  location: string
  isActive: boolean
}) {
  // Passing an explicit location makes react-router install a matching
  // LocationContext for this subtree, so a background page keeps reading its
  // own params from `useParams` / `useSearchParams` rather than the address
  // bar's.
  const element = useRoutes(ROUTE_OBJECTS, location)
  return (
    <div style={{ display: isActive ? 'block' : 'none' }}>
      <PageActiveContext.Provider value={isActive}>{element}</PageActiveContext.Provider>
    </div>
  )
}

/**
 * Renders the routed page, keeping recently-visited pages mounted so their
 * state (scroll position, filters, half-finished forms, loaded lists) survives
 * navigating away and back.
 *
 * Replaces the old multi-tab shell: same keep-alive behaviour, no tab strip —
 * one page on screen at a time, exactly like a conventional console.
 */
export function KeepAliveOutlet({
  scrollRef,
}: {
  /** The shell's scrolling element, so scroll offsets restore per page. */
  scrollRef: RefObject<HTMLElement | null>
}) {
  const { pathname, search, hash } = useLocation()
  const fullPath = pathname + search + hash

  const match = matchRoute(pathname)
  const keepAlive = match !== null && match.route.keepAlive !== false

  const [entries, setEntries] = useState<Entry[]>([])
  const [seenPath, setSeenPath] = useState<string | null>(null)

  // Adjusting state during render (rather than in an effect) so the incoming
  // page is present in the very first committed render — an effect would paint
  // one empty frame first.
  if (seenPath !== fullPath) {
    setSeenPath(fullPath)
    if (keepAlive) setEntries((prev) => upsert(prev, pathname, fullPath))
  }

  const activeKey = keepAlive ? pathname : null

  // --- per-page scroll offsets ---------------------------------------------
  const scrollByKey = useRef<Record<string, number>>({})
  const liveScroll = useRef(0)
  const prevKeyRef = useRef<string | null>(null)

  // Track the live offset continuously. Reading it at switch time instead of
  // asking the DOM avoids the value being clamped to 0 by the display swap
  // that already happened.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      liveScroll.current = el.scrollTop
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [scrollRef])

  // Save the outgoing page's offset, restore the incoming one's.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const prev = prevKeyRef.current
    if (prev && prev !== activeKey) scrollByKey.current[prev] = liveScroll.current
    prevKeyRef.current = activeKey
    const target = activeKey ? (scrollByKey.current[activeKey] ?? 0) : 0
    el.scrollTop = target
    liveScroll.current = target
  }, [activeKey, scrollRef])

  // Drop offsets for pages that have been evicted.
  useEffect(() => {
    const live = new Set(entries.map((e) => e.key))
    for (const key of Object.keys(scrollByKey.current)) {
      if (!live.has(key)) delete scrollByKey.current[key]
    }
  }, [entries])

  // Let the browser's own restoration stay out of the way — offsets above are
  // authoritative, including on back/forward.
  useEffect(() => {
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual'
    }
  }, [])

  if (match === null) return <Navigate to="/" replace />

  return (
    <>
      {entries.map((entry) => (
        <KeepAlivePage
          key={entry.key}
          location={entry.location}
          isActive={entry.key === activeKey}
        />
      ))}
      {/* Routes opted out of keep-alive render fresh on every visit and are
          torn down as soon as the user leaves. */}
      {!keepAlive && <FreshPage location={fullPath} />}
    </>
  )
}

function FreshPage({ location }: { location: string }) {
  return useRoutes(ROUTE_OBJECTS, location)
}
