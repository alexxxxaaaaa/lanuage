/**
 * 每个词单自己的复习步骤顺序。
 *
 * 「有些词单先看比较好，有些先听比较好」—— 所以顺序按词单分开存，不是全局
 * 设置。存 localStorage，和 sessionLimit / learnOrder 一个路子。
 *
 * ReviewPage 的三步本来就是顺序无关的：步骤编号是渲染时按下标现算的，分支
 * 判断走 step.key 而不是下标，每一步的评分也按 key 存、最后按 key 合成 FSRS
 * 评级。所以这里只要给出一个排列，页面按它生成 REVIEW_STEPS 即可。
 *
 * 唯一的约束是**一轮 session 内不能改**：重做队列 retryStagesByWord 存的是
 * 下标，中途换顺序会让它指向另一步。调用方负责在开始答题后锁住排序入口。
 */
export type ReviewStepKey = 'pronunciation' | 'recognition' | 'recall'

export const DEFAULT_STEP_ORDER: ReviewStepKey[] = [
  'pronunciation',
  'recognition',
  'recall',
]

const STORAGE_PREFIX = 'review-step-order:'

function isValidOrder(value: unknown): value is ReviewStepKey[] {
  if (!Array.isArray(value)) return false
  if (value.length !== DEFAULT_STEP_ORDER.length) return false
  // 必须是三个 key 的一个排列 —— 少一个、多一个、重复都不收。老版本写进去的
  // 数据、手改过的数据都可能不合法，一律回落到默认顺序。
  return DEFAULT_STEP_ORDER.every((key) => value.filter((v) => v === key).length === 1)
}

export function loadStepOrder(folderId: string): ReviewStepKey[] {
  if (typeof window === 'undefined' || !folderId) return [...DEFAULT_STEP_ORDER]
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + folderId)
    if (!raw) return [...DEFAULT_STEP_ORDER]
    const parsed: unknown = JSON.parse(raw)
    return isValidOrder(parsed) ? [...parsed] : [...DEFAULT_STEP_ORDER]
  } catch {
    return [...DEFAULT_STEP_ORDER]
  }
}

export function saveStepOrder(folderId: string, order: ReviewStepKey[]) {
  if (typeof window === 'undefined' || !folderId) return
  if (!isValidOrder(order)) return
  try {
    window.localStorage.setItem(STORAGE_PREFIX + folderId, JSON.stringify(order))
  } catch {
    // Private mode / quota — 本轮内存里的顺序仍然生效。
  }
}

/** 把 index 位置的那一步往前/往后挪一格，返回新数组（越界时原样返回）。 */
export function moveStep(
  order: ReviewStepKey[],
  index: number,
  direction: -1 | 1,
): ReviewStepKey[] {
  const target = index + direction
  if (index < 0 || index >= order.length) return order
  if (target < 0 || target >= order.length) return order
  const next = [...order]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}
