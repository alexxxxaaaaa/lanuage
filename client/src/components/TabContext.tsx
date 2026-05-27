import { createContext, useContext, useMemo } from 'react'
import { useTabsStore } from '../store/tabsStore'

type TabContextValue = {
  tabId: string
  setTitle: (title: string) => void
  /** true when this tab is the foreground tab. Pages can gate side effects
   *  like auto-scroll/scrollIntoView on this so they don't fight with the
   *  tab-system's per-tab scroll restore when the user switches back. */
  isActive: boolean
}

const TabContext = createContext<TabContextValue | null>(null)

export function TabProvider({
  tabId,
  isActive,
  children,
}: {
  tabId: string
  isActive: boolean
  children: React.ReactNode
}) {
  const value = useMemo<TabContextValue>(
    () => ({
      tabId,
      isActive,
      setTitle: (title: string) => useTabsStore.getState().setTitle(tabId, title),
    }),
    [tabId, isActive],
  )
  return <TabContext.Provider value={value}>{children}</TabContext.Provider>
}

// Returns the current tab's id + a setter to override its title. Pages can call
// this in an effect once their data loads, e.g. setTitle(podcast.title).
// Outside a tab (e.g. on /login) returns a no-op so callers don't crash.
export function useTab(): TabContextValue {
  const ctx = useContext(TabContext)
  if (ctx) return ctx
  return { tabId: '', setTitle: () => {}, isActive: true }
}
