import { prisma } from '../lib/prisma'
import { AppError } from '../errors/AppError'
import { loadTotals, mediaUrl, parseOptions, resolveImages } from './qbankService'

/**
 * 模拟考试：把题库里的一套真题当整卷来考。
 *
 * 与「精练」共用 QbankQuestion / QbankPassage，但用户数据完全分开
 * （QbankExamAttempt 一张表），所以考试不会冲掉平时的答题卡和错题本。
 *
 * 两个阶段串行推进，靠 QbankExamAttempt 上的两个时间戳判定：
 *   written（文字・語彙 + 文法 + 読解，110 分计时）
 *     ↓ writtenSubmittedAt —— 交卷即锁定，此后笔试答案不可改
 *   listening（聴解，听完整段录音）
 *     ↓ finishedAt —— 定格成绩，全卷进入可查看解析的状态
 *
 * 未交卷的阶段，出参里**不带** answer / explain / stemZh / passage(听力原文)，
 * 答案根本不下发到前端；这些字段只在 phase = done 时才出现。
 */

/** 官方时长：言語知識（文字・語彙・文法）・読解 110 分、聴解 55 分（2022 年 12 月起）。 */
export const WRITTEN_MINUTES = 110
export const LISTENING_MINUTES = 55

export type ExamMode = 'strict' | 'self'
export type ExamPhase = 'written' | 'listening' | 'done'

const WRITTEN_CATEGORIES = ['vocab', 'grammar', 'reading']

/** 计分分区：三块各 0–60 分，与官方成绩单一致。 */
const SECTIONS = [
  { key: 'language', categories: ['vocab', 'grammar'] },
  { key: 'reading', categories: ['reading'] },
  { key: 'listening', categories: ['listening'] },
] as const

const SECTION_MAX = 60
// 官方合格线：总分 ≥ 100 且每个分区 ≥ 19。
const PASS_TOTAL = 100
const PASS_SECTION = 19

export type ExamScore = {
  correct: number
  total: number
  /** 估算得点 0–180。官方换算表不公开，这里按各分区正答率折算。 */
  points: number
  passed: boolean
  sections: Array<{ key: string; correct: number; total: number; points: number }>
}

export type ExamPaper = {
  year: number
  month: number
  writtenTotal: number
  listeningTotal: number
  attempt: ExamAttemptSummary | null
}

export type ExamAttemptSummary = {
  mode: ExamMode
  phase: ExamPhase
  startedAt: string
  writtenSubmittedAt: string | null
  finishedAt: string | null
  answered: number
  score: ExamScore | null
}

export type ExamQuestion = {
  id: string
  seq: string
  category: string
  mondaiNo: number
  stemJp: string
  options: string[]
  passageId: string | null
  audioUrl: string
  /** 以下只在 phase = done 时出现。 */
  answer?: number
  stemZh?: string
  explain?: string
  dispute?: string
}

export type ExamState = {
  year: number
  month: number
  mode: ExamMode
  phase: ExamPhase
  startedAt: string
  writtenSubmittedAt: string | null
  finishedAt: string | null
  writtenMinutes: number
  listeningMinutes: number
  answers: Record<string, number>
  questions: ExamQuestion[]
  passages: Array<{ id: string; code: string; type: string; content: string }>
  score: ExamScore | null
}

// ===== 工具 =====

export function parseExamMode(raw: unknown): ExamMode {
  return raw === 'self' ? 'self' : 'strict'
}

function parseAnswers(raw: string): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(raw || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, number> = {}
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      const n = Number(value)
      if (Number.isInteger(n) && n >= 1 && n <= 4) out[id] = n
    }
    return out
  } catch {
    return {}
  }
}

function parseScore(raw: string): ExamScore | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as ExamScore
  } catch {
    return null
  }
}

function iso(value: Date | null): string | null {
  return value ? new Date(value).toISOString() : null
}

type AttemptRow = {
  id: string
  mode: string
  answers: string
  score: string
  startedAt: Date
  writtenSubmittedAt: Date | null
  finishedAt: Date | null
}

