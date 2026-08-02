import { prisma } from '../lib/prisma'
import { getEnv } from '../lib/env'
import { AppError } from '../errors/AppError'

/**
 * JLPT 精练题库。题目本身是全局共享的静态数据，用户数据只有
 * QbankAttempt（最近一次作答）和 QbankFavorite（收藏）两张表。
 *
 * 前端的取数分两步，避免一次拉几百道题：
 *   1. /set    → 练习集的**目录**（id + 题号 + 对错 + 是否收藏），几十 KB 封顶
 *   2. /questions?ids=… → 按需取正文，一次一屏
 * 这样「問題9 全年份」这种 270 题、1 MB 正文的集合也能秒开。
 */

const MEDIA_BASE_DEFAULT = 'https://pub-942012cb760d44d7a0c78abce8d4d0c5.r2.dev/qbank/'

// D1 对单条语句的绑定参数数量有上限（~100），批量取正文时按这个数封顶。
export const MAX_QUESTION_IDS = 50

const CATEGORIES = new Set(['vocab', 'grammar', 'reading', 'listening'])
type Scope = 'all' | 'favorite' | 'wrong'

function mediaBase(): string {
  const raw = getEnv('QBANK_MEDIA_BASE') ?? MEDIA_BASE_DEFAULT
  return raw.endsWith('/') ? raw : `${raw}/`
}

/** audio/2020.12/1-1.mp3 → https://…/qbank/audio/2020.12/1-1.mp3 */
function mediaUrl(key: string): string {
  return key ? `${mediaBase()}${key}` : ''
}

/** 文章正文里的 ![](images/2013.07/x.png) 指向媒体根，出库时补成绝对地址。 */
function resolveImages(content: string): string {
  return content.replace(/\]\(images\//g, `](${mediaBase()}images/`)
}

function parseOptions(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.map((v) => String(v))
  } catch {
    // 落库时就是 JSON.stringify 写进去的，这里兜底成空数组即可
  }
  return []
}

// D1 的布尔值回来可能是 0/1，也可能已经是 boolean。
function toBool(v: unknown): boolean {
  return v === true || v === 1
}

export type SetFilter = {
  level: string
  category?: string
  mondaiNo?: number
  year?: number
  month?: number
  scope: Scope
}

export function parseSetFilter(query: Record<string, string | undefined>): SetFilter {
  const category = query.category && CATEGORIES.has(query.category) ? query.category : undefined
  const mondaiNo = Number(query.mondaiNo)
  const year = Number(query.year)
  const month = Number(query.month)
  const scope: Scope =
    query.scope === 'favorite' || query.scope === 'wrong' ? query.scope : 'all'
  // 年月成对才有意义（一场考试 = 年 + 月），只给一个就当没给。
  const hasPaper = Number.isInteger(year) && Number.isInteger(month) && year > 0 && month > 0
  return {
    level: query.level || 'N1',
    category,
    mondaiNo: Number.isInteger(mondaiNo) && mondaiNo > 0 ? mondaiNo : undefined,
    year: hasPaper ? year : undefined,
    month: hasPaper ? month : undefined,
    scope,
  }
}

// ===== 目录树 =====

export type OverviewGroup = {
  category: string
  mondaiNo: number
  total: number
  answered: number
  correct: number
  papers: Array<{
    year: number
    month: number
    total: number
    answered: number
    correct: number
  }>
}

export type Overview = {
  groups: OverviewGroup[]
  favoriteCount: number
  wrongCount: number
}

type TotalsRow = { category: string; mondaiNo: number; year: number; month: number; total: number }

// 题库是静态的，进程内缓存一份分组计数；用户维度的进度每次实时查。
const totalsCache = new Map<string, TotalsRow[]>()

async function loadTotals(level: string): Promise<TotalsRow[]> {
  const cached = totalsCache.get(level)
  if (cached) return cached
  const rows = await prisma.$queryRaw<Array<TotalsRow & { total: number | bigint }>>`
    SELECT category, mondaiNo, year, month, COUNT(*) AS total
    FROM QbankQuestion
    WHERE level = ${level}
    GROUP BY category, mondaiNo, year, month
    ORDER BY category, mondaiNo, year, month
  `
  const normalized = rows.map((r) => ({ ...r, total: Number(r.total) }))
  totalsCache.set(level, normalized)
  return normalized
}

