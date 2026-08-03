import { prisma } from '../lib/prisma'
import { flattenWord, WORD_FOLDERS } from '../lib/wordShape'
import { AppError } from '../errors/AppError'

const MIN_EASE_FACTOR = 1.3
const VALID_RATINGS = ['again', 'hard', 'easy'] as const

export type ReviewRating = (typeof VALID_RATINGS)[number]

type ReviewCalculationInput = {
  interval: number
  repetition: number
  easeFactor: number
  rating: ReviewRating
  reviewedAt: Date
}

function assertRating(rating: string): asserts rating is ReviewRating {
  if (!VALID_RATINGS.includes(rating as ReviewRating)) {
    throw new AppError('rating must be one of again, hard or easy', 400)
  }
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function startOfDay(date: Date) {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

function endOfDay(date: Date) {
  const next = new Date(date)
  next.setHours(23, 59, 59, 999)
  return next
}

function calculateNextReview(input: ReviewCalculationInput) {
  let interval = input.interval
  let repetition = input.repetition
  let easeFactor = input.easeFactor
  const shortLearningIntervals = [1, 1, 2, 4, 7]
  const shortLearningRepCap = shortLearningIntervals.length

  if (input.rating === 'again') {
    repetition = 0
    interval = 1
    easeFactor = Math.max(MIN_EASE_FACTOR, easeFactor - 0.2)
  }

  if (input.rating === 'hard') {
    repetition += 1
    easeFactor = Math.max(MIN_EASE_FACTOR, easeFactor - 0.05)
    if (repetition <= shortLearningRepCap) {
      interval = shortLearningIntervals[repetition - 1] ?? 1
    } else {
      interval = Math.max(1, Math.round(interval * 1.2))
    }
  }

  if (input.rating === 'easy') {
    repetition += 1
    if (repetition <= shortLearningRepCap) {
      interval = shortLearningIntervals[repetition - 1] ?? 1
    } else {
      interval = Math.max(1, Math.round(interval * easeFactor))
    }
    easeFactor += 0.1
  }

  const nextReviewDate = addDays(startOfDay(input.reviewedAt), interval)

  return {
    interval,
    repetition,
    easeFactor: Number(Math.max(MIN_EASE_FACTOR, easeFactor).toFixed(2)),
    nextReviewDate,
    lastReviewedAt: input.reviewedAt,
  }
}

function getDifficultyDelta(rating: ReviewRating) {
  if (rating === 'again') return 2
  if (rating === 'hard') return 1
  return -1
}

function parseRecentRatings(value?: string | null): ReviewRating[] {
  if (!value) return []
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item): item is ReviewRating => VALID_RATINGS.includes(item as ReviewRating))
}

export async function getTodayReviews(userId: string, folderId?: string) {
  const now = new Date()
  const todayEnd = endOfDay(now)
  const trimmedFolderId = folderId?.trim()

  const items = await prisma.review.findMany({
    where: {
      lastReviewedAt: {
        not: null,
      },
      nextReviewDate: {
        lte: todayEnd,
      },
      word: {
        userId,
        ...(trimmedFolderId ? { folders: { some: { folderId: trimmedFolderId } } } : {}),
      },
    },
    orderBy: {
      nextReviewDate: 'asc',
    },
    include: {
      word: { include: WORD_FOLDERS },
    },
  })
  return items.map((item) => ({ ...item, word: flattenWord(item.word) }))
}

export async function updateReview(userId: string, wordId: string, rating: string) {
  if (!wordId.trim()) {
    throw new AppError('wordId is required', 400)
  }

  assertRating(rating)

  const word = await prisma.word.findFirst({
    where: { id: wordId, userId },
    include: {
      review: true,
      ...WORD_FOLDERS,
    },
  })

  if (!word) {
    throw new AppError('word not found', 404)
  }

  const currentReview = word.review

  if (!currentReview) {
    await prisma.review.create({
      data: {
        wordId: word.id,
        interval: 1,
        repetition: 0,
        easeFactor: 2.5,
        nextReviewDate: new Date(),
      },
    })
  }

  const reviewedAt = new Date()
  const nextState = calculateNextReview({
    interval: currentReview?.interval ?? 1,
    repetition: currentReview?.repetition ?? 0,
    easeFactor: currentReview?.easeFactor ?? 2.5,
    rating,
    reviewedAt,
  })
  const previousRecentRatings = parseRecentRatings(currentReview?.recentRatings)
  const nextRecentRatings = [...previousRecentRatings, rating].slice(-3)
  const nextDifficultyScore = Math.max(
    0,
    (currentReview?.difficultyScore ?? 0) + getDifficultyDelta(rating),
  )
  const firstLearnedAt = currentReview?.lastReviewedAt ? currentReview.firstLearnedAt : reviewedAt

  const updated = await prisma.review.update({
    where: {
      wordId: word.id,
    },
    data: {
      ...nextState,
      difficultyScore: nextDifficultyScore,
      lastRating: rating,
      recentRatings: nextRecentRatings.join(','),
      firstLearnedAt,
    },
    include: {
      word: { include: WORD_FOLDERS },
    },
  })
  // Log the event for weekly-review analytics. Best-effort; we don't want
  // an ORM hiccup here to fail the user's review submission.
  try {
    await prisma.reviewEvent.create({
      data: { userId, kind: 'word', itemId: word.id, rating },
    })
  } catch {
    /* ignore */
  }
  return { ...updated, word: flattenWord(updated.word) }
}