function phaseOf(attempt: Pick<AttemptRow, 'writtenSubmittedAt' | 'finishedAt'>): ExamPhase {
  if (attempt.finishedAt) return 'done'
  if (attempt.writtenSubmittedAt) return 'listening'
  return 'written'
}

function isInPhase(category: string, phase: ExamPhase): boolean {
  if (phase === 'listening') return category === 'listening'
  if (phase === 'written') return category !== 'listening'
  return true
}

// ===== 卷内索引（静态数据，进程内缓存） =====

type IndexRow = { id: string; category: string; answer: number }

const paperIndexCache = new Map<string, IndexRow[]>()

/** 一套卷的 (题 id, 分区, 答案)。校验作答归属和判分都只需要这些。 */
async function loadPaperIndex(level: string, year: number, month: number): Promise<IndexRow[]> {
  const key = `${level}|${year}|${month}`
  const cached = paperIndexCache.get(key)
  if (cached) return cached
  const rows = await prisma.qbankQuestion.findMany({
    where: { level, year, month },
    select: { id: true, category: true, answer: true },
    orderBy: { orderNo: 'asc' },
  })
  if (rows.length === 0) throw new AppError('这套卷子不在题库里', 404)
  paperIndexCache.set(key, rows)
  return rows
}

function grade(index: IndexRow[], answers: Record<string, number>): ExamScore {
  const byCategory = new Map<string, { correct: number; total: number }>()
  for (const row of index) {
    const bucket = byCategory.get(row.category) ?? { correct: 0, total: 0 }
    bucket.total += 1
    if (answers[row.id] === row.answer) bucket.correct += 1
    byCategory.set(row.category, bucket)
  }

  const sections = SECTIONS.map((section) => {
    let correct = 0
    let total = 0
    for (const category of section.categories) {
      const bucket = byCategory.get(category)
      if (!bucket) continue
      correct += bucket.correct
      total += bucket.total
    }
    return {
      key: section.key,
      correct,
      total,
      points: total > 0 ? Math.round((correct / total) * SECTION_MAX) : 0,
    }
  })

  const correct = sections.reduce((sum, s) => sum + s.correct, 0)
  const total = sections.reduce((sum, s) => sum + s.total, 0)
  const points = sections.reduce((sum, s) => sum + s.points, 0)
  return {
    correct,
    total,
    points,
    passed: points >= PASS_TOTAL && sections.every((s) => s.total === 0 || s.points >= PASS_SECTION),
    sections,
  }
}

// ===== 卷子列表 =====

export async function listExamPapers(userId: string, level: string): Promise<ExamPaper[]> {
  const [totals, attempts] = await Promise.all([
    loadTotals(level),
    prisma.qbankExamAttempt.findMany({ where: { userId, level } }),
  ])

  const papers = new Map<string, ExamPaper>()
  for (const row of totals) {
    const key = `${row.year}|${row.month}`
    const paper =
      papers.get(key) ??
      ({ year: row.year, month: row.month, writtenTotal: 0, listeningTotal: 0, attempt: null } satisfies ExamPaper)
    if (row.category === 'listening') paper.listeningTotal += row.total
    else paper.writtenTotal += row.total
    papers.set(key, paper)
  }

  for (const attempt of attempts) {
    const paper = papers.get(`${attempt.year}|${attempt.month}`)
    if (!paper) continue
    paper.attempt = {
      mode: parseExamMode(attempt.mode),
      phase: phaseOf(attempt),
      startedAt: new Date(attempt.startedAt).toISOString(),
      writtenSubmittedAt: iso(attempt.writtenSubmittedAt),
      finishedAt: iso(attempt.finishedAt),
      answered: Object.keys(parseAnswers(attempt.answers)).length,
      score: parseScore(attempt.score),
    }
  }

  // 新的排前面，跟真题列表的直觉一致。
  return [...papers.values()].sort((a, b) => b.year - a.year || b.month - a.month)
}

