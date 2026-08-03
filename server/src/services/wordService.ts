import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { flattenWord, WORD_FOLDERS } from '../lib/wordShape'
import { AppError } from '../errors/AppError'

/**
 * 「我的词」。一个用户一个词一行，词单归属挂在 WordFolder 上 —— 所以同一个词
 * 可以同时属于多个词单，而复习状态只有一份。对外仍然把归属摊平成
 * `folders` / `folderIds`，前端不用认识连接表。
 */

type CreateWordInput = {
  word: string
  reading: string
  meaning: string
  example: string
  note: string
  partOfSpeech: string
  sourceNoteId?: string
  language: string
  /** 加进哪些词单。词已经收录过就只是补挂缺的归属，不会再建一行。 */
  folderIds: string[]
}

type UpdateWordInput = Partial<
  Pick<CreateWordInput, 'word' | 'reading' | 'meaning' | 'example' | 'note' | 'partOfSpeech'>
> & {
  sourceNoteId?: string | null
  /** 全量覆盖这个词的词单归属。不传就不动。 */
  folderIds?: string[]
  /** 置顶 = 刷新 pinnedAt，把词顶回列表最前。没有「取消置顶」。 */
  isPinned?: boolean
}

const WORD_INCLUDE = {
  ...WORD_FOLDERS,
  sourceNote: true,
  review: true,
} satisfies Prisma.WordInclude

function assertRequiredField(value: string, fieldName: string) {
  if (!value.trim()) {
    throw new AppError(`${fieldName} is required`, 400)
  }
}

function sanitizeUnicode(input: string) {
  return input.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    '',
  )
}

function normalizeText(input?: string) {
  return sanitizeUnicode((input ?? '').trim())
}

function mapUniqueError(error: unknown): never {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : ''
  if (code === 'P2002') {
    throw new AppError('word already exists in your library', 409)
  }
  throw error
}

/** 取用户自己的词单，顺带校验语言 —— 词只能挂进同语言的词单。 */
async function loadOwnedFolders(userId: string, folderIds: string[], language: string) {
  const folders = await prisma.folder.findMany({
    where: { id: { in: folderIds }, userId },
  })
  if (folders.length !== folderIds.length) {
    throw new AppError('folder not found', 404)
  }
  if (folders.some((folder) => folder.language !== language)) {
    throw new AppError('word language must match folder language', 400)
  }
  return folders
}

export async function createWord(userId: string, input: CreateWordInput) {
  const word = normalizeText(input.word)
  const language = normalizeText(input.language)
  const folderIds = Array.from(
    new Set((input.folderIds ?? []).map((id) => normalizeText(id)).filter(Boolean)),
  )
  const sourceNoteId = normalizeText(input.sourceNoteId)

  assertRequiredField(word, 'word')
  assertRequiredField(input.reading, 'reading')
  assertRequiredField(language, 'language')
  if (folderIds.length === 0) {
    throw new AppError('folderIds is required', 400)
  }

  await loadOwnedFolders(userId, folderIds, language)

  if (sourceNoteId) {
    const sourceNote = await prisma.note.findFirst({ where: { id: sourceNoteId, userId } })
    if (!sourceNote) {
      throw new AppError('source note not found', 404)
    }
  }

  // 已经收录过的词不再建第二行 —— 只是补挂缺的词单，复习进度原封不动带过去。
  const existing = await prisma.word.findUnique({
    where: { userId_word_language: { userId, word, language } },
    include: WORD_INCLUDE,
  })
  if (existing) {
    const linked = new Set(existing.folders.map((link) => link.folderId))
    const toAdd = folderIds.filter((id) => !linked.has(id))
    if (toAdd.length === 0) {
      throw new AppError('word already exists in this folder', 409)
    }
    const updated = await prisma.word.update({
      where: { id: existing.id },
      // 顺手顶到最前，和新建的词一样出现在词单开头。
      data: {
        pinnedAt: new Date(),
        folders: { create: toAdd.map((folderId) => ({ folderId })) },
      },
      include: WORD_INCLUDE,
    })
    return flattenWord(updated)
  }

  try {
    const created = await prisma.word.create({
      data: {
        userId,
        word,
        reading: normalizeText(input.reading),
        meaning: normalizeText(input.meaning),
        example: normalizeText(input.example),
        note: normalizeText(input.note),
        partOfSpeech: normalizeText(input.partOfSpeech),
        sourceNoteId: sourceNoteId || null,
        language,
        // Every word gets a pinnedAt at birth — the list is sorted by
        // pinnedAt desc, so new entries naturally surface to the top and
        // share the same timeline as user-triggered pins.
        pinnedAt: new Date(),
        folders: { create: folderIds.map((folderId) => ({ folderId })) },
        review: {
          create: {
            interval: 1,
            repetition: 0,
            easeFactor: 2.5,
            nextReviewDate: new Date(),
          },
        },
      },
      include: WORD_INCLUDE,
    })
    return flattenWord(created)
  } catch (error) {
    mapUniqueError(error)
  }
}

