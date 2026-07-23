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

/** Import an mp3-based podcast — file already placed in the frontend's
 *  public/ folder, referenced by `mp3Url` (e.g. "/podcast-media/foo.mp3"),
 *  transcript pasted as SRT. */
export async function importMp3Podcast(payload: {
  title: string
  mp3Url: string
  primaryLang: 'jp' | 'en'
  primarySrt: string
  zhSrt?: string
  thumbnail?: string
}) {
  const r = await apiClient.post<Podcast>('/api/podcasts/mp3', payload)
  return r.data
}

export async function deletePodcast(id: string) {
  const r = await apiClient.delete<{ id: string }>(`/api/podcasts/${id}`)
  return r.data
}

/** Edit one transcript line's text (and optionally its Chinese translation).
 *  Used when imported captions have ASR errors / wrong kanji / garbled keigo —
 *  cheaper than re-importing the whole podcast. */
export async function updatePodcastLine(
  id: string,
  lineIndex: number,
  patch: { text?: string; zh?: string | null },
) {
  const r = await apiClient.patch<{
    start: number
    dur: number
    text: string
    zh?: string
  }>(`/api/podcasts/${id}/lines/${lineIndex}`, patch)
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
