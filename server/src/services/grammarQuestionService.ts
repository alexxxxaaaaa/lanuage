import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { AppError } from '../errors/AppError'

export type GrammarQuestionOut = {
  id: string
  grammarId: string
  // The grammar pattern this question is testing — displayed on each card so
  // the shuffled flat list is still informative.
  grammarPattern: string
  grammarMeaning: string
  prompt: string
  options: string[]
  answerIndex: number
  /** 这题考的知识点，答完才显示。空串 = 还没标注。 */
  testedPoint: string
  /** 用户手写的备注。空串 = 没写过。 */
  note: string
  attempt: {
    selectedIndex: number
    isCorrect: boolean
  } | null
}

function parseOptions(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) {
      return parsed
    }
  } catch {}
  return []
}

export type QuestionPage = {
  items: GrammarQuestionOut[]
  /** 当前 mode 下的总题数，给分页器算页数用。 */
  total: number
}

export const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200

// 分页返回题目。`mode`:
//   - 'all'   → 这个用户名下所有题
//   - 'wrong' → 只有上次答错的
//
// 两个必须这样写的地方：
//
// 1. 排序用 `gq.createdAt, gq.rowid`。单靠 createdAt 不行 —— 导入的 2639 道题
//    是分 27 条批量 INSERT 灌进去的，而 CURRENT_TIMESTAMP 在一条语句内是常量，
//    所以它们的 createdAt 几乎全一样。次序不稳定的分页会漏题和重复出题。
//    rowid 递增，正好等于导入顺序（也就是题号顺序）。
//
// 2. 'wrong' 的过滤下推到 SQL。以前是把全部题捞回来在 JS 里筛，分页之后这么
//    做就错了：拿到第一页 50 条再筛，结果只剩几道，页数也算不出来。
export async function listAllQuestions(
  userId: string,
  mode: 'all' | 'wrong',
  page = 1,
  pageSize: number = DEFAULT_PAGE_SIZE,
  keyword = '',
): Promise<QuestionPage> {
  const safeSize = Math.min(Math.max(1, Math.floor(pageSize)), MAX_PAGE_SIZE)
  const safePage = Math.max(1, Math.floor(page))
  const offset = (safePage - 1) * safeSize
  const wrongOnly = mode === 'wrong'

  // Raw JOIN — D1 caps bound parameters around ~100, so an `IN` over ~140
  // grammarIds blows up. Scope via the Grammar JOIN with a single bound param.
  const wrongFilter = wrongOnly
    ? Prisma.sql`AND a.id IS NOT NULL AND a.isCorrect = 0`
    : Prisma.empty

  // 关键词也得下推。留在前端就只能筛当前一页，搜索框会变成假的。
  const trimmedKeyword = keyword.trim()
  const like = `%${trimmedKeyword}%`
  const keywordFilter = trimmedKeyword
    ? Prisma.sql`AND (gq.prompt LIKE ${like} OR gq.testedPoint LIKE ${like} OR g.pattern LIKE ${like} OR g.meaning LIKE ${like})`
    : Prisma.empty

  const totalRows = await prisma.$queryRaw<Array<{ n: number | bigint }>>`
    SELECT COUNT(*) AS n
    FROM GrammarQuestion gq
    JOIN Grammar g ON g.id = gq.grammarId
    LEFT JOIN GrammarQuestionAttempt a
      ON a.questionId = gq.id AND a.userId = ${userId}
    WHERE g.userId = ${userId}
    ${wrongFilter}
    ${keywordFilter}
  `
  const total = Number(totalRows[0]?.n ?? 0)

  const rows = await prisma.$queryRaw<
    Array<{
      id: string
      grammarId: string
      grammarPattern: string
      grammarMeaning: string
      prompt: string
      options: string
      answerIndex: number
      testedPoint: string
      note: string
      selectedIndex: number | null
      isCorrect: number | null
    }>
  >`
    SELECT gq.id, gq.grammarId, gq.prompt, gq.options, gq.answerIndex,
           gq.testedPoint, gq.note,
           g.pattern AS grammarPattern, g.meaning AS grammarMeaning,
           a.selectedIndex AS selectedIndex, a.isCorrect AS isCorrect
    FROM GrammarQuestion gq
    JOIN Grammar g ON g.id = gq.grammarId
    LEFT JOIN GrammarQuestionAttempt a
      ON a.questionId = gq.id AND a.userId = ${userId}
    WHERE g.userId = ${userId}
    ${wrongFilter}
    ${keywordFilter}
    ORDER BY gq.createdAt ASC, gq.rowid ASC
    LIMIT ${safeSize} OFFSET ${offset}
  `

  const items = rows.map((q) => ({
    id: q.id,
    grammarId: q.grammarId,
    grammarPattern: q.grammarPattern,
    grammarMeaning: q.grammarMeaning,
    prompt: q.prompt,
    options: parseOptions(q.options),
    answerIndex: q.answerIndex,
    testedPoint: q.testedPoint ?? '',
    note: q.note ?? '',
    attempt:
      q.selectedIndex === null
        ? null
        : {
            selectedIndex: q.selectedIndex,
            // D1 回布尔是 0/1，别直接当 boolean 用。
            isCorrect: q.isCorrect === 1 || (q.isCorrect as unknown) === true,
          },
  }))

  return { items, total }
}

