import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma'
import { AppError } from '../errors/AppError'

const MIN_PASSWORD_LENGTH = 6

export async function getStats() {
  const [
    userCount,
    folderCount,
    wordCount,
    noteCount,
    expressionCount,
    expressionFolderCount,
    reviewCount,
    aiLogCount,
    aiTotals,
    last7DaysUsers,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.folder.count(),
    prisma.word.count(),
    prisma.note.count(),
    prisma.expression.count(),
    prisma.expressionFolder.count(),
    prisma.review.count(),
    prisma.aiUsageLog.count(),
    prisma.aiUsageLog.aggregate({
      _sum: { promptTokens: true, completionTokens: true, totalTokens: true },
    }),
    prisma.user.count({
      where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
    }),
  ])

  return {
    users: userCount,
    folders: folderCount,
    words: wordCount,
    notes: noteCount,
    expressions: expressionCount,
    expressionFolders: expressionFolderCount,
    reviews: reviewCount,
    aiLogs: aiLogCount,
    aiTotalTokens: aiTotals._sum.totalTokens ?? 0,
    aiPromptTokens: aiTotals._sum.promptTokens ?? 0,
    aiCompletionTokens: aiTotals._sum.completionTokens ?? 0,
    last7DaysNewUsers: last7DaysUsers,
  }
}

export async function listUsers(params: {
  keyword?: string
  page: number
  pageSize: number
  includeHash?: boolean
}) {
  const { keyword, page, pageSize, includeHash } = params
  const where = keyword ? { username: { contains: keyword.toLowerCase() } } : {}

  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        username: true,
        passwordHash: includeHash,
        createdAt: true,
        _count: {
          select: {
            folders: true,
            notes: true,
            expressionFolders: true,
            aiUsageLogs: true,
          },
        },
      },
    }),
  ])

  return {
    total,
    page,
    pageSize,
    rows: rows.map((u) => ({
      id: u.id,
      username: u.username,
      passwordHash: includeHash ? u.passwordHash : undefined,
      createdAt: u.createdAt,
      folderCount: u._count.folders,
      noteCount: u._count.notes,
      expressionFolderCount: u._count.expressionFolders,
      aiUsageCount: u._count.aiUsageLogs,
    })),
  }
}

export async function getUserDetail(id: string) {
  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          folders: true,
          notes: true,
          expressionFolders: true,
          aiUsageLogs: true,
        },
      },
    },
  })
  if (!user) throw new AppError('用户不存在', 404)

  const [wordCount, expressionCount, aiTotals] = await Promise.all([
    prisma.word.count({ where: { folder: { userId: id } } }),
    prisma.expression.count({ where: { folder: { userId: id } } }),
    prisma.aiUsageLog.aggregate({
      where: { userId: id },
      _sum: { totalTokens: true, promptTokens: true, completionTokens: true },
    }),
  ])

  return {
    id: user.id,
    username: user.username,
    passwordHash: user.passwordHash,
    createdAt: user.createdAt,
    folderCount: user._count.folders,
    noteCount: user._count.notes,
    expressionFolderCount: user._count.expressionFolders,
    aiUsageCount: user._count.aiUsageLogs,
    wordCount,
    expressionCount,
    aiTotalTokens: aiTotals._sum.totalTokens ?? 0,
    aiPromptTokens: aiTotals._sum.promptTokens ?? 0,
    aiCompletionTokens: aiTotals._sum.completionTokens ?? 0,
  }
}

export async function resetUserPassword(id: string, newPassword: string) {
  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new AppError(`密码至少 ${MIN_PASSWORD_LENGTH} 个字符`, 400)
  }
  const user = await prisma.user.findUnique({ where: { id } })
  if (!user) throw new AppError('用户不存在', 404)
  const passwordHash = await bcrypt.hash(newPassword, 10)
  await prisma.user.update({ where: { id }, data: { passwordHash } })
  return { ok: true }
}

export async function deleteUser(id: string) {
  const user = await prisma.user.findUnique({ where: { id } })
  if (!user) throw new AppError('用户不存在', 404)

  await prisma.$transaction(async (tx) => {
    await tx.review.deleteMany({ where: { word: { folder: { userId: id } } } })
    await tx.word.deleteMany({ where: { folder: { userId: id } } })
    await tx.folder.deleteMany({ where: { userId: id } })
    await tx.expression.deleteMany({ where: { folder: { userId: id } } })
    await tx.expressionFolder.deleteMany({ where: { userId: id } })
    await tx.note.deleteMany({ where: { userId: id } })
    await tx.aiUsageLog.deleteMany({ where: { userId: id } })
    await tx.user.delete({ where: { id } })
  })
  return { ok: true }
}

export async function listFolders(params: {
  userId?: string
  language?: string
  keyword?: string
  page: number
  pageSize: number
}) {
  const { userId, language, keyword, page, pageSize } = params
  const where: any = {}
  if (userId) where.userId = userId
  if (language) where.language = language
  if (keyword) where.name = { contains: keyword }

  const [total, rows] = await Promise.all([
    prisma.folder.count({ where }),
    prisma.folder.findMany({
      where,
      orderBy: { id: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        user: { select: { username: true } },
        _count: { select: { words: true } },
      },
    }),
  ])

  return {
    total,
    page,
    pageSize,
    rows: rows.map((f) => ({
      id: f.id,
      name: f.name,
      language: f.language,
      userId: f.userId,
      username: f.user.username,
      wordCount: f._count.words,
    })),
  }
}

