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
import { normalizeExamTag, parseExamTag } from '../lib/examSeries'

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

  // 标题里认得出是哪一场真题就直接归类，认不出就留空——列表页会把它放进
  // 「未归类」，用户手动补。
  const exam = parseExamTag(title)

  return prisma.podcast.create({
    data: {
      userId,
      youtubeId: videoId,
      title,
      primaryLang: input.primaryLang,
      thumbnail,
      durationSec,
      transcript: JSON.stringify(blob),
      examLevel: exam.level,
      examYear: exam.year,
      examMonth: exam.month,
    },
  })
}

/** Local/mp3-based podcast import — pastes an SRT and points to an mp3 file
 *  already served from the frontend's public/ folder. Skips YouTube entirely. */
export async function importMp3Podcast(
  userId: string,
  input: {
    title: string
    mp3Url: string
    primaryLang: SupportedPrimary
    primarySrt: string
    zhSrt?: string
    thumbnail?: string
  },
) {
  const title = (input.title ?? '').trim()
  const mp3Url = (input.mp3Url ?? '').trim()
  const primarySrt = (input.primarySrt ?? '').trim()
  if (!title) throw new AppError('title is required', 400)
  if (!mp3Url) throw new AppError('mp3Url is required', 400)
  if (!primarySrt) throw new AppError('primarySrt is required', 400)

  const primaryLines = parseSubtitle(primarySrt)
  if (primaryLines.length === 0) {
    throw new AppError('Primary subtitle is empty or invalid', 400)
  }
  const chineseLines = input.zhSrt && input.zhSrt.trim().length > 0
    ? parseSubtitle(input.zhSrt)
    : []

  const merged: TranscriptLine[] = primaryLines.map((line) => {
    if (chineseLines.length === 0) return { ...line }
    const lineEnd = line.start + line.dur
    const overlapping = chineseLines.filter(
      (z) => z.start < lineEnd && z.start + z.dur > line.start,
    )
    const zhText = overlapping.map((z) => z.text).join(' ').trim()
    return zhText ? { ...line, zh: zhText } : { ...line }
  })

  const durationSec = Math.ceil(
    Math.max(...merged.map((l) => (l.start + l.dur) / 1000), 0),
  )

  const blob: TranscriptBlob = {
    lines: merged,
    primaryTrack: { languageCode: input.primaryLang, kind: 'mp3' },
    chineseTrack: chineseLines.length > 0
      ? { languageCode: 'zh', kind: 'mp3' }
      : null,
  }

  // Synthetic youtubeId so the existing (userId, youtubeId) unique index still
  // works. Prefixed so it's obviously not a real YouTube video.
  const syntheticId = `mp3-${crypto.randomUUID()}`

  const exam = parseExamTag(title)

  return prisma.podcast.create({
    data: {
      userId,
      youtubeId: syntheticId,
      mp3Url,
      title,
      primaryLang: input.primaryLang,
      thumbnail: input.thumbnail ?? '',
      durationSec,
      transcript: JSON.stringify(blob),
      examLevel: exam.level,
      examYear: exam.year,
      examMonth: exam.month,
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
      mp3Url: true,
      title: true,
      primaryLang: true,
      thumbnail: true,
      durationSec: true,
      lastPositionSec: true,
      examLevel: true,
      examYear: true,
      examMonth: true,
      createdAt: true,
      updatedAt: true,
    },
  })
  return rows
}

/** 同一套（级别 + 年）里的其它场次，按月份排。examYear 为 0（未归类）时
 *  返回空数组——未归类的一堆东西凑不成一套。 */
