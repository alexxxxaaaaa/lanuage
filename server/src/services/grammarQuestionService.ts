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

// Return a single flat list of questions across all grammars — the practice
// page shuffles them client-side so the user gets a mixed drill rather than
// batches per grammar. `mode`:
//   - 'all'   → every question attached to any grammar this user owns
//   - 'wrong' → only questions the user last answered incorrectly
export async function listAllQuestions(
  userId: string,
  mode: 'all' | 'wrong',
): Promise<GrammarQuestionOut[]> {
  // Raw JOIN — D1 caps bound parameters around ~100, so an `IN` over ~140
  // grammarIds blows up. Scope via the Grammar JOIN with a single bound param.
  const questionRows = await prisma.$queryRaw<
    Array<{
      id: string
      grammarId: string
      grammarPattern: string
      grammarMeaning: string
      prompt: string
      options: string
      answerIndex: number
    }>
  >`
    SELECT gq.id, gq.grammarId, gq.prompt, gq.options, gq.answerIndex,
           g.pattern AS grammarPattern, g.meaning AS grammarMeaning
    FROM GrammarQuestion gq
    JOIN Grammar g ON g.id = gq.grammarId
    WHERE g.userId = ${userId}
  `

  const attemptRows = await prisma.$queryRaw<
    Array<{ questionId: string; selectedIndex: number; isCorrect: number }>
  >`
    SELECT questionId, selectedIndex, isCorrect
    FROM GrammarQuestionAttempt
    WHERE userId = ${userId}
  `
  const attemptByQuestion = new Map<
    string,
    { selectedIndex: number; isCorrect: boolean }
  >()
  for (const a of attemptRows) {
    attemptByQuestion.set(a.questionId, {
      selectedIndex: a.selectedIndex,
      isCorrect: a.isCorrect === 1 || (a.isCorrect as unknown) === true,
    })
  }

  const out: GrammarQuestionOut[] = []
  for (const q of questionRows) {
    const attempt = attemptByQuestion.get(q.id) ?? null
    if (mode === 'wrong' && (!attempt || attempt.isCorrect)) continue
    out.push({
      id: q.id,
      grammarId: q.grammarId,
      grammarPattern: q.grammarPattern,
      grammarMeaning: q.grammarMeaning,
      prompt: q.prompt,
      options: parseOptions(q.options),
      answerIndex: q.answerIndex,
      attempt,
    })
  }
  return out
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
