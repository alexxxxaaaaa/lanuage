import { create } from 'zustand'

// Tabs persist mounted React trees across route changes. Each open URL gets at
// most one tab; navigating to a URL activates its tab or creates a new one.
// Closing a tab unmounts that tree (its component state is discarded).

export type Tab = {
  id: string
  path: string  // full path + search (the "address" of the tab)
  title: string // shown in the tab pill; can be updated by the page itself
  closable: boolean
}

type TabsState = {
  tabs: Tab[]
  activeId: string | null
  openOrActivate: (input: { path: string; title?: string; closable?: boolean }) => string
  activate: (id: string) => void
  close: (id: string) => string | null  // returns the id to navigate to next (or null)
  setTitle: (id: string, title: string) => void
  closeOthers: (id: string) => void
  closeAll: () => void
}

const genId = () => `tab-${Math.random().toString(36).slice(2, 9)}`

// Normalize so /foo and /foo?x=1 are distinct, but /foo and /foo/ collapse.
// Preserves the #hash because pages like FolderDetailPage scroll to a target
// word based on it.
function normPath(p: string): string {
  if (!p) return '/'
  // Split off hash first, then query — preserves both for the returned path.
  const [pathAndQuery, hashPart = ''] = p.split('#')
  const [pathPart, queryPart = ''] = pathAndQuery.split('?')
  const cleanedPath = pathPart === '/' ? '/' : pathPart.replace(/\/+$/, '')
  let result = cleanedPath
  if (queryPart) result += `?${queryPart}`
  if (hashPart) result += `#${hashPart}`
  return result
}

// Paths where ANY query string / sub-context should collapse into one tab.
// You only ever do one search / one learn session / one review session at a
// time, so opening "查 foo" then "查 bar" should re-use the same tab instead
// of spawning N tabs. Each navigation refreshes the tab's path so the page
// sees the new query.
const SINGLETON_PATHS = [
  '/words/search',
  '/learn',
  '/review',
  '/grammar/learn',
  '/grammar/review',
]

function pathnameOf(p: string): string {
  const hashIdx = p.indexOf('#')
  const noHash = hashIdx >= 0 ? p.slice(0, hashIdx) : p
  const qIdx = noHash.indexOf('?')
  return qIdx >= 0 ? noHash.slice(0, qIdx) : noHash
}

// Identity key for tab dedup. Default: pathname + search (so different folders
// are separate tabs). For singleton paths above: just pathname (so any query
// for the same page collapses).
function dedupKey(p: string): string {
  const pathname = pathnameOf(p)
  if (SINGLETON_PATHS.includes(pathname)) return pathname
  const hashIdx = p.indexOf('#')
  return hashIdx >= 0 ? p.slice(0, hashIdx) : p
}

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  activeId: null,

  openOrActivate: ({ path, title, closable = true }) => {
    const normalized = normPath(path)
    const key = dedupKey(normalized)
    const existing = get().tabs.find((t) => dedupKey(t.path) === key)
    if (existing) {
      // Update path so the latest hash (e.g. #word-xyz) or query (e.g. ?q=foo
      // on the singleton search tab) reaches the page — useRoutes uses tab.path
      // as the synthetic location.
      // Also sweep up any *other* tabs that share this dedup key — happens
      // when an old session left multiple /words/search?q=... tabs around
      // before this dedup rule was introduced. Collapse them into one.
      const duplicates = get().tabs.filter(
        (t) => t.id !== existing.id && dedupKey(t.path) === key,
      )
      set((s) => ({
        activeId: existing.id,
        tabs: s.tabs
          .filter((t) => !duplicates.some((d) => d.id === t.id))
          .map((t) =>
            t.id === existing.id
              ? { ...t, path: normalized, title: title ?? t.title }
              : t,
          ),
      }))
      return existing.id
    }
    const tab: Tab = {
      id: genId(),
      path: normalized,
      title: title ?? deriveTitle(normalized),
      closable,
    }
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }))
    return tab.id
  },

  activate: (id) => {
    if (get().tabs.some((t) => t.id === id)) {
      set({ activeId: id })
    }
  },

  close: (id) => {
    const { tabs, activeId } = get()
    const idx = tabs.findIndex((t) => t.id === id)
    if (idx < 0) return null
    const tab = tabs[idx]
    if (!tab.closable) return null
    const nextTabs = tabs.filter((t) => t.id !== id)
    let nextActiveId = activeId
    if (activeId === id) {
      // Pick the tab to the left, or right if closing the leftmost.
      const neighbor = nextTabs[idx - 1] ?? nextTabs[idx] ?? null
      nextActiveId = neighbor?.id ?? null
    }
    set({ tabs: nextTabs, activeId: nextActiveId })
    return nextActiveId
  },

  setTitle: (id, title) => {
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, title } : t)),
    }))
  },

  closeOthers: (id) => {
    set((s) => ({
      tabs: s.tabs.filter((t) => t.id === id || !t.closable),
      activeId: id,
    }))
  },

  closeAll: () => {
    set((s) => {
      const kept = s.tabs.filter((t) => !t.closable)
      return {
        tabs: kept,
        activeId: kept[0]?.id ?? null,
      }
    })
  },
}))

// Fallback labels when a tab opens before its page component has set a title.
const STATIC_TITLES: Array<{ test: RegExp; title: string }> = [
  { test: /^\/$/, title: '首页' },
  { test: /^\/folders$/, title: '分类' },
  { test: /^\/folders\/[^/?]+/, title: '分类详情' },
  { test: /^\/words\/new$/, title: '新增单词' },
  { test: /^\/words\/search/, title: '查词' },
  { test: /^\/learn/, title: '学习' },
  { test: /^\/review/, title: '复习' },
  { test: /^\/ai-usage/, title: 'AI 用量' },
  { test: /^\/notes$/, title: '笔记' },
  { test: /^\/notes\//, title: '笔记详情' },
  { test: /^\/expressions$/, title: '表达' },
  { test: /^\/expressions\//, title: '表达详情' },
  { test: /^\/grammar$/, title: '语法' },
  { test: /^\/grammar\/learn/, title: '语法学习' },
  { test: /^\/grammar\/review/, title: '语法复习' },
  { test: /^\/grammar\//, title: '语法详情' },
  { test: /^\/podcasts$/, title: '播客' },
  { test: /^\/podcasts\//, title: '播客详情' },
]

function deriveTitle(path: string): string {
  for (const entry of STATIC_TITLES) {
    if (entry.test.test(path)) return entry.title
  }
  return path
}

export { normPath }