export async function deleteFolder(id: string) {
  const folder = await prisma.folder.findUnique({ where: { id } })
  if (!folder) throw new AppError('分类不存在', 404)
  await prisma.$transaction(async (tx) => {
    await tx.review.deleteMany({ where: { word: { folderId: id } } })
    await tx.word.deleteMany({ where: { folderId: id } })
    await tx.folder.delete({ where: { id } })
  })
  return { ok: true }
}

export async function listWords(params: {
  userId?: string
  folderId?: string
  language?: string
  keyword?: string
  page: number
  pageSize: number
}) {
  const { userId, folderId, language, keyword, page, pageSize } = params
  const where: any = {}
  if (folderId) where.folderId = folderId
  if (language) where.language = language
  if (userId) where.folder = { userId }
  if (keyword) {
    where.OR = [
      { word: { contains: keyword } },
      { meaning: { contains: keyword } },
      { reading: { contains: keyword } },
    ]
  }

  const [total, rows] = await Promise.all([
    prisma.word.count({ where }),
    prisma.word.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        folder: {
          select: { name: true, user: { select: { id: true, username: true } } },
        },
      },
    }),
  ])

  return {
    total,
    page,
    pageSize,
    rows: rows.map((w) => ({
      id: w.id,
      word: w.word,
      reading: w.reading,
      meaning: w.meaning,
      partOfSpeech: w.partOfSpeech,
      example: w.example,
      language: w.language,
      folderId: w.folderId,
      folderName: w.folder.name,
      userId: w.folder.user.id,
      username: w.folder.user.username,
      createdAt: w.createdAt,
    })),
  }
}

export async function deleteWord(id: string) {
  await prisma.$transaction(async (tx) => {
    await tx.review.deleteMany({ where: { wordId: id } })
    await tx.word.delete({ where: { id } })
  })
  return { ok: true }
}

export async function listNotes(params: {
  userId?: string
  course?: string
  keyword?: string
  page: number
  pageSize: number
}) {
  const { userId, course, keyword, page, pageSize } = params
  const where: any = {}
  if (userId) where.userId = userId
  if (course) where.course = course
  if (keyword) {
    where.OR = [{ title: { contains: keyword } }, { lesson: { contains: keyword } }]
  }

  const [total, rows] = await Promise.all([
    prisma.note.count({ where }),
    prisma.note.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        user: { select: { username: true } },
        _count: { select: { words: true } },
      },
    }),
  ])

  return {
    total,
    page,
    pageSize,
    rows: rows.map((n) => ({
      id: n.id,
      title: n.title,
      course: n.course,
      lesson: n.lesson,
      createdAt: n.createdAt,
      userId: n.userId,
      username: n.user.username,
      wordCount: n._count.words,
    })),
  }
}

export async function getNoteDetail(id: string) {
  const note = await prisma.note.findUnique({
    where: { id },
    include: { user: { select: { username: true } } },
  })
  if (!note) throw new AppError('笔记不存在', 404)
  return note
}

export async function deleteNote(id: string) {
  await prisma.$transaction(async (tx) => {
    await tx.word.updateMany({ where: { sourceNoteId: id }, data: { sourceNoteId: null } })
    await tx.note.delete({ where: { id } })
  })
  return { ok: true }
}

export async function listExpressions(params: {
  userId?: string
  folderId?: string
  keyword?: string
  page: number
  pageSize: number
}) {
  const { userId, folderId, keyword, page, pageSize } = params
  const where: any = {}
  if (folderId) where.folderId = folderId
  if (userId) where.folder = { userId }
  if (keyword) {
    where.OR = [
      { zhText: { contains: keyword } },
      { enCasual: { contains: keyword } },
      { jpCasual: { contains: keyword } },
    ]
  }

  const [total, rows] = await Promise.all([
    prisma.expression.count({ where }),
    prisma.expression.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        folder: {
          select: {
            name: true,
            language: true,
            user: { select: { id: true, username: true } },
          },
        },
      },
    }),
  ])

  return {
    total,
    page,
    pageSize,
    rows: rows.map((e) => ({
      id: e.id,
      zhText: e.zhText,
      enCasual: e.enCasual,
      jpCasual: e.jpCasual,
      sceneTag: e.sceneTag,
      isMastered: e.isMastered,
      folderId: e.folderId,
      folderName: e.folder.name,
      language: e.folder.language,
      userId: e.folder.user.id,
      username: e.folder.user.username,
      createdAt: e.createdAt,
    })),
  }
}

export async function deleteExpression(id: string) {
  await prisma.expression.delete({ where: { id } })
  return { ok: true }
}

export async function listAiUsage(params: {
  userId?: string
  feature?: string
  keyword?: string
  page: number
  pageSize: number
}) {
  const { userId, feature, keyword, page, pageSize } = params
  const where: any = {}
  if (userId) where.userId = userId
  if (feature) where.feature = feature
  if (keyword) where.word = { contains: keyword }

  const [total, rows, agg] = await Promise.all([
    prisma.aiUsageLog.count({ where }),
    prisma.aiUsageLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { user: { select: { username: true } } },
    }),
    prisma.aiUsageLog.aggregate({
      where,
      _sum: { promptTokens: true, completionTokens: true, totalTokens: true },
    }),
  ])

  return {
    total,
    page,
    pageSize,
    totals: {
      promptTokens: agg._sum.promptTokens ?? 0,
      completionTokens: agg._sum.completionTokens ?? 0,
      totalTokens: agg._sum.totalTokens ?? 0,
    },
    rows: rows.map((l) => ({
      id: l.id,
      word: l.word,
      language: l.language,
      model: l.model,
      feature: l.feature,
      promptTokens: l.promptTokens,
      completionTokens: l.completionTokens,
      totalTokens: l.totalTokens,
      createdAt: l.createdAt,
      userId: l.userId,
      username: l.user.username,
    })),
  }
}
