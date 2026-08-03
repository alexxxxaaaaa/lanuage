import { useEffect } from 'react'

import { fetchMe } from '../api/auth'
import { useAppStore } from '../store/useAppStore'
import { useAuthStore } from '../store/authStore'
import { useSettings } from '../store/useSettings'

/**
 * Session-scoped background work for a signed-in shell:
 *
 *  1. Re-reads `/me` on mount so a server-side change to the account (the
 *     admin flag) takes effect without a re-login，同时和账号里的设置对一次账
 *     （启动时先用的是本机快照，见 store/useSettings.ts）。
 *  2. Refreshes today's review queue when the calendar day rolls over. With
 *     keep-alive pages the app can stay mounted for days, so the cached queue
 *     would otherwise be 24h stale when the user comes back next morning.
 *
 * The day-rollover check listens on several signals because no single one
 * catches every "the user came back" case:
 *   - visibilitychange — tab switch / minimise-restore
 *   - focus            — window regains focus (laptop wake, no tab switch)
 *   - pageshow         — restored from BFCache (Back after navigating away)
 *   - online           — network reconnect, typical after sleep
 *   - a 60s interval   — midnight passing while the tab is in the foreground
 */
export function useSessionSync(): void {
  const token = useAuthStore((s) => s.token)
  const setUser = useAuthStore((s) => s.setUser)

  useEffect(() => {
    if (!token) return
    fetchMe()
      .then(setUser)
      .catch(() => {})
    void useSettings.getState().sync()
  }, [token, setUser])

  useEffect(() => {
    if (!token) return
    const localDate = () => {
      const d = new Date()
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    }
    let lastDate = localDate()
    const refreshIfRolled = () => {
      const today = localDate()
      if (today === lastDate) return
      lastDate = today
      void useAppStore.getState().fetchTodayReviews()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshIfRolled()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', refreshIfRolled)
    window.addEventListener('pageshow', refreshIfRolled)
    window.addEventListener('online', refreshIfRolled)
    const tick = window.setInterval(refreshIfRolled, 60_000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', refreshIfRolled)
      window.removeEventListener('pageshow', refreshIfRolled)
      window.removeEventListener('online', refreshIfRolled)
      window.clearInterval(tick)
    }
  }, [token])
}
