import { prisma } from '../lib/prisma'
import { AppError } from '../errors/AppError'

type CreateWordInput = {
  word: string
  reading: string
  meaning: string
  example: string
  note: string
  partOfSpeech: string
  sourceNoteId?: string
  language: string
  folderId: string
}

type UpdateWordInput = Partial<
  Pick<
    CreateWordInput,
    | 'word'
    | 'reading'
    | 'meaning'
    | 'example'
    | 'note'
    | 'partOfSpeech'
    | 'folderId'
  >
> & {
  sourceNoteId?: string | null
}

function assertRequiredField(value: string, fieldName: string) {
  if (!value.trim()) {
    throw new AppError(`${fieldName} is required`, 400)
  }
}

function sanitizeUnicode(input: string) {
  // Remove isolated surrogate code units that can break Prisma/MySQL JSON handling.
  return input.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    '',
  )
}

function normalizeText(input?: string) {
  return sanitizeUnicode((input ?? '').trim())
}

async function assertNoDuplicateWordInFolder(input: {
  folderId: string
  word: string
  excludeWordId?: string
}) {
  const duplicated = await prisma.word.findFirst({
    where: {
      folderId: input.folderId,
      word: input.word,
      ...(input.excludeWordId ? { id: { not: input.excludeWordId } } : {}),
    },
  })

  if (duplicated) {
    throw new AppError('word already exists in this folder', 409)
  }
}

function mapUniqueError(error: unknown): never {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code)
      : ''
  if (code === 'P2002') {
    throw new AppError('word already exists in this folder', 409)
  }
  throw error
}

export async function createWord(input: CreateWordInput) {
  const normalizedWord = normalizeText(input.word)
  const normalizedReading = normalizeText(input.reading)
  const normalizedMeaning = normalizeText(input.meaning)
  const normalizedExample = normalizeText(input.example)
  const normalizedNote = normalizeText(input.note)
  const normalizedPartOfSpeech = normalizeText(input.partOfSpeech)
  const normalizedSourceNoteId = normalizeText(input.sourceNoteId)
  const normalizedLanguage = normalizeText(input.language)
  const normalizedFolderId = normalizeText(input.folderId)

  assertRequiredField(normalizedWord, 'word')
  assertRequiredField(input.reading, 'reading')
  assertRequiredField(input.language, 'language')
  assertRequiredField(input.folderId, 'folderId')

  const folder = await prisma.folder.findUnique({
    where: {
      id: normalizedFolderId,
    },
  })

  if (!folder) {
    throw new AppError('folder not found', 404)
  }

  if (folder.language !== normalizedLanguage) {
    throw new AppError('word language must match folder language', 400)
  }

  if (normalizedSourceNoteId) {
    const sourceNote = await prisma.note.findUnique({
      where: { id: normalizedSourceNoteId },
    })
    if (!sourceNote) {
      throw new AppError('source note not found', 404)
    }
  }

  await assertNoDuplicateWordInFolder({
    folderId: normalizedFolderId,
    word: normalizedWord,
  })

  try {
    return await prisma.word.create({
      data: {
        word: normalizedWord,
        reading: normalizedReading,
        meaning: normalizedMeaning,
        example: normalizedExample,
        note: normalizedNote,
        partOfSpeech: normalizedPartOfSpeech,
        sourceNoteId: normalizedSourceNoteId || null,
        language: normalizedLanguage,
        folderId: normalizedFolderId,
        review: {
          create: {
            interval: 1,
            repetition: 0,
            easeFactor: 2.5,
            nextReviewDate: new Date(),
          },
        },
      },
      include: {
        folder: true,
        sourceNote: true,
        review: true,
      },
    })
  } catch (error) {
    mapUniqueError(error)
  }
}

export async function getWords(folderId?: string, query?: string) {
  const normalized = query?.trim()

  return prisma.word.findMany({
    where: {
      ...(folderId ? { folderId } : {}),
      ...(normalized
        ? {
            OR: [
              { word: { contains: normalized } },
              { reading: { contains: normalized } },
            ],
          }
        : {}),
    },
    orderBy: {
      createdAt: 'desc',
    },
    include: {
      folder: true,
      sourceNote: true,
      review: true,
    },
  })
}

export async function getTodayNewWords(folderId?: string) {
  return prisma.word.findMany({
    where: {
      ...(folderId ? { folderId } : {}),
      OR: [
        {
          review: {
            is: null,
          },
        },
        {
          review: {
            is: {
              lastReviewedAt: null,
            },
          },
        },
      ],
    },
    orderBy: {
      createdAt: 'desc',
    },
    include: {
      folder: true,
      review: true,
    },
  })
}

export async function updateWord(id: string, updates: UpdateWordInput) {
  const existing = await prisma.word.findUnique({ where: { id } })
  if (!existing) {
    throw new AppError('word not found', 404)
  }

  const data: Omit<Partial<CreateWordInput>, 'sourceNoteId'> & {
    sourceNoteId?: string | null
  } = {}
  const requiredFields: Array<'word' | 'reading'> = ['word', 'reading']
  const optionalFields: Array<'meaning' | 'example' | 'note' | 'partOfSpeech'> = [
    'meaning',
    'example',
    'note',
    'partOfSpeech',
  ]

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
    const normalizedSourceNoteId = normalizeText(updates.sourceNoteId ?? '')
    if (normalizedSourceNoteId) {
      const sourceNote = await prisma.note.findUnique({
        where: { id: normalizedSourceNoteId },
      })
      if (!sourceNote) {
        throw new AppError('source note not found', 404)
      }
      data.sourceNoteId = normalizedSourceNoteId
    } else {
      data.sourceNoteId = null
    }
  }

  if (updates.folderId !== undefined) {
    const normalizedFolderId = normalizeText(updates.folderId)
    if (!normalizedFolderId) {
      throw new AppError('folderId cannot be empty', 400)
    }
    const targetFolder = await prisma.folder.findUnique({
      where: { id: normalizedFolderId },
    })
    if (!targetFolder) {
      throw new AppError('folder not found', 404)
    }
    data.folderId = normalizedFolderId
    data.language = targetFolder.language
  }

  if (Object.keys(data).length === 0) {
    return prisma.word.findUnique({
      where: { id },
      include: { folder: true, sourceNote: true, review: true },
    })
  }

  const effectiveWord = data.word ?? existing.word
  const effectiveFolderId =
    (data.folderId as string | undefined) ?? existing.folderId
  if (data.word !== undefined || data.folderId !== undefined) {
    await assertNoDuplicateWordInFolder({
      folderId: effectiveFolderId,
      word: effectiveWord,
      excludeWordId: id,
    })
  }

  try {
    return await prisma.word.update({
      where: { id },
      data,
      include: { folder: true, sourceNote: true, review: true },
    })
  } catch (error) {
    mapUniqueError(error)
  }
}

export async function deleteWord(id: string) {
  const existing = await prisma.word.findUnique({ where: { id } })
  if (!existing) {
    throw new AppError('word not found', 404)
  }

  await prisma.$transaction([
    prisma.review.deleteMany({ where: { wordId: id } }),
    prisma.word.delete({ where: { id } }),
  ])

  return { id }
}