// ===== 开考 / 重置 =====

export async function startExam(
  userId: string,
  level: string,
  year: number,
  month: number,
  mode: ExamMode,
): Promise<void> {
  await loadPaperIndex(level, year, month)
  const existing = await prisma.qbankExamAttempt.findUnique({
    where: { userId_level_year_month: { userId, level, year, month } },
    select: { id: true },
  })
  if (existing) throw new AppError('这套卷子已经开考了，先重置才能重来', 409)
  await prisma.qbankExamAttempt.create({ data: { userId, level, year, month, mode } })
}

export async function resetExam(
  userId: string,
  level: string,
  year: number,
  month: number,
): Promise<{ reset: boolean }> {
  const deleted = await prisma.qbankExamAttempt.deleteMany({ where: { userId, level, year, month } })
  return { reset: deleted.count > 0 }
}

// ===== 考试状态（含当前阶段的题目） =====

async function requireAttempt(
  userId: string,
  level: string,
  year: number,
  month: number,
): Promise<AttemptRow> {
  const attempt = await prisma.qbankExamAttempt.findUnique({
    where: { userId_level_year_month: { userId, level, year, month } },
  })
  if (!attempt) throw new AppError('这套卷子还没开考', 404)
  return attempt
}

export async function getExamState(
  userId: string,
  level: string,
  year: number,
  month: number,
): Promise<ExamState> {
  const attempt = await requireAttempt(userId, level, year, month)
  const phase = phaseOf(attempt)
  const isDone = phase === 'done'

  const [rows, allPassages] = await Promise.all([
    prisma.qbankQuestion.findMany({
      where: {
        level,
        year,
        month,
        ...(isDone
          ? {}
          : phase === 'listening'
            ? { category: 'listening' }
            : { category: { in: WRITTEN_CATEGORIES } }),
      },
      orderBy: { orderNo: 'asc' },
    }),
    prisma.qbankPassage.findMany({ where: { level, year, month } }),
  ])

  const questions: ExamQuestion[] = rows.map((q) => ({
    id: q.id,
    seq: q.seq,
    category: q.category,
    mondaiNo: q.mondaiNo,
    stemJp: q.stemJp,
    options: parseOptions(q.options),
    passageId: q.passageId,
    audioUrl: mediaUrl(q.audioKey),
    ...(isDone
      ? { answer: q.answer, stemZh: q.stemZh, explain: q.explain, dispute: q.dispute }
      : {}),
  }))

  // 听力原文也是 passage，未交卷时连着题目一起被上面的 where 挡在外面；
  // 这里再按引用过滤一次，确保不会顺手把别的阶段的材料带出去。
  const referenced = new Set(questions.map((q) => q.passageId).filter(Boolean))
  const passages = allPassages
    .filter((p) => referenced.has(p.id))
    .map((p) => ({ id: p.id, code: p.code, type: p.type, content: resolveImages(p.content) }))

  const answers = parseAnswers(attempt.answers)
  const visible = new Set(questions.map((q) => q.id))
  return {
    year,
    month,
    mode: parseExamMode(attempt.mode),
    phase,
    startedAt: new Date(attempt.startedAt).toISOString(),
    writtenSubmittedAt: iso(attempt.writtenSubmittedAt),
    finishedAt: iso(attempt.finishedAt),
    writtenMinutes: WRITTEN_MINUTES,
    listeningMinutes: LISTENING_MINUTES,
    // 未交卷时只回当前阶段的作答，上一阶段的答案不再下发。
    answers: isDone
      ? answers
      : Object.fromEntries(Object.entries(answers).filter(([id]) => visible.has(id))),
    questions,
    passages,
    score: parseScore(attempt.score),
  }
}

// ===== 作答 / 交卷 =====

