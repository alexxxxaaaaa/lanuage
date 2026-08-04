import { prisma } from '../lib/prisma'
import { getEnv } from '../lib/env'
import { AppError } from '../errors/AppError'

// 蓝宝书的朗读和活用表图片跟题库共用 jlpt 桶，各挂各的前缀。
const MEDIA_BASE_DEFAULT =
  'https://pub-942012cb760d44d7a0c78abce8d4d0c5.r2.dev/grammar/'

function mediaBase(): string {
  const raw = getEnv('GRAMMAR_MEDIA_BASE') ?? MEDIA_BASE_DEFAULT
  return raw.endsWith('/') ? raw : `${raw}/`
}

type StoredExample = { jp: string; zh: string; tag: string; audio: string }

function parseJsonArray(raw: unknown): unknown[] {
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * 出库时把媒体文件名补成绝对地址 —— 库里存的是裸文件名，换 CDN 只要改环境变量。
 * 手工建的条目这几个字段是空的，原样返回，前端拿到空串就不渲染播放按钮。
 */
export function withMediaUrls<
  T extends { audioKey?: string; examples?: string; images?: string },
>(grammar: T) {
  const examples = (parseJsonArray(grammar.examples) as StoredExample[]).map((ex) => ({
    jp: ex.jp ?? '',
    zh: ex.zh ?? '',
    tag: ex.tag ?? '',
    audio: ex.audio ? `${mediaBase()}audio/${ex.audio}` : '',
  }))
  const images = (parseJsonArray(grammar.images) as string[])
    .filter((name) => typeof name === 'string' && name)
    .map((name) => `${mediaBase()}image/${name}`)
  return {
    ...grammar,
    audioKey: grammar.audioKey ? `${mediaBase()}audio/${grammar.audioKey}` : '',
    examples,
    images,
  }
}

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
    // 列表一次拉全量，不分页。装下整本蓝宝书之后这是 800 多行，带上结构化例句
    // 就是 1.7MB 的响应 —— 而列表卡片根本不渲染它们（examples 和 images 只有
    // 详情页读，note 只在详情页显示）。摘掉这三个字段，响应回到 300KB 上下。
    omit: { examples: true, images: true, note: true },
    // Unified pinnedAt-desc timeline — same as Word. Most-recently created
    // or user-pinned items surface to the top.
    orderBy: [{ pinnedAt: 'desc' }, { createdAt: 'desc' }],
  })
}

export async function getGrammar(userId: string, id: string) {
  const grammar = await prisma.grammar.findFirst({ where: { id, userId } })
  if (!grammar) throw new AppError('grammar not found', 404)
  return withMediaUrls(grammar)
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

  // 例句一旦被手工改过，就以改出来的纯文本为准：把结构化的那份清空，让详情页
  // 回落到 example / exampleZh。不清的话渲染优先读 examples，用户会发现自己改
  // 完保存了却什么都没变。
  if (
    (data.example !== undefined && data.example !== existing.example) ||
    (data.exampleZh !== undefined && data.exampleZh !== existing.exampleZh)
  ) {
    data.examples = '[]'
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
