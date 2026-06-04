import { prisma } from '../lib/prisma'
import { AppError } from '../errors/AppError'
import {
  extractVideoId,
  fetchCaptionLines,
  fetchVideoMeta,
  fetchVideoMetaViaOEmbed,
  pickCaptionTrack,
  type CaptionLine,
  type CaptionTrack,
} from './youtubeService'
import { parseSubtitle } from './subtitleParser'

type SupportedPrimary = 'jp' | 'en'

type TranscriptLine = CaptionLine & { zh?: string }

type TranscriptBlob = {
  lines: TranscriptLine[]
  chineseTrack?: { languageCode: string; kind: string } | null
  primaryTrack: { languageCode: string; kind: string }
}

/** Inspect a YouTube URL: return metadata + available caption tracks. The
 *  client uses this to confirm before committing to a full import. */
export async function inspectYoutubeUrl(url: string) {
  const videoId = extractVideoId(url)
  if (!videoId) throw new AppError('Invalid YouTube URL', 400)
  const meta = await fetchVideoMeta(videoId)
  if (meta.captionTracks.length === 0) {
    throw new AppError('This video has no captions available', 400)
  }
  return meta
}

/** Pull captions and store as a Podcast row.
 *
 *  Two paths:
 *  - Manual upload: caller pasted SRT/VTT content for the primary (and
 *    optionally Chinese) language. We parse it directly and skip YouTube's
 *    caption API entirely. Metadata comes from oEmbed (no IP block).
 *  - Auto: caller gave just a URL. We try YouTube's watch page for both
 *    metadata + caption tracks. Falls back to oEmbed for metadata if the
 *    watch page is blocked. */
export async function importPodcast(
  userId: string,
  input: {
    url: string
    primaryLang: SupportedPrimary
    primarySrt?: string
    zhSrt?: string
  },
) {
  const videoId = extractVideoId(input.url)
  if (!videoId) throw new AppError('Invalid YouTube URL', 400)

  const existing = await prisma.podcast.findUnique({
    where: { userId_youtubeId: { userId, youtubeId: videoId } },
  })
  if (existing) {
    throw new AppError('This video is already imported', 409)
  }

  const hasManualSrt = !!input.primarySrt && input.primarySrt.trim().length > 0

  let primaryLines: TranscriptLine[] = []
  let chineseLines: TranscriptLine[] = []
  let primaryTrackInfo: { languageCode: string; kind: string } = {
    languageCode: input.primaryLang,
    kind: 'manual',
  }
  let chineseTrackInfo: { languageCode: string; kind: string } | null = null
  let title = ''
  let thumbnail = ''
  let durationSec = 0

  if (hasManualSrt) {
    // Manual subtitle path — never touches YouTube caption endpoints.
    const parsedPrimary = parseSubtitle(input.primarySrt as string)
    if (parsedPrimary.length === 0) {
      throw new AppError('Pasted primary subtitle is empty or invalid', 400)
    }
    primaryLines = parsedPrimary
    if (input.zhSrt && input.zhSrt.trim().length > 0) {
      chineseLines = parseSubtitle(input.zhSrt)
      chineseTrackInfo = { languageCode: 'zh', kind: 'manual' }
    }
    // Duration: latest endtime in the primary track. Good enough.
    durationSec = Math.ceil(
      Math.max(...primaryLines.map((l) => (l.start + l.dur) / 1000), 0),
    )
    // Metadata: try the full watch page (best — has title/thumbnail/duration),
    // fall back to oEmbed (title + thumbnail only) when YouTube blocks the IP.
    try {
      const meta = await fetchVideoMeta(videoId)
      title = meta.title
      thumbnail = meta.thumbnail
      if (meta.durationSec > 0) durationSec = meta.durationSec
    } catch {
      try {
        const oe = await fetchVideoMetaViaOEmbed(videoId)
        if (oe.title) title = oe.title
        if (oe.thumbnail) thumbnail = oe.thumbnail
      } catch {
        // Swallow — handled by the fallbacks below.
      }
    }
    // Fall back to the deterministic thumbnail URL (always present for a
    // valid videoId) and the videoId itself as a title so cards don't
    // render with blank labels when YouTube blocks both meta endpoints.
    if (!thumbnail) {
      thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
    }
    if (!title) {
      title = videoId
    }
  } else {
    // Auto path — full YouTube pull.
    const meta = await fetchVideoMeta(videoId)
    const primaryTrack = pickCaptionTrack(meta.captionTracks, input.primaryLang)
    if (!primaryTrack) {
      throw new AppError(
        `No ${input.primaryLang.toUpperCase()} captions on this video`,
        400,
      )
    }
    const chineseTrack =
      pickCaptionTrack(meta.captionTracks, 'zh-Hans') ??
      pickCaptionTrack(meta.captionTracks, 'zh-CN') ??
      pickCaptionTrack(meta.captionTracks, 'zh')

    primaryLines = await fetchCaptionLines(primaryTrack.baseUrl)
    chineseLines = chineseTrack
      ? await fetchCaptionLines(chineseTrack.baseUrl)
      : []
    primaryTrackInfo = {
      languageCode: primaryTrack.languageCode,
      kind: primaryTrack.kind,
    }
    chineseTrackInfo = chineseTrack
      ? { languageCode: chineseTrack.languageCode, kind: chineseTrack.kind }
      : null
    title = meta.title
    thumbnail = meta.thumbnail
    durationSec = meta.durationSec
  }

  // Pair Chinese lines to primary lines by start-time overlap. Captions
  // aren't guaranteed to share boundaries, so we find any zh line whose
  // window overlaps each primary line's window.
  const merged: TranscriptLine[] = primaryLines.map((line) => {
    if (chineseLines.length === 0) return { ...line }
    const lineEnd = line.start + line.dur
    const overlapping = chineseLines.filter(
      (z) => z.start < lineEnd && z.start + z.dur > line.start,
    )
    const zhText = overlapping
      .map((z) => z.text)
      .join(' ')
      .trim()
    return zhText ? { ...line, zh: zhText } : { ...line }
  })

  const blob: TranscriptBlob = {
    lines: merged,
    primaryTrack: primaryTrackInfo,
    chineseTrack: chineseTrackInfo,
  }

  return prisma.podcast.create({
    data: {
      userId,
      youtubeId: videoId,
      title,
      primaryLang: input.primaryLang,
      thumbnail,
      durationSec,
      transcript: JSON.stringify(blob),
    },
  })
}

