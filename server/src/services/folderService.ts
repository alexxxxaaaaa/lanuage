import { prisma } from '../lib/prisma'
import { flattenWord } from '../lib/wordShape'
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
    // Newest folder first — a just-created 词单 shows at the top of the list
    // and of the "add to folder" picker (both read this same ordering).
    orderBy: {
      createdAt: 'desc',
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

  // 归属现在在 WordFolder 上，所以按它分组、条件下沉到 word.review。
  // 一个词挂在两个词单里就两边各算一次，这是对的：两个词单各自的「今日到期」
  // 都该显示它，复习掉之后两边一起归零。
  const [dueGroups, masteredGroups, reviewedTodayGroups] = await Promise.all([
    prisma.wordFolder.groupBy({
      by: ['folderId'],
      where: {
        folderId: { in: folderIds },
        word: {
          review: {
            is: {
              lastReviewedAt: { not: null },
              nextReviewDate: { lte: todayEnd },
            },
          },
        },
      },
      _count: { _all: true },
    }),
    prisma.wordFolder.groupBy({
      by: ['folderId'],
      where: {
        folderId: { in: folderIds },
        word: {
          review: {
            is: {
              OR: [{ repetition: { gte: 5 } }, { interval: { gte: 21 } }],
            },
          },
        },
      },
      _count: { _all: true },
    }),
    prisma.wordFolder.groupBy({
      by: ['folderId'],
      where: {
        folderId: { in: folderIds },
        word: {
          review: {
            is: {
              lastReviewedAt: { gte: todayStart, lte: todayEnd },
            },
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
        // Unified pinnedAt-desc timeline (mirrors getWords / getTodayNewWords).
        // Pinning a word refreshes pinnedAt = now, so it surfaces back to top.
        // New words receive pinnedAt = createdAt at insertion.
        orderBy: [
          { word: { pinnedAt: 'desc' } },
          { word: { createdAt: 'desc' } },
        ],
        include: {
          word: {
            include: {
              review: true,
              sourceNote: true,
              folders: { include: { folder: true } },
            },
          },
        },
      },
      _count: {
        select: { words: true },
      },
    },
  })

  if (!folder) {
    throw new AppError('folder not found', 404)
  }

  // 连接表只是存储细节，对外还是一串词。
  return { ...folder, words: folder.words.map(({ word }) => flattenWord(word)) }
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

  // 删词单只解除归属；词本身只有在不属于任何别的词单时才跟着消失 —— 一个词
  // 同时在两个词单里，删掉其中一个不该把它连同复习进度一起带走。
  const memberIds = (
    await prisma.wordFolder.findMany({ where: { folderId: id }, select: { wordId: true } })
  ).map((link) => link.wordId)

  const stillElsewhere = new Set(
    (
      await prisma.wordFolder.findMany({
        where: { wordId: { in: memberIds }, folderId: { not: id } },
        select: { wordId: true },
      })
    ).map((link) => link.wordId),
  )
  const orphanIds = memberIds.filter((wordId) => !stillElsewhere.has(wordId))

  await prisma.$transaction([
    prisma.wordFolder.deleteMany({ where: { folderId: id } }),
    prisma.review.deleteMany({ where: { wordId: { in: orphanIds } } }),
    prisma.word.deleteMany({ where: { id: { in: orphanIds } } }),
    prisma.folder.delete({ where: { id } }),
  ])

  return { id }
}
