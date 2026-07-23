import { prisma } from '../lib/prisma'

/**
 * Weekly-review analytics — the "Friday recap" showing progress across the
 * last N days. Uses ReviewEvent as the ground truth for review count +
 * correctness rate; firstLearnedAt as the ground truth for "how many new
 * items entered your rotation this week"; and Podcast.updatedAt for
 * listening activity (position-save bumps updatedAt).
 *
 * Week = trailing 7 days from `now` (rolling window), NOT calendar-week —
 * cleaner UX (feels the same on Fri afternoon as Sat morning) and matches
 * how spaced-repetition users think ("what did I do the last 7 days").
 */

export type WeeklyReview = {
  windowStart: string // ISO
  windowEnd: string   // ISO
  words: {
    learned: number       // firstLearnedAt in window
    reviewed: number      // ReviewEvent kind=word in window (event count)
    correct: number       // events where rating != 'again'
    correctRate: number   // 0-100, rounded
  }
  grammars: {
    learned: number
    reviewed: number
    correct: number
    correctRate: number
  }
  podcasts: {
    touched: number       // distinct podcasts with updatedAt in window
    titles: string[]      // up to 5 most-recent titles for display
  }
  perDay: Array<{
    date: string          // YYYY-MM-DD, in server TZ
    wordEvents: number
    grammarEvents: number
  }>
}

const WINDOW_DAYS = 7

function startOfDay(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function dayKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export async function getWeeklyReview(userId: string): Promise<WeeklyReview> {
  const now = new Date()
  // Anchor to start-of-day 7 days ago so the window is stable across the
  // day and covers a full 7×24h span rather than shifting by hours.
  const windowStart = startOfDay(
    new Date(now.getTime() - (WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000),
  )

  const [wordEvents, grammarEvents, wordsLearned, grammarsLearned, podcasts] =
    await Promise.all([
      prisma.reviewEvent.findMany({
        where: { userId, kind: 'word', createdAt: { gte: windowStart } },
        select: { rating: true, createdAt: true },
      }),
      prisma.reviewEvent.findMany({
        where: { userId, kind: 'grammar', createdAt: { gte: windowStart } },
        select: { rating: true, createdAt: true },
      }),
      prisma.review.count({
        where: {
          firstLearnedAt: { gte: windowStart },
          word: { folder: { userId } },
        },
      }),
      prisma.grammarReview.count({
        where: {
          firstLearnedAt: { gte: windowStart },
          grammar: { userId },
        },
      }),
      prisma.podcast.findMany({
        where: { userId, updatedAt: { gte: windowStart } },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, title: true },
        take: 20,
      }),
    ])

  const wordCorrect = wordEvents.filter((e) => e.rating !== 'again').length
  const grammarCorrect = grammarEvents.filter((e) => e.rating !== 'again').length

  // Build per-day buckets — 7 rows anchored to windowStart..today.
  const perDayMap = new Map<
    string,
    { wordEvents: number; grammarEvents: number }
  >()
  for (let i = 0; i < WINDOW_DAYS; i++) {
    const d = new Date(windowStart.getTime() + i * 24 * 60 * 60 * 1000)
    perDayMap.set(dayKey(d), { wordEvents: 0, grammarEvents: 0 })
  }
  for (const e of wordEvents) {
    const k = dayKey(new Date(e.createdAt))
    const cell = perDayMap.get(k)
    if (cell) cell.wordEvents += 1
  }
  for (const e of grammarEvents) {
    const k = dayKey(new Date(e.createdAt))
    const cell = perDayMap.get(k)
    if (cell) cell.grammarEvents += 1
  }
  const perDay = Array.from(perDayMap.entries()).map(([date, v]) => ({
    date,
    wordEvents: v.wordEvents,
    grammarEvents: v.grammarEvents,
  }))

  return {
    windowStart: windowStart.toISOString(),
    windowEnd: now.toISOString(),
    words: {
      learned: wordsLearned,
      reviewed: wordEvents.length,
      correct: wordCorrect,
      correctRate:
        wordEvents.length === 0
          ? 0
          : Math.round((wordCorrect / wordEvents.length) * 100),
    },
    grammars: {
      learned: grammarsLearned,
      reviewed: grammarEvents.length,
      correct: grammarCorrect,
      correctRate:
        grammarEvents.length === 0
          ? 0
          : Math.round((grammarCorrect / grammarEvents.length) * 100),
    },
    podcasts: {
      touched: podcasts.length,
      titles: podcasts.slice(0, 5).map((p) => p.title),
    },
    perDay,
  }
}