export async function getOverview(userId: string, level: string): Promise<Overview> {
  const [totals, progress, favoriteCount, wrongCount] = await Promise.all([
    loadTotals(level),
    prisma.$queryRaw<
      Array<{
        category: string
        mondaiNo: number
        year: number
        month: number
        answered: number | bigint
        correct: number | bigint
      }>
    >`
      SELECT q.category, q.mondaiNo, q.year, q.month,
             COUNT(*) AS answered,
             SUM(CASE WHEN a.isCorrect THEN 1 ELSE 0 END) AS correct
      FROM QbankAttempt a
      JOIN QbankQuestion q ON q.id = a.questionId
      WHERE a.userId = ${userId} AND q.level = ${level}
      GROUP BY q.category, q.mondaiNo, q.year, q.month
    `,
    prisma.qbankFavorite.count({ where: { userId } }),
    prisma.qbankAttempt.count({ where: { userId, isCorrect: false } }),
  ])

  const key = (c: string, m: number, y: number, mo: number) => `${c}|${m}|${y}|${mo}`
  const progressByPaper = new Map(
    progress.map((p) => [
      key(p.category, p.mondaiNo, p.year, p.month),
      { answered: Number(p.answered), correct: Number(p.correct) },
    ]),
  )

  const groups: OverviewGroup[] = []
  let current: OverviewGroup | null = null
  for (const row of totals) {
    if (!current || current.category !== row.category || current.mondaiNo !== row.mondaiNo) {
      current = {
        category: row.category,
        mondaiNo: row.mondaiNo,
        total: 0,
        answered: 0,
        correct: 0,
        papers: [],
      }
      groups.push(current)
    }
    const done = progressByPaper.get(key(row.category, row.mondaiNo, row.year, row.month)) ?? {
      answered: 0,
      correct: 0,
    }
    current.total += row.total
    current.answered += done.answered
    current.correct += done.correct
    current.papers.push({
      year: row.year,
      month: row.month,
      total: row.total,
      answered: done.answered,
      correct: done.correct,
    })
  }

  return { groups, favoriteCount, wrongCount }
}

// ===== 练习集目录 =====

export type SetItem = {
  id: string
  seq: string
  year: number
  month: number
  category: string
  mondaiNo: number
  status: 'correct' | 'wrong' | null
  favorite: boolean
}

/** 把筛选条件编译成 SQL 片段。占位符用 ?，值按顺序放进 params。 */
function whereClause(filter: SetFilter): { sql: string; params: unknown[] } {
  const conds = ['q.level = ?']
  const params: unknown[] = [filter.level]
  if (filter.category) {
    conds.push('q.category = ?')
    params.push(filter.category)
  }
  if (filter.mondaiNo) {
    conds.push('q.mondaiNo = ?')
    params.push(filter.mondaiNo)
  }
  if (filter.year && filter.month) {
    conds.push('q.year = ?', 'q.month = ?')
    params.push(filter.year, filter.month)
  }
  if (filter.scope === 'favorite') conds.push('f.id IS NOT NULL')
  if (filter.scope === 'wrong') conds.push('a.isCorrect = 0')
  return { sql: conds.join(' AND '), params }
}

/**
 * 一个练习集的有序目录。三种 scope 的排序刻意不同：
 *   all      → 按考试年月 + 卷内题序，跟做真题的顺序一致
 *   wrong    → 最近做错的排前面，先啃新鲜的错题
 *   favorite → 最近收藏的排前面
 *
 * 走原生 SQL 而不是 Prisma 的关联加载：后者会先查出几百上千个题目 id、
 * 再用 `IN (…)` 去捞 attempt/favorite，而 D1 的绑定参数上限只有 ~100，
 * 「問題9 全年份」这种 270 题的集合必炸。JOIN 一次搞定，参数只有几个。
 */
export async function getSet(
  userId: string,
  filter: SetFilter,
): Promise<{ total: number; items: SetItem[] }> {
  const { sql, params } = whereClause(filter)
  const orderBy =
    filter.scope === 'favorite'
      ? 'f.createdAt DESC'
      : filter.scope === 'wrong'
        ? 'a.updatedAt DESC'
        : 'q.year ASC, q.month ASC, q.orderNo ASC'

  const rows = await prisma.$queryRawUnsafe<
    Array<{
      id: string
      seq: string
      year: number
      month: number
      category: string
      mondaiNo: number
      isCorrect: number | boolean | null
      favoriteId: string | null
    }>
  >(
    `SELECT q.id, q.seq, q.year, q.month, q.category, q.mondaiNo,
            a.isCorrect AS isCorrect, f.id AS favoriteId
     FROM QbankQuestion q
     LEFT JOIN QbankAttempt a ON a.questionId = q.id AND a.userId = ?
     LEFT JOIN QbankFavorite f ON f.questionId = q.id AND f.userId = ?
     WHERE ${sql}
     ORDER BY ${orderBy}`,
    userId,
    userId,
    ...params,
  )

  const items: SetItem[] = rows.map((r) => ({
    id: r.id,
    seq: r.seq,
    year: r.year,
    month: r.month,
    category: r.category,
    mondaiNo: r.mondaiNo,
    status: r.isCorrect === null ? null : toBool(r.isCorrect) ? 'correct' : 'wrong',
    favorite: r.favoriteId !== null,
  }))
  return { total: items.length, items }
}

