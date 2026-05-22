import { createContext, useContext, useMemo } from 'react'
import { useTabsStore } from '../store/tabsStore'

type TabContextValue = {
  tabId: string
  setTitle: (title: string) => void
}

const TabContext = createContext<TabContextValue | null>(null)

export function TabProvider({
  tabId,
  children,
}: {
  tabId: string
  children: React.ReactNode
}) {
  const value = useMemo<TabContextValue>(
    () => ({
      tabId,
      setTitle: (title: string) => useTabsStore.getState().setTitle(tabId, title),
    }),
    [tabId],
  )
  return <TabContext.Provider value={value}>{children}</TabContext.Provider>
}

// Returns the current tab's id + a setter to override its title. Pages can call
// this in an effect once their data loads, e.g. setTitle(podcast.title).
// Outside a tab (e.g. on /login) returns a no-op so callers don't crash.
export function useTab(): TabContextValue {
  const ctx = useContext(TabContext)
  if (ctx) return ctx
  return { tabId: '', setTitle: () => {} }
}
