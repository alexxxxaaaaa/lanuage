import { apiClient } from './client'
import type {
  Podcast,
  PodcastSummary,
  YoutubeInspectResult,
} from '../types'

export async function listPodcasts() {
  const r = await apiClient.get<PodcastSummary[]>('/api/podcasts')
  return r.data
}

export async function getPodcast(id: string) {
  const r = await apiClient.get<Podcast>(`/api/podcasts/${id}`)
  return r.data
}

export async function inspectYoutubeUrl(url: string) {
  const r = await apiClient.get<YoutubeInspectResult>('/api/podcasts/inspect', {
    params: { url },
  })
  return r.data
}

export async function importPodcast(payload: {
  url: string
  primaryLang: 'jp' | 'en'
  /** Optional pasted .srt/.vtt content for the primary language. When given,
   *  the server skips YouTube's caption API entirely. */
  primarySrt?: string
  /** Optional pasted Chinese subtitle in the same format. */
  zhSrt?: string
}) {
  const r = await apiClient.post<Podcast>('/api/podcasts', payload)
  return r.data
}

export async function deletePodcast(id: string) {
  const r = await apiClient.delete<{ id: string }>(`/api/podcasts/${id}`)
  return r.data
}

/** Throttled position-save. Used during playback + on pause. */
export async function savePodcastPosition(id: string, sec: number) {
  const r = await apiClient.patch<{ ok: true; sec: number }>(
    `/api/podcasts/${id}/position`,
    { sec },
  )
  return r.data
}

/** Like savePodcastPosition but built for `beforeunload` / `visibilitychange`:
 *  the regular axios request can get cancelled when the page unmounts, so we
 *  fire the same request via `fetch({ keepalive: true })` which the browser
 *  is allowed to finish in the background even after the tab closes. */
export function savePodcastPositionBeacon(id: string, sec: number, token: string | null) {
  if (typeof window === 'undefined') return
  const base = (
    (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE_URL) || ''
  ) as string
  try {
    void fetch(`${base}/api/podcasts/${id}/position`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ sec }),
      keepalive: true,
    })
  } catch {
    // best-effort — the user is leaving anyway
  }
}