// ===== 题目正文 =====

export type QuestionDetail = {
  id: string
  seq: string
  year: number
  month: number
  category: string
  mondaiNo: number
  stemJp: string
  stemZh: string
  options: string[]
  answer: number
  explain: string
  audioUrl: string
  dispute: string
  passage: { code: string; type: string; content: string } | null
  status: 'correct' | 'wrong' | null
  selected: number | null
  favorite: boolean
}

export async function getQuestions(userId: string, ids: string[]): Promise<QuestionDetail[]> {
  if (ids.length === 0) return []
  if (ids.length > MAX_QUESTION_IDS) {
    throw new AppError(`一次最多取 ${MAX_QUESTION_IDS} 道题`, 400)
  }

  const rows = await prisma.qbankQuestion.findMany({
    where: { id: { in: ids } },
    include: {
      passage: { select: { code: true, type: true, content: true } },
      attempts: { where: { userId }, select: { selected: true, isCorrect: true } },
      favorites: { where: { userId }, select: { id: true } },
    },
  })

  const byId = new Map(rows.map((r) => [r.id, r]))
  // 按调用方给的顺序返回，前端不用再排一次。
  return ids.flatMap((id) => {
    const q = byId.get(id)
    if (!q) return []
    const attempt = q.attempts[0]
    return [
      {
        id: q.id,
        seq: q.seq,
        year: q.year,
        month: q.month,
        category: q.category,
        mondaiNo: q.mondaiNo,
        stemJp: q.stemJp,
        stemZh: q.stemZh,
        options: parseOptions(q.options),
        answer: q.answer,
        explain: q.explain,
        audioUrl: mediaUrl(q.audioKey),
        dispute: q.dispute,
        passage: q.passage
          ? { ...q.passage, content: resolveImages(q.passage.content) }
          : null,
        status: attempt ? (toBool(attempt.isCorrect) ? 'correct' : 'wrong') : null,
        selected: attempt?.selected ?? null,
        favorite: q.favorites.length > 0,
      },
    ]
  })
}

// ===== 作答 / 收藏 =====

export async function submitAttempt(userId: string, questionId: string, selected: number) {
  const question = await prisma.qbankQuestion.findUnique({
    where: { id: questionId },
    select: { answer: true, options: true },
  })
  if (!question) throw new AppError('题目不存在', 404)

  const optionCount = parseOptions(question.options).length
  if (!Number.isInteger(selected) || selected < 1 || selected > optionCount) {
    throw new AppError('选项不合法', 400)
  }

  const isCorrect = selected === question.answer
  await prisma.qbankAttempt.upsert({
    where: { userId_questionId: { userId, questionId } },
    create: { userId, questionId, selected, isCorrect },
    update: { selected, isCorrect, updatedAt: new Date() },
  })
  return { isCorrect, answer: question.answer }
}

/**
 * 清空答题卡：只删当前练习集范围内的作答，别的集合不受影响。
 * 同样用子查询而不是先查 id 再 `IN (…)`，理由见 getSet。
 */
export async function clearAttempts(userId: string, filter: SetFilter): Promise<number> {
  const { sql, params } = whereClause(filter)
  return prisma.$executeRawUnsafe(
    `DELETE FROM QbankAttempt
     WHERE userId = ?
       AND questionId IN (
         SELECT q.id FROM QbankQuestion q
         LEFT JOIN QbankAttempt a ON a.questionId = q.id AND a.userId = ?
         LEFT JOIN QbankFavorite f ON f.questionId = q.id AND f.userId = ?
         WHERE ${sql}
       )`,
    userId,
    userId,
    userId,
    ...params,
  )
}

export async function setFavorite(userId: string, questionId: string, favorite: boolean) {
  if (favorite) {
    const exists = await prisma.qbankQuestion.count({ where: { id: questionId } })
    if (!exists) throw new AppError('题目不存在', 404)
    await prisma.qbankFavorite.upsert({
      where: { userId_questionId: { userId, questionId } },
      create: { userId, questionId },
      update: {},
    })
  } else {
    await prisma.qbankFavorite.deleteMany({ where: { userId, questionId } })
  }
  return { favorite }
}