export async function listQuestionsForGrammar(
  userId: string,
  grammarId: string,
): Promise<GrammarQuestionOut[]> {
  const grammar = await prisma.grammar.findFirst({
    where: { id: grammarId, userId },
    select: { id: true, pattern: true, meaning: true },
  })
  if (!grammar) throw new AppError('grammar not found', 404)

  const [questions, attemptRows] = await Promise.all([
    prisma.grammarQuestion.findMany({
      where: { grammarId },
      orderBy: { createdAt: 'asc' },
    }),
    // Raw query to avoid Prisma's nested-relation filter, which the D1 adapter
    // sometimes struggles with.
    prisma.$queryRaw<
      Array<{ questionId: string; selectedIndex: number; isCorrect: number }>
    >`
      SELECT a.questionId, a.selectedIndex, a.isCorrect
      FROM GrammarQuestionAttempt a
      JOIN GrammarQuestion q ON q.id = a.questionId
      WHERE a.userId = ${userId} AND q.grammarId = ${grammarId}
    `,
  ])
  const attemptMap = new Map(
    attemptRows.map(
      (a) =>
        [
          a.questionId,
          {
            selectedIndex: a.selectedIndex,
            isCorrect: a.isCorrect === 1 || (a.isCorrect as unknown) === true,
          },
        ] as const,
    ),
  )
  return questions.map((q) => {
    const attempt = attemptMap.get(q.id)
    return {
      id: q.id,
      grammarId: q.grammarId,
      grammarPattern: grammar.pattern,
      grammarMeaning: grammar.meaning,
      prompt: q.prompt,
      options: parseOptions(q.options),
      answerIndex: q.answerIndex,
      testedPoint: q.testedPoint ?? '',
      note: q.note ?? '',
      attempt: attempt
        ? { selectedIndex: attempt.selectedIndex, isCorrect: attempt.isCorrect }
        : null,
    }
  })
}

export async function submitAttempt(
  userId: string,
  questionId: string,
  selectedIndex: number,
) {
  const question = await prisma.grammarQuestion.findUnique({
    where: { id: questionId },
    include: { grammar: { select: { userId: true } } },
  })
  if (!question) throw new AppError('question not found', 404)
  if (question.grammar.userId !== userId) {
    throw new AppError('forbidden', 403)
  }
  if (selectedIndex < 0 || selectedIndex > 3) {
    throw new AppError('invalid selectedIndex', 400)
  }
  const isCorrect = selectedIndex === question.answerIndex

  // Upsert per (userId, questionId): overwrite so the "wrong" view always
  // shows the user's most recent attempt.
  await prisma.grammarQuestionAttempt.upsert({
    where: {
      userId_questionId: { userId, questionId },
    },
    create: {
      userId,
      questionId,
      selectedIndex,
      isCorrect,
    },
    update: {
      selectedIndex,
      isCorrect,
      updatedAt: new Date(),
    },
  })
  return { isCorrect, answerIndex: question.answerIndex }
}

/** 备注长度上限。够写几行思路，又不至于让列表接口被一条备注撑爆。 */
const MAX_NOTE_LENGTH = 500

export async function updateQuestionNote(
  userId: string,
  questionId: string,
  note: string,
) {
  // 归属校验和 submitAttempt 一致：题本身不带 userId，得穿到 grammar 上看。
  const question = await prisma.grammarQuestion.findUnique({
    where: { id: questionId },
    include: { grammar: { select: { userId: true } } },
  })
  if (!question) throw new AppError('question not found', 404)
  if (question.grammar.userId !== userId) {
    throw new AppError('forbidden', 403)
  }
  const trimmed = note.trim().slice(0, MAX_NOTE_LENGTH)
  await prisma.grammarQuestion.update({
    where: { id: questionId },
    data: { note: trimmed },
  })
  return { note: trimmed }
}
