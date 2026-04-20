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

function calculateNextReview(input: ReviewCalculationInput) {
  let interval = input.interval
  let repetition = input.repetition
  let easeFactor = input.easeFactor

  if (input.rating === 'again') {
    repetition = 0
    interval = 1
    easeFactor = Math.max(MIN_EASE_FACTOR, easeFactor - 0.2)
  }

  if (input.rating === 'hard') {
    repetition += 1
    interval = Math.max(1, Math.round(interval * 1.2))
  }

  if (input.rating === 'easy') {
    repetition += 1
    interval = Math.max(1, Math.round(interval * easeFactor))
    easeFactor += 0.1
  }

  const nextReviewDate = addDays(input.reviewedAt, interval)

  return {
    interval,
    repetition,
    easeFactor: Number(Math.max(MIN_EASE_FACTOR, easeFactor).toFixed(2)),
    nextReviewDate,
    lastReviewedAt: input.reviewedAt,
  }
}

export async function getTodayReviews() {
  const now = new Date()

  return prisma.review.findMany({
    where: {
      nextReviewDate: {
        lte: now,
      },
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

  return prisma.review.update({
    where: {
      wordId: word.id,
    },
    data: nextState,
    include: {
      word: {
        include: {
          folder: true,
        },
      },
    },
  })
}