export async function getWords(userId: string, folderId?: string, query?: string) {
  const normalized = query?.trim()

  // 带关键词时走原生 LIKE —— Prisma 的 contains 挂不了 ESCAPE，用户输入 % / _
  // 会被当通配符（suggestWords 早就转义了，这里补齐同样的规则）。
  if (normalized) {
    const escaped = normalized.replace(/[\\%_]/g, (ch) => `\\${ch}`)
    const contains = `%${escaped}%`
    const folderFilter = folderId
      ? Prisma.sql`AND EXISTS (SELECT 1 FROM WordFolder wf WHERE wf.wordId = w.id AND wf.folderId = ${folderId})`
      : Prisma.empty
    const idRows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT w.id FROM Word w
      WHERE w.userId = ${userId}
        AND (
          w.word LIKE ${contains} ESCAPE '\\'
          OR w.reading LIKE ${contains} ESCAPE '\\'
        )
        ${folderFilter}
      ORDER BY w.pinnedAt DESC, w.createdAt DESC
    `)
    if (idRows.length === 0) return []
    const ids = idRows.map((row) => row.id)
    const rows = await prisma.word.findMany({
      where: { id: { in: ids } },
      include: WORD_INCLUDE,
    })
    const order = new Map(ids.map((id, index) => [id, index]))
    rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    return rows.map(flattenWord)
  }

  const rows = await prisma.word.findMany({
    where: {
      userId,
      ...(folderId ? { folders: { some: { folderId } } } : {}),
    },
    // Unified timeline: every word has pinnedAt (set on creation, refreshed on
    // user pin), so a single descending sort puts the most recently created OR
    // pinned items at the top. Newer events always win.
    orderBy: [{ pinnedAt: 'desc' }, { createdAt: 'desc' }],
    include: WORD_INCLUDE,
  })
  return rows.map(flattenWord)
}

/**
 * 查词页右侧索引栏用的全量词头。
 *
 * 只下发定序和展示要用的三列：用户可能有几千个词，getWords 那套带
 * folders / sourceNote / review 的完整对象在这里全是浪费。去重、排序、
 * 和本地词库的合并都在客户端做（见 client/src/lib/dictIndex.ts）。
 */
export async function listWordIndex(userId: string) {
  return prisma.word.findMany({
    where: { userId },
    select: { word: true, reading: true, language: true },
  })
}

export async function suggestWords(userId: string, query: string, limit = 10) {
  const term = query.trim()
  if (!term) return []

  // Escape LIKE wildcards so user-typed % / _ don't act as wildcards.
  const escaped = term.replace(/[\\%_]/g, (ch) => `\\${ch}`)
  const contains = `%${escaped}%`
  const prefix = `${escaped}%`
  const safeLimit = Math.min(Math.max(limit, 1), 20)

  // Raw query so we can ORDER BY exact > prefix > contains relevance buckets.
  // 词单只是拿来在建议行上标个出处，一个词可能挂着多个 —— 取任意一个即可。
  const rows = await prisma.$queryRaw<
    Array<{
      id: string
      word: string
      reading: string
      meaning: string
      language: string
      folderId: string | null
      folderName: string | null
    }>
  >`
    SELECT w.id, w.word, w.reading, w.meaning, w.language,
           (SELECT wf.folderId FROM WordFolder wf WHERE wf.wordId = w.id LIMIT 1) AS folderId,
           (SELECT f.name FROM WordFolder wf JOIN Folder f ON f.id = wf.folderId
             WHERE wf.wordId = w.id LIMIT 1) AS folderName
    FROM Word w
    WHERE w.userId = ${userId}
      AND (
        w.word LIKE ${contains} ESCAPE '\\'
        OR w.reading LIKE ${contains} ESCAPE '\\'
      )
    ORDER BY
      CASE
        WHEN w.word = ${term} OR w.reading = ${term} THEN 0
        WHEN w.word LIKE ${prefix} ESCAPE '\\'
          OR w.reading LIKE ${prefix} ESCAPE '\\' THEN 1
        ELSE 2
      END,
      LENGTH(w.word),
      w.word
    LIMIT ${safeLimit}
  `

  return rows.map((row) => ({
    id: row.id,
    word: row.word,
    reading: row.reading,
    meaning: row.meaning,
    language: row.language,
    folderId: row.folderId ?? '',
    folderName: row.folderName ?? '',
  }))
}

export async function getTodayNewWords(userId: string, folderId?: string) {
  // Learn queue = "unreviewed words". A word counts as unreviewed when:
  //   - its Review row has lastReviewedAt = NULL, OR
  //   - it has no Review row at all (legacy / orphan).
  //
  // Raw SQL LEFT JOIN rather than Prisma's `review: { is: null }` — the latter
  // silently dropped words with no Review row at all on D1, so orphans went
  // missing from Learn even though the folder UI counted them as unlearned.
  // We then re-load full Word objects (with folder/review includes) keyed by
  // the IDs the raw query returned, so the caller gets the same shape as
  // before.
  // No LIMIT on the raw scan — the WHERE clause already restricts to
  // unreviewed-only, so the result is bounded by the user's actual unlearned
  // count, not by their full word inventory.
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT w.id
    FROM Word w
    LEFT JOIN Review r ON r.wordId = w.id
    WHERE w.userId = ${userId}
      ${
        folderId
          ? Prisma.sql`AND EXISTS (SELECT 1 FROM WordFolder wf WHERE wf.wordId = w.id AND wf.folderId = ${folderId})`
          : Prisma.empty
      }
      AND (r.id IS NULL OR r.lastReviewedAt IS NULL)
    ORDER BY
      CASE WHEN w.pinnedAt IS NULL THEN 1 ELSE 0 END,
      w.pinnedAt DESC,
      w.createdAt DESC
  `
  if (rows.length === 0) return []

  const ids = rows.map((r) => r.id)
  const words = await prisma.word.findMany({
    where: { id: { in: ids } },
    include: WORD_INCLUDE,
  })

  // Re-sort by the original raw-query order (Prisma's findMany doesn't
  // preserve `in:` ordering).
  const order = new Map(ids.map((id, idx) => [id, idx] as const))
  words.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
  return words.map(flattenWord)
}

export async function updateWord(userId: string, id: string, updates: UpdateWordInput) {
  const existing = await prisma.word.findFirst({ where: { id, userId } })
  if (!existing) {
    throw new AppError('word not found', 404)
  }

  const data: Prisma.WordUpdateInput = {}
  const requiredFields = ['word', 'reading'] as const
  const optionalFields = ['meaning', 'example', 'note', 'partOfSpeech'] as const

  for (const field of requiredFields) {
    const value = updates[field]
    if (value !== undefined) {
      const normalized = normalizeText(value)
      if (!normalized) {
        throw new AppError(`${field} cannot be empty`, 400)
      }
      data[field] = normalized
    }
  }

  for (const field of optionalFields) {
    const value = updates[field]
    if (value !== undefined) {
      data[field] = normalizeText(value)
    }
  }

  if (updates.sourceNoteId !== undefined) {
    const sourceNoteId = normalizeText(updates.sourceNoteId ?? '')
    if (sourceNoteId) {
      const sourceNote = await prisma.note.findFirst({ where: { id: sourceNoteId, userId } })
      if (!sourceNote) {
        throw new AppError('source note not found', 404)
      }
      data.sourceNote = { connect: { id: sourceNoteId } }
    } else {
      data.sourceNote = { disconnect: true }
    }
  }

  if (updates.folderIds !== undefined) {
    const folderIds = [...new Set(updates.folderIds.map(normalizeText).filter(Boolean))]
    if (folderIds.length === 0) {
      throw new AppError('a word must stay in at least one folder', 400)
    }
    await loadOwnedFolders(userId, folderIds, existing.language)
    // 全量覆盖。已经挂着的归属保持原样（不重建），避免 createdAt 白白刷新。
    data.folders = {
      deleteMany: { folderId: { notIn: folderIds } },
      connectOrCreate: folderIds.map((folderId) => ({
        where: { wordId_folderId: { wordId: id, folderId } },
        create: { folderId },
      })),
    }
  }

  if (updates.isPinned === true) {
    // Pin = bump to top: refresh pinnedAt. There is no unpin operation —
    // every word always has a pinnedAt (set at creation), the user just
    // re-stamps it to surface the word back to the top.
    data.pinnedAt = new Date()
  }

  if (Object.keys(data).length === 0) {
    const row = await prisma.word.findUnique({ where: { id }, include: WORD_INCLUDE })
    return row ? flattenWord(row) : null
  }

  try {
    const updated = await prisma.word.update({
      where: { id },
      data,
      include: WORD_INCLUDE,
    })
    return flattenWord(updated)
  } catch (error) {
    mapUniqueError(error)
  }
}

export async function deleteWord(userId: string, id: string) {
  const existing = await prisma.word.findFirst({ where: { id, userId } })
  if (!existing) {
    throw new AppError('word not found', 404)
  }

  await prisma.$transaction([
    prisma.review.deleteMany({ where: { wordId: id } }),
    prisma.wordFolder.deleteMany({ where: { wordId: id } }),
    prisma.word.delete({ where: { id } }),
  ])

  return { id }
}
