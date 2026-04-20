import { prisma } from '../lib/prisma'
import { AppError } from '../errors/AppError'

const SUPPORTED_LANGUAGES = ['en', 'jp'] as const

type FolderLanguage = (typeof SUPPORTED_LANGUAGES)[number]

function assertLanguage(language: string): asserts language is FolderLanguage {
  if (!SUPPORTED_LANGUAGES.includes(language as FolderLanguage)) {
    throw new AppError('language must be either en or jp', 400)
  }
}

export async function createFolder(name: string, language: string) {
  if (!name.trim()) {
    throw new AppError('name is required', 400)
  }

  assertLanguage(language)

  return prisma.folder.create({
    data: {
      name: name.trim(),
      language,
    },
  })
}

export async function getFolders() {
  return prisma.folder.findMany({
    orderBy: {
      name: 'asc',
    },
    include: {
      _count: {
        select: {
          words: true,
        },
      },
    },
  })
}

export async function getFolderById(id: string) {
  const folder = await prisma.folder.findUnique({
    where: { id },
    include: {
      words: {
        orderBy: { createdAt: 'desc' },
        include: { review: true },
      },
      _count: {
        select: { words: true },
      },
    },
  })

  if (!folder) {
    throw new AppError('folder not found', 404)
  }

  return folder
}

export async function updateFolder(
  id: string,
  updates: { name?: string; language?: string },
) {
  const existing = await prisma.folder.findUnique({ where: { id } })
  if (!existing) {
    throw new AppError('folder not found', 404)
  }

  const data: { name?: string; language?: string } = {}

  if (updates.name !== undefined) {
    if (!updates.name.trim()) {
      throw new AppError('name cannot be empty', 400)
    }
    data.name = updates.name.trim()
  }

  if (updates.language !== undefined) {
    assertLanguage(updates.language)
    data.language = updates.language
  }

  if (Object.keys(data).length === 0) {
    return existing
  }

  return prisma.folder.update({
    where: { id },
    data,
  })
}

export async function deleteFolder(id: string) {
  const existing = await prisma.folder.findUnique({ where: { id } })
  if (!existing) {
    throw new AppError('folder not found', 404)
  }

  await prisma.$transaction([
    prisma.review.deleteMany({ where: { word: { folderId: id } } }),
    prisma.word.deleteMany({ where: { folderId: id } }),
    prisma.folder.delete({ where: { id } }),
  ])

  return { id }
}
