import type { Review } from '../types'

export type MasteryStatus = 'new' | 'learning' | 'familiar' | 'mastered'

export function getMasteryStatus(review?: Review | null): MasteryStatus {
  if (!review) return 'new'

  if (review.repetition <= 0) return 'new'
  if (review.repetition <= 2) return 'learning'
  if (review.repetition >= 5 || review.interval >= 21) return 'mastered'
  if (review.repetition >= 3 || review.interval >= 7) return 'familiar'
  return 'learning'
}

export function isTrickyWord(review?: Review | null) {
  if (!review) return false
  return review.lastReviewedAt !== null && review.repetition === 0 && review.interval <= 1
}

export function getMasteryPercent(review?: Review | null) {
  if (!review) return 0
  const base = Math.min(100, review.repetition * 20)
  const intervalBonus = Math.min(20, Math.floor(review.interval))
  const penalty = Math.min(60, (review.difficultyScore ?? 0) * 10)
  const score = base + intervalBonus - penalty
  return Math.max(0, Math.min(100, Math.round(score)))
}

export function getMasteryLabel(status: MasteryStatus) {
  switch (status) {
    case 'new':
      return '新词'
    case 'learning':
      return '学习中'
    case 'familiar':
      return '熟悉'
    case 'mastered':
      return '已掌握'
    default:
      return '学习中'
  }
}

export function getMasteryColor(status: MasteryStatus) {
  switch (status) {
    case 'new':
      return 'default'
    case 'learning':
      return 'blue'
    case 'familiar':
      return 'orange'
    case 'mastered':
      return 'green'
    default:
      return 'default'
  }
}