/**
 * Re-rate a word as if the user had originally picked `newRating` instead of
 * whatever they actually picked. Used by the "misclick rescue" panel that
 * appears at session-done — the client sends back a snapshot of the Review
 * state *before* the (presumed wrong) rating was applied, and we recompute
 * the FSRS state on top of that snapshot using the corrected rating.
 *
 * Equivalent to: rewind Review to `snapshot`, then run `updateReview(newRating)`
 * against that pristine state. Implemented inline to keep it one write.
 *
 * Disallows newRating === 'again' — the UX only lets users move toward
 * "easier", since a misclick can't downgrade you (the misclick *is* the again).
 */
export async function correctReview(
  userId: string,
  wordId: string,
  snapshot: {
    interval: number
    repetition: number
    easeFactor: number
    difficultyScore: number
    recentRatings: string
    firstLearnedAt: Date | null
    lastReviewedAt: Date | null
  },
  newRating: string,
) {
  if (!wordId.trim()) {
    throw new AppError('wordId is required', 400)
  }
  assertRating(newRating)
  if (newRating === 'again') {
    throw new AppError('correction cannot set rating to again', 400)
  }

  const word = await prisma.word.findFirst({
    where: { id: wordId, userId },
    include: { review: true },
  })
  if (!word) {
    throw new AppError('word not found', 404)
  }
  if (!word.review) {
    throw new AppError('word has no review to correct', 400)
  }

  const reviewedAt = new Date()
  const nextState = calculateNextReview({
    interval: snapshot.interval,
    repetition: snapshot.repetition,
    easeFactor: snapshot.easeFactor,
    rating: newRating,
    reviewedAt,
  })
  const previousRecentRatings = parseRecentRatings(snapshot.recentRatings)
  const nextRecentRatings = [...previousRecentRatings, newRating].slice(-3)
  const nextDifficultyScore = Math.max(
    0,
    snapshot.difficultyScore + getDifficultyDelta(newRating),
  )
  const firstLearnedAt = snapshot.lastReviewedAt
    ? snapshot.firstLearnedAt
    : reviewedAt

  const updated = await prisma.review.update({
    where: { wordId: word.id },
    data: {
      ...nextState,
      difficultyScore: nextDifficultyScore,
      lastRating: newRating,
      recentRatings: nextRecentRatings.join(','),
      firstLearnedAt,
    },
    include: {
      word: { include: WORD_FOLDERS },
    },
  })
  // Correction replaces the previous event's outcome — log the new rating
  // so weekly-review stats reflect the user's corrected intent.
  try {
    await prisma.reviewEvent.create({
      data: { userId, kind: 'word', itemId: word.id, rating: newRating },
    })
  } catch {
    /* ignore */
  }
  return { ...updated, word: flattenWord(updated.word) }
}

export async function markWordMastered(userId: string, wordId: string) {
  if (!wordId.trim()) {
    throw new AppError('wordId is required', 400)
  }
  const word = await prisma.word.findFirst({
    where: { id: wordId, userId },
    include: { review: true },
  })
  if (!word) {
    throw new AppError('word not found', 404)
  }

  const now = new Date()
  // Push next review ~10 years out so it never re-surfaces in due lists,
  // and bump repetition/interval so getMasteryStatus reports 'mastered'.
  const farFuture = addDays(startOfDay(now), 3650)
  const masteredData = {
    interval: 3650,
    repetition: Math.max(word.review?.repetition ?? 0, 5),
    easeFactor: Math.max(word.review?.easeFactor ?? 2.5, 2.5),
    nextReviewDate: farFuture,
    lastReviewedAt: now,
    lastRating: 'easy',
    difficultyScore: 0,
    firstLearnedAt: word.review?.firstLearnedAt ?? now,
  }

  if (!word.review) {
    await prisma.review.create({
      data: { wordId: word.id, ...masteredData, recentRatings: 'easy' },
    })
  } else {
    await prisma.review.update({
      where: { wordId: word.id },
      data: masteredData,
    })
  }

  const refreshed = await prisma.review.findUnique({
    where: { wordId: word.id },
    include: { word: { include: WORD_FOLDERS } },
  })
  return refreshed ? { ...refreshed, word: flattenWord(refreshed.word) } : null
}

export async function getTodayLearnedStats(userId: string) {
  const now = new Date()
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const end = new Date(now)
  end.setHours(23, 59, 59, 999)

  const [enCount, jpCount] = await Promise.all([
    prisma.review.count({
      where: {
        firstLearnedAt: { gte: start, lte: end },
        word: { language: 'en', userId },
      },
    }),
    prisma.review.count({
      where: {
        firstLearnedAt: { gte: start, lte: end },
        word: { language: 'jp', userId },
      },
    }),
  ])

  return { en: enCount, jp: jpCount, total: enCount + jpCount }
}

export async function getTomorrowReviewStats(userId: string) {
  const now = new Date()
  const tomorrow = addDays(now, 1)
  const start = startOfDay(tomorrow)
  const end = endOfDay(tomorrow)

  const [enCount, jpCount] = await Promise.all([
    prisma.review.count({
      where: {
        lastReviewedAt: { not: null },
        nextReviewDate: { gte: start, lte: end },
        word: { language: 'en', userId },
      },
    }),
    prisma.review.count({
      where: {
        lastReviewedAt: { not: null },
        nextReviewDate: { gte: start, lte: end },
        word: { language: 'jp', userId },
      },
    }),
  ])

  return { en: enCount, jp: jpCount, total: enCount + jpCount }
}
