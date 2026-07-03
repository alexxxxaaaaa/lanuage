import { prisma } from '../lib/prisma'
import { AppError } from '../errors/AppError'

type CreateGrammarInput = {
  pattern: string
  connection?: string
  meaning?: string
  example?: string
  exampleZh?: string
  note?: string
  level?: string
}

type UpdateGrammarInput = Partial<CreateGrammarInput> & {
  isPinned?: boolean
  isLearned?: boolean
}

export type GrammarLearnedFilter = 'learned' | 'unlearned' | undefined

function sanitizeUnicode(input: string) {
  return input.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    '',
  )
}

function normalize(input?: string) {
  return sanitizeUnicode((input ?? '').trim())
}

function mapUniqueError(error: unknown): never {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : ''
  if (code === 'P2002') {
    throw new AppError('grammar already exists', 409)
  }
  throw error
}

export async function createGrammar(userId: string, input: CreateGrammarInput) {
  const pattern = normalize(input.pattern)
  if (!pattern) throw new AppError('pattern is required', 400)

  try {
    return await prisma.grammar.create({
      data: {
        pattern,
        connection: normalize(input.connection),
        meaning: normalize(input.meaning),
        example: normalize(input.example),
        exampleZh: normalize(input.exampleZh),
        note: normalize(input.note),
        level: normalize(input.level) || 'N1',
        userId,
        // New rows get pinnedAt = now so they surface at the top of the
        // unified pinnedAt-desc timeline (same semantics as Word).
        pinnedAt: new Date(),
      },
    })
  } catch (error) {
    mapUniqueError(error)
  }
}

export async function getGrammars(
  userId: string,
  query?: string,
  level?: string,
  learned?: GrammarLearnedFilter,
) {
  const normalized = query?.trim()
  return prisma.grammar.findMany({
    where: {
      userId,
      ...(level ? { level } : {}),
      ...(learned === 'learned' ? { isLearned: true } : {}),
      ...(learned === 'unlearned' ? { isLearned: false } : {}),
      ...(normalized
        ? {
            OR: [
              { pattern: { contains: normalized } },
              { meaning: { contains: normalized } },
              { example: { contains: normalized } },
              { exampleZh: { contains: normalized } },
            ],
          }
        : {}),
    },
    // Unified pinnedAt-desc timeline — same as Word. Most-recently created
    // or user-pinned items surface to the top.
    orderBy: [{ pinnedAt: 'desc' }, { createdAt: 'desc' }],
  })
}

export async function getGrammar(userId: string, id: string) {
  const grammar = await prisma.grammar.findFirst({ where: { id, userId } })
  if (!grammar) throw new AppError('grammar not found', 404)
  return grammar
}

export async function updateGrammar(
  userId: string,
  id: string,
  updates: UpdateGrammarInput,
) {
  const existing = await prisma.grammar.findFirst({ where: { id, userId } })
  if (!existing) throw new AppError('grammar not found', 404)

  const data: Record<string, string | boolean | Date> = {}
  const allowed: Array<keyof CreateGrammarInput> = [
    'pattern',
    'connection',
    'meaning',
    'example',
    'exampleZh',
    'note',
    'level',
  ]
  for (const field of allowed) {
    const value = updates[field]
    if (value === undefined) continue
    const normalized = normalize(value)
    if (field === 'pattern' && !normalized) {
      throw new AppError('pattern cannot be empty', 400)
    }
    data[field] = normalized
  }

  // Pin = bump to top. Re-stamp pinnedAt on every isPinned:true call (no unpin
  // operation — mirrors Word). Frontend's "置顶" button just calls this with
  // isPinned:true and the row jumps to position #1.
  if (updates.isPinned === true) {
    data.isPinned = true
    data.pinnedAt = new Date()
  }

  // Manual learn-state toggle: true / false both accepted (this one IS a
  // toggle, unlike pin). Used by the list-page "已学/未学" buttons and
  // automatically set to true when LearnGrammarPage records first review.
  if (updates.isLearned !== undefined) {
    data.isLearned = updates.isLearned
  }

  if (Object.keys(data).length === 0) return existing

  try {
    return await prisma.grammar.update({ where: { id }, data })
  } catch (error) {
    mapUniqueError(error)
  }
}

export async function deleteGrammar(userId: string, id: string) {
  const existing = await prisma.grammar.findFirst({ where: { id, userId } })
  if (!existing) throw new AppError('grammar not found', 404)
  await prisma.grammar.delete({ where: { id } })
  return { id }
}
