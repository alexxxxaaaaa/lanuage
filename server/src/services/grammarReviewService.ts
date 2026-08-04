import { prisma } from '../lib/prisma'
import { AppError } from '../errors/AppError'
import { withMediaUrls } from './grammarService'

// Grammar review schedule — full FSRS-style spaced repetition, mirrors
// reviewService.ts but operates on Grammar instead of Word. The two are kept
// as separate files (rather than a generic util) because the Prisma client
// types diverge and abstracting away the model adds friction with no real
// reuse — the FSRS math itself is only ~50 lines.

const MIN_EASE_FACTOR = 1.3
const VALID_RATINGS = ['again', 'hard', 'easy'] as const

export type GrammarReviewRating = (typeof VALID_RATINGS)[number]

type ReviewCalculationInput = {
  interval: number
  repetition: number
  easeFactor: number
  rating: GrammarReviewRating
  reviewedAt: Date
}

function assertRating(rating: string): asserts rating is GrammarReviewRating {
  if (!VALID_RATINGS.includes(rating as GrammarReviewRating)) {
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

function getDifficultyDelta(rating: GrammarReviewRating) {
  if (rating === 'again') return 2
  if (rating === 'hard') return 1
  return -1
}

function parseRecentRatings(value?: string | null): GrammarReviewRating[] {
  if (!value) return []
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item): item is GrammarReviewRating =>
      VALID_RATINGS.includes(item as GrammarReviewRating),
    )
}

export async function getTodayGrammarReviews(userId: string) {
  const todayEnd = endOfDay(new Date())
  const rows = await prisma.grammarReview.findMany({
    where: {
      lastReviewedAt: { not: null },
      nextReviewDate: { lte: todayEnd },
      grammar: { userId },
    },
    orderBy: { nextReviewDate: 'asc' },
    include: { grammar: true },
  })
  return rows.map((row) => ({ ...row, grammar: withMediaUrls(row.grammar) }))
}

export async function submitGrammarReview(
  userId: string,
  grammarId: string,
  rating: string,
) {
  if (!grammarId.trim()) {
    throw new AppError('grammarId is required', 400)
  }
  assertRating(rating)

  const grammar = await prisma.grammar.findFirst({
    where: { id: grammarId, userId },
    include: { review: true },
  })

  if (!grammar) {
    throw new AppError('grammar not found', 404)
  }

  const currentReview = grammar.review
  const reviewedAt = new Date()

  if (!currentReview) {
    await prisma.grammarReview.create({
      data: {
        grammarId: grammar.id,
        interval: 1,
        repetition: 0,
        easeFactor: 2.5,
        nextReviewDate: reviewedAt,
      },
    })
  }

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
  const firstLearnedAt = currentReview?.lastReviewedAt
    ? currentReview.firstLearnedAt
    : reviewedAt

  const updated = await prisma.grammarReview.update({
    where: { grammarId: grammar.id },
    data: {
      ...nextState,
      difficultyScore: nextDifficultyScore,
      lastRating: rating,
      recentRatings: nextRecentRatings.join(','),
      firstLearnedAt,
    },
    include: { grammar: true },
  })
  try {
    await prisma.reviewEvent.create({
      data: { userId, kind: 'grammar', itemId: grammar.id, rating },
    })
  } catch {
    /* ignore */
  }
  return updated
}

/** Initial seed when the user has just learned a grammar item for the first
 *  time in /grammar/learn. The user's self-rating (again/hard/easy) on the
 *  study card decides the initial FSRS state — re-uses the same math as a
 *  normal review so a "hard" first-look pushes nextReviewDate to tomorrow,
 *  an "easy" one to ~7 days out, etc. */
export async function initGrammarReview(
  userId: string,
  grammarId: string,
  rating: string,
) {
  if (!grammarId.trim()) {
    throw new AppError('grammarId is required', 400)
  }
  assertRating(rating)

  const grammar = await prisma.grammar.findFirst({
    where: { id: grammarId, userId },
    include: { review: true },
  })
  if (!grammar) throw new AppError('grammar not found', 404)

  const reviewedAt = new Date()
  const nextState = calculateNextReview({
    interval: 1,
    repetition: 0,
    easeFactor: 2.5,
    rating,
    reviewedAt,
  })

  if (grammar.review) {
    // Already learned at some point — fall back to a normal submit so user
    // can "relearn" without breaking the schedule. Idempotent.
    return submitGrammarReview(userId, grammarId, rating)
  }

  const review = await prisma.grammarReview.create({
    data: {
      grammarId: grammar.id,
      ...nextState,
      difficultyScore: getDifficultyDelta(rating),
      lastRating: rating,
      recentRatings: rating,
      firstLearnedAt: reviewedAt,
    },
    include: { grammar: true },
  })
  // Auto-mark learned on first review so the list filter picks it up without
  // the user needing a second click.
  await prisma.grammar.update({
    where: { id: grammar.id },
    data: { isLearned: true },
  })
  try {
    await prisma.reviewEvent.create({
      data: { userId, kind: 'grammar', itemId: grammar.id, rating },
    })
  } catch {
    /* ignore */
  }
  return review
}

export async function getUnlearnedGrammars(userId: string, level?: string) {
  // "Unlearned" means BOTH:
  //   - user hasn't manually marked isLearned = true, AND
  //   - no FSRS review has been submitted (no Review row, or lastReviewedAt null)
  // The isLearned flag was previously ignored, so manually-marked grammars
  // kept showing up in the Learn queue.
  //
  // 装进整本蓝宝书之后这个队列有 800 多条，一路学下去会从 N5 的助数词开始 ——
  // 所以带上 level 参数，让人挑着级别学。不传就是全部，和以前一样。
  const rows = await prisma.grammar.findMany({
    where: {
      userId,
      isLearned: false,
      ...(level ? { level } : {}),
      OR: [
        { review: { is: null } },
        { review: { is: { lastReviewedAt: null } } },
      ],
    },
    // orderNo 是书里的条目顺序，导入的内容按它走；手工建的条目 orderNo 是 0，
    // 排在最前面，组内再按 createdAt —— 也就是这一列加进来之前的原顺序。
    orderBy: [{ orderNo: 'asc' }, { createdAt: 'asc' }],
  })
  return rows.map(withMediaUrls)
}

export async function getGrammarReviewCounts(userId: string) {
  const todayEnd = endOfDay(new Date())
  const [dueCount, unlearnedCount] = await Promise.all([
    prisma.grammarReview.count({
      where: {
        lastReviewedAt: { not: null },
        nextReviewDate: { lte: todayEnd },
        grammar: { userId },
      },
    }),
    prisma.grammar.count({
      where: {
        userId,
        isLearned: false,
        OR: [
          { review: { is: null } },
          { review: { is: { lastReviewedAt: null } } },
        ],
      },
    }),
  ])
  return { due: dueCount, unlearned: unlearnedCount }
}