/** 覆盖当前阶段的作答；别的阶段（已交卷的部分）原样保留。 */
export async function saveExamAnswers(
  userId: string,
  level: string,
  year: number,
  month: number,
  patch: Record<string, unknown>,
): Promise<{ answered: number }> {
  const attempt = await requireAttempt(userId, level, year, month)
  const phase = phaseOf(attempt)
  if (phase === 'done') throw new AppError('这场考试已交卷，答案不能再改', 409)

  const index = await loadPaperIndex(level, year, month)
  const editable = new Set(index.filter((q) => isInPhase(q.category, phase)).map((q) => q.id))

  const next: Record<string, number> = {}
  for (const [id, selected] of Object.entries(parseAnswers(attempt.answers))) {
    if (!editable.has(id)) next[id] = selected
  }
  for (const [id, value] of Object.entries(patch)) {
    if (!editable.has(id)) continue
    const selected = Number(value)
    if (Number.isInteger(selected) && selected >= 1 && selected <= 4) next[id] = selected
  }

  await prisma.qbankExamAttempt.update({
    where: { id: attempt.id },
    data: { answers: JSON.stringify(next) },
  })
  return { answered: Object.keys(next).length }
}

export async function submitExamPhase(
  userId: string,
  level: string,
  year: number,
  month: number,
  phase: 'written' | 'listening',
): Promise<{ phase: ExamPhase; score: ExamScore | null }> {
  const attempt = await requireAttempt(userId, level, year, month)
  const current = phaseOf(attempt)
  if (current !== phase) {
    throw new AppError(
      current === 'done' ? '这场考试已经交卷了' : '当前阶段和提交的阶段对不上，刷新一下页面',
      409,
    )
  }

  const index = await loadPaperIndex(level, year, month)
  const now = new Date()

  // 笔试交卷后还有听力要考；除非这套卷子压根没有听力题，那就直接出分。
  if (phase === 'written' && index.some((q) => q.category === 'listening')) {
    await prisma.qbankExamAttempt.update({
      where: { id: attempt.id },
      data: { writtenSubmittedAt: now },
    })
    return { phase: 'listening', score: null }
  }

  const score = grade(index, parseAnswers(attempt.answers))
  await prisma.qbankExamAttempt.update({
    where: { id: attempt.id },
    data: {
      ...(phase === 'written' ? { writtenSubmittedAt: now } : {}),
      finishedAt: now,
      score: JSON.stringify(score),
    },
  })
  return { phase: 'done', score }
}

// ===== 收错题 =====

// D1 单条语句的绑定参数上限约 100，一行 4 个参数，按 20 行一批切。
const UPSERT_CHUNK = 20

/**
 * 把这场考试答错的题写进平时的错题本（QbankAttempt）。
 * 答对的题不写，免得考试成绩顺手把练习进度也一起覆盖了。
 */
export async function collectExamWrongQuestions(
  userId: string,
  level: string,
  year: number,
  month: number,
): Promise<{ collected: number }> {
  const attempt = await requireAttempt(userId, level, year, month)
  if (phaseOf(attempt) !== 'done') throw new AppError('交卷之后才能收错题', 409)

  const index = await loadPaperIndex(level, year, month)
  const answers = parseAnswers(attempt.answers)
  const wrong = index.filter((q) => answers[q.id] !== undefined && answers[q.id] !== q.answer)

  for (let i = 0; i < wrong.length; i += UPSERT_CHUNK) {
    const chunk = wrong.slice(i, i + UPSERT_CHUNK)
    const values = chunk.map(() => '(?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)').join(', ')
    const params = chunk.flatMap((q) => [crypto.randomUUID(), userId, q.id, answers[q.id]])
    await prisma.$executeRawUnsafe(
      `INSERT INTO QbankAttempt (id, userId, questionId, selected, isCorrect, createdAt, updatedAt)
       VALUES ${values}
       ON CONFLICT (userId, questionId) DO UPDATE
         SET selected = excluded.selected,
             isCorrect = excluded.isCorrect,
             updatedAt = CURRENT_TIMESTAMP`,
      ...params,
    )
  }
  return { collected: wrong.length }
}