export async function listPodcasts(userId: string) {
  const rows = await prisma.podcast.findMany({
    where: { userId },
    // updatedAt reflects the last touch — we PATCH lastPositionSec every few
    // seconds during playback, so this doubles as a "lastViewedAt" without a
    // separate column. Most-recently-watched lands at the top.
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      youtubeId: true,
      title: true,
      primaryLang: true,
      thumbnail: true,
      durationSec: true,
      lastPositionSec: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  return rows
}

export async function getPodcast(userId: string, id: string) {
  const row = await prisma.podcast.findFirst({ where: { id, userId } })
  if (!row) throw new AppError('podcast not found', 404)
  let parsed: TranscriptBlob | null = null
  try {
    parsed = JSON.parse(row.transcript) as TranscriptBlob
  } catch {
    parsed = { lines: [], primaryTrack: { languageCode: '', kind: '' } }
  }
  return {
    ...row,
    transcript: parsed,
  }
}

export async function deletePodcast(userId: string, id: string) {
  const row = await prisma.podcast.findFirst({ where: { id, userId } })
  if (!row) throw new AppError('podcast not found', 404)
  await prisma.podcast.delete({ where: { id } })
  return { id }
}

/** Persist the last playback position in seconds. Called frequently
 *  (every ~5s + on pause / unload) — uses updateMany so a non-owner
 *  hitting someone else's id is a no-op rather than a 404 storm. */
export async function updatePodcastPosition(
  userId: string,
  id: string,
  sec: number,
) {
  const clean = Number.isFinite(sec) ? Math.max(0, Math.floor(sec)) : 0
  await prisma.podcast.updateMany({
    where: { id, userId },
    data: { lastPositionSec: clean },
  })
  return { ok: true, sec: clean }
}

export type { CaptionTrack }
