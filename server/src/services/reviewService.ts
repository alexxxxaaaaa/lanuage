import { prisma } from '../lib/prisma'
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

  // Use day-level scheduling: a word becomes due at 00:00 of the due day.
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

export async function getTodayReviews(folderId?: string) {
  const now = new Date()
  const todayEnd = endOfDay(now)
  const trimmedFolderId = folderId?.trim()

  return prisma.review.findMany({
    where: {
      lastReviewedAt: {
        not: null,
      },
      nextReviewDate: {
        lte: todayEnd,
      },
      ...(trimmedFolderId
        ? {
            word: {
              folderId: trimmedFolderId,
            },
          }
        : {}),
    },
    orderBy: {
      nextReviewDate: 'asc',
    },
    include: {
      word: {
        include: {
          folder: true,
        },
      },
    },
  })
}

export async function updateReview(wordId: string, rating: string) {
  if (!wordId.trim()) {
    throw new AppError('wordId is required', 400)
  }

  assertRating(rating)

  const word = await prisma.word.findUnique({
    where: {
      id: wordId,
    },
    include: {
      review: true,
      folder: true,
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

  return prisma.review.update({
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
      word: {
        include: {
          folder: true,
        },
      },
    },
  })
}

export async function getTodayLearnedStats() {
  const now = new Date()
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const end = new Date(now)
  end.setHours(23, 59, 59, 999)

  const [enCount, jpCount] = await Promise.all([
    prisma.review.count({
      where: {
        firstLearnedAt: { gte: start, lte: end },
        word: { language: 'en' },
      },
    }),
    prisma.review.count({
      where: {
        firstLearnedAt: { gte: start, lte: end },
        word: { language: 'jp' },
      },
    }),
  ])

  return { en: enCount, jp: jpCount, total: enCount + jpCount }
}

export async function getTomorrowReviewStats() {
  const now = new Date()
  const tomorrow = addDays(now, 1)
  const start = startOfDay(tomorrow)
  const end = endOfDay(tomorrow)

  const [enCount, jpCount] = await Promise.all([
    prisma.review.count({
      where: {
        lastReviewedAt: { not: null },
        nextReviewDate: { gte: start, lte: end },
        word: { language: 'en' },
      },
    }),
    prisma.review.count({
      where: {
        lastReviewedAt: { not: null },
        nextReviewDate: { gte: start, lte: end },
        word: { language: 'jp' },
      },
    }),
  ])

  return { en: enCount, jp: jpCount, total: enCount + jpCount }
}
