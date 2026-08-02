import { useEffect } from 'react'
import { useLocation } from 'react-router'
import { create } from 'zustand'

import { sectionOf } from '../lib/routes'

type SectionLocationState = {
  /** Sidebar section path → the full location last visited inside it. */
  bySection: Record<string, string>
  remember: (section: string, location: string) => void
}

/**
 * Where the user last was inside each sidebar section.
 *
 * The pages themselves stay mounted (`KeepAliveOutlet`), so returning to a
 * section is only a matter of navigating back to the *exact* location that
 * page was left at — a wordlist's review at the card it was paused on, the
 * search page with its query still in the URL. Landing on the section root
 * instead would swap the query out from under the kept page and reset it.
 *
 * Deliberately in memory only: it mirrors keep-alive, which does not survive
 * a reload either, so a fresh load starts every section at its root.
 */
export const useSectionLocations = create<SectionLocationState>((set) => ({
  bySection: {},
  remember: (section, location) =>
    set((state) =>
      state.bySection[section] === location
        ? state
        : { bySection: { ...state.bySection, [section]: location } },
    ),
}))

/** Records the current location against the sidebar section it belongs to. */
export function useRememberSectionLocation(): void {
  const { pathname, search, hash } = useLocation()

  useEffect(() => {
    const section = sectionOf(pathname)
    if (!section) return
    useSectionLocations.getState().remember(section, pathname + search + hash)
  }, [pathname, search, hash])
}
