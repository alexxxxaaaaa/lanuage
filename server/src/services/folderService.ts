import { prisma } from '../lib/prisma'
import { AppError } from '../errors/AppError'

const SUPPORTED_LANGUAGES = ['en', 'jp'] as const

type FolderLanguage = (typeof SUPPORTED_LANGUAGES)[number]

function assertLanguage(language: string): asserts language is FolderLanguage {
  if (!SUPPORTED_LANGUAGES.includes(language as FolderLanguage)) {
    throw new AppError('language must be either en or jp', 400)
  }
}

export async function createFolder(userId: string, name: string, language: string) {
  if (!name.trim()) {
    throw new AppError('name is required', 400)
  }

  assertLanguage(language)

  return prisma.folder.create({
    data: {
      name: name.trim(),
      language,
      userId,
    },
  })
}

export async function getFolders(userId: string) {
  const folders = await prisma.folder.findMany({
    where: { userId },
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

  if (folders.length === 0) return folders

  const folderIds = folders.map((folder) => folder.id)
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date()
  todayEnd.setHours(23, 59, 59, 999)

  const [dueGroups, masteredGroups, reviewedTodayGroups] = await Promise.all([
    prisma.word.groupBy({
      by: ['folderId'],
      where: {
        folderId: { in: folderIds },
        review: {
          is: {
            lastReviewedAt: { not: null },
            nextReviewDate: { lte: todayEnd },
          },
        },
      },
      _count: { _all: true },
    }),
    prisma.word.groupBy({
      by: ['folderId'],
      where: {
        folderId: { in: folderIds },
        review: {
          is: {
            OR: [{ repetition: { gte: 5 } }, { interval: { gte: 21 } }],
          },
        },
      },
      _count: { _all: true },
    }),
    prisma.word.groupBy({
      by: ['folderId'],
      where: {
        folderId: { in: folderIds },
        review: {
          is: {
            lastReviewedAt: { gte: todayStart, lte: todayEnd },
          },
        },
      },
      _count: { _all: true },
    }),
  ])

  const dueMap = new Map(dueGroups.map((row) => [row.folderId, row._count._all]))
  const masteredMap = new Map(
    masteredGroups.map((row) => [row.folderId, row._count._all]),
  )
  const reviewedTodayMap = new Map(
    reviewedTodayGroups.map((row) => [row.folderId, row._count._all]),
  )

  return folders.map((folder) => ({
    ...folder,
    dueCount: dueMap.get(folder.id) ?? 0,
    masteredCount: masteredMap.get(folder.id) ?? 0,
    reviewedTodayCount: reviewedTodayMap.get(folder.id) ?? 0,
  }))
}

export async function getFolderById(userId: string, id: string) {
  const folder = await prisma.folder.findFirst({
    where: { id, userId },
    include: {
      words: {
        orderBy: { createdAt: 'desc' },
        include: { review: true, sourceNote: true },
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
  userId: string,
  id: string,
  updates: { name?: string; language?: string },
) {
  const existing = await prisma.folder.findFirst({ where: { id, userId } })
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

export async function deleteFolder(userId: string, id: string) {
  const existing = await prisma.folder.findFirst({ where: { id, userId } })
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