async function seriesSiblings(
  userId: string,
  row: { id: string; examLevel: string; examYear: number },
) {
  if (row.examYear === 0) return []
  return prisma.podcast.findMany({
    where: {
      userId,
      examLevel: row.examLevel,
      examYear: row.examYear,
    },
    orderBy: [{ examMonth: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      title: true,
      examLevel: true,
      examYear: true,
      examMonth: true,
      durationSec: true,
      lastPositionSec: true,
    },
  })
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

  // 同套的场次一并返回，详情页据此渲染「上一场 / 下一场」。一次多查一条
  // 窄 select，省掉前端为了算前后场而去拉整个列表。
  const siblings = await seriesSiblings(userId, row)
  const index = siblings.findIndex((s) => s.id === row.id)

  return {
    ...row,
    transcript: parsed,
    series:
      index >= 0
        ? {
            items: siblings,
            index,
            prev: index > 0 ? siblings[index - 1] : null,
            next: index < siblings.length - 1 ? siblings[index + 1] : null,
          }
        : null,
  }
}

/** 改标题 / 改真题归类。YouTube 元数据抓不到时标题会回落成 videoId，
 *  年份也就无从解析——这个接口就是给那种情况收尾用的。 */
export async function updatePodcastMeta(
  userId: string,
  id: string,
  patch: {
    title?: string
    examLevel?: string | null
    examYear?: number | null
    examMonth?: number | null
  },
) {
  const row = await prisma.podcast.findFirst({ where: { id, userId } })
  if (!row) throw new AppError('podcast not found', 404)

  const data: {
    title?: string
    examLevel?: string
    examYear?: number
    examMonth?: number
  } = {}

  if (patch.title !== undefined) {
    const title = patch.title.trim()
    if (!title) throw new AppError('title cannot be empty', 400)
    data.title = title
  }

  // 三个归类字段一起给才动——只传一个就改一个的话，「清空归类」和「没传」
  // 分不开。前端那个弹框本来就是三个一起提交的。
  if (
    patch.examLevel !== undefined ||
    patch.examYear !== undefined ||
    patch.examMonth !== undefined
  ) {
    const tag = normalizeExamTag({
      level: patch.examLevel,
      year: patch.examYear,
      month: patch.examMonth,
    })
    data.examLevel = tag.level
    data.examYear = tag.year
    data.examMonth = tag.month
  }

  if (Object.keys(data).length === 0) return row

  return prisma.podcast.update({ where: { id }, data })
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

/**
 * Edit one transcript line in place. Lets the user fix wrong auto-captions
 * (YouTube ASR mishears, missing kanji, mangled 敬語) without re-importing —
 * which would lose playback position and word-link history.
 *
 * Line is addressed by its array index (lineIndex). The line's start/dur
 * timestamps stay untouched; only `text` and optionally `zh` are replaced.
 */
export async function updatePodcastLine(
  userId: string,
  id: string,
  lineIndex: number,
  patch: { text?: string; zh?: string | null },
) {
  if (!Number.isInteger(lineIndex) || lineIndex < 0) {
    throw new AppError('lineIndex must be a non-negative integer', 400)
  }

  const row = await prisma.podcast.findFirst({ where: { id, userId } })
  if (!row) throw new AppError('podcast not found', 404)

  let parsed: TranscriptBlob
  try {
    parsed = JSON.parse(row.transcript) as TranscriptBlob
  } catch {
    throw new AppError('transcript is malformed', 500)
  }
  if (!Array.isArray(parsed.lines) || lineIndex >= parsed.lines.length) {
    throw new AppError('line not found', 404)
  }

  const current = parsed.lines[lineIndex]
  const nextText = patch.text !== undefined ? patch.text : current.text
  // zh: undefined → leave alone; null or '' → clear it; string → set it.
  let nextZh: string | undefined = current.zh
  if (patch.zh === null || patch.zh === '') {
    nextZh = undefined
  } else if (typeof patch.zh === 'string') {
    nextZh = patch.zh
  }

  parsed.lines[lineIndex] = {
    ...current,
    text: nextText,
    ...(nextZh !== undefined ? { zh: nextZh } : { zh: undefined }),
  }
  // Strip undefined zh so the JSON stays compact (matches importPodcast shape).
  if (parsed.lines[lineIndex].zh === undefined) {
    delete parsed.lines[lineIndex].zh
  }

  await prisma.podcast.update({
    where: { id },
    data: { transcript: JSON.stringify(parsed) },
  })

  return parsed.lines[lineIndex]
}

export type { CaptionTrack }
