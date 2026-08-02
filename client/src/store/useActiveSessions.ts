import { useEffect } from 'react'
import { create } from 'zustand'

export type SessionKind = 'learn' | 'review'

export type ActiveSession = {
  kind: SessionKind
  folderId: string
  /** Items finished so far. */
  done: number
  /** Items the session started with. */
  total: number
}

type ActiveSessionState = {
  /** Keyed by the session's route — that is also its keep-alive key. */
  sessions: Record<string, ActiveSession>
  report: (path: string, session: ActiveSession) => void
  end: (path: string) => void
}

/**
 * Which learn/review sessions are half-finished right now, and how far along.
 *
 * Two consumers:
 *   - the wordlist page, so a card can offer “继续复习 3/12” instead of
 *     silently dropping the user back at the start;
 *   - `KeepAliveOutlet`, which never evicts a page listed here — the session
 *     lives in that page's component state, so evicting it would throw the
 *     progress away.
 *
 * An entry exists only while its page is mounted AND still has work left, so
 * the map stays as small as the number of sessions actually in flight.
 */
export const useActiveSessions = create<ActiveSessionState>((set) => ({
  sessions: {},
  report: (path, session) =>
    set((state) => {
      const prev = state.sessions[path]
      if (
        prev &&
        prev.kind === session.kind &&
        prev.folderId === session.folderId &&
        prev.done === session.done &&
        prev.total === session.total
      ) {
        return state
      }
      return { sessions: { ...state.sessions, [path]: session } }
    }),
  end: (path) =>
    set((state) => {
      if (!(path in state.sessions)) return state
      const next = { ...state.sessions }
      delete next[path]
      return { sessions: next }
    }),
}))

/** The route a wordlist's session lives on — also its keep-alive key. */
export function sessionPath(kind: SessionKind, folderId: string): string {
  return `/folders/${folderId}/${kind}`
}

/**
 * Publishes a session's progress for as long as there is progress to publish.
 * Pass `null` once the session is finished (or never started) — that clears
 * the entry and lets the page be evicted again.
 */
export function useReportSession(path: string, session: ActiveSession | null) {
  const { kind, folderId, done, total } = session ?? {}

  useEffect(() => {
    const { report, end } = useActiveSessions.getState()
    if (kind && folderId !== undefined && done !== undefined && total !== undefined) {
      report(path, { kind, folderId, done, total })
    } else {
      end(path)
    }
  }, [path, kind, folderId, done, total])

  // Unmount means the page was evicted (or the app tore down) — either way the
  // in-memory session is gone, so it must not keep advertising itself.
  useEffect(() => () => useActiveSessions.getState().end(path), [path])
}
