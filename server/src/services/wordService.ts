import { prisma } from '../lib/prisma'
import { AppError } from '../errors/AppError'

type CreateWordInput = {
  word: string
  reading: string
  meaning: string
  example: string
  note: string
  language: string
  folderId: string
}

type UpdateWordInput = Partial<
  Pick<CreateWordInput, 'word' | 'reading' | 'meaning' | 'example' | 'note'>
>

function assertRequiredField(value: string, fieldName: string) {
  if (!value.trim()) {
    throw new AppError(`${fieldName} is required`, 400)
  }
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

export async function createWord(input: CreateWordInput) {
  const normalizedWord = input.word.trim()
  const normalizedReading = input.reading.trim()
  const normalizedMeaning = (input.meaning ?? '').trim()
  const normalizedExample = (input.example ?? '').trim()
  const normalizedNote = (input.note ?? '').trim()
  const normalizedLanguage = input.language.trim()
  const normalizedFolderId = input.folderId.trim()

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

  await assertNoDuplicateWordInFolder({
    folderId: normalizedFolderId,
    word: normalizedWord,
  })

  return prisma.word.create({
    data: {
      word: normalizedWord,
      reading: normalizedReading,
      meaning: normalizedMeaning,
      example: normalizedExample,
      note: normalizedNote,
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
      review: true,
    },
  })
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
              { meaning: { contains: normalized } },
              { example: { contains: normalized } },
              { note: { contains: normalized } },
            ],
          }
        : {}),
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

  const data: UpdateWordInput = {}
  const requiredFields: (keyof UpdateWordInput)[] = ['word', 'reading']
  const optionalFields: (keyof UpdateWordInput)[] = ['meaning', 'example', 'note']

  for (const field of requiredFields) {
    const value = updates[field]
    if (value !== undefined) {
      if (!value.trim()) {
        throw new AppError(`${field} cannot be empty`, 400)
      }
      data[field] = value.trim()
    }
  }

  for (const field of optionalFields) {
    const value = updates[field]
    if (value !== undefined) {
      data[field] = value.trim()
    }
  }

  if (Object.keys(data).length === 0) {
    return prisma.word.findUnique({
      where: { id },
      include: { folder: true, review: true },
    })
  }

  if (data.word !== undefined) {
    await assertNoDuplicateWordInFolder({
      folderId: existing.folderId,
      word: data.word,
      excludeWordId: id,
    })
  }

  return prisma.word.update({
    where: { id },
    data,
    include: { folder: true, review: true },
  })
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
