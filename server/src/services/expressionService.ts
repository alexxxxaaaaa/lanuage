import { prisma } from '../lib/prisma'
import { AppError } from '../errors/AppError'

type CreateExpressionFolderInput = {
  name: string
  language: string
}

type CreateExpressionInput = {
  zhText: string
  folderId: string
  enCasual?: string
  jpCasual?: string
  sceneTag?: string
  note?: string
  isMastered?: boolean
}

type UpdateExpressionInput = Partial<CreateExpressionInput>

function normalizeText(input?: string) {
  return (input ?? '').trim()
}

export async function getExpressionFolders(userId: string) {
  const folders = await prisma.expressionFolder.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  })
  if (folders.length === 0) return []

  // 条数下沉成 folderId IN 分组，走 @@index([folderId])。include 里的 _count
  // 生成的是不带 where 的 GROUP BY 子查询，对整张 Expression 表分组，跟这个
  // 用户有几个分类无关 —— 词单那边是同一个坑，见 folderService.getFolders。
  const groups = await prisma.expression.groupBy({
    by: ['folderId'],
    where: { folderId: { in: folders.map((folder) => folder.id) } },
    _count: { _all: true },
  })
  // D1 的聚合结果是 BigInt，收成 number 再交出去。
  const countMap = new Map(
    groups.map((row) => [row.folderId, Number(row._count._all)]),
  )

  // 形状保持不变 —— 前端读的是 folder._count.expressions。
  return folders.map((folder) => ({
    ...folder,
    _count: { expressions: countMap.get(folder.id) ?? 0 },
  }))
}

export async function createExpressionFolder(
  userId: string,
  input: CreateExpressionFolderInput,
) {
  const name = normalizeText(input.name)
  const language = normalizeText(input.language)
  if (!name) throw new AppError('name is required', 400)
  if (!['en', 'jp'].includes(language)) {
    throw new AppError('language must be en or jp', 400)
  }

  const folder = await prisma.expressionFolder.create({
    data: {
      name,
      language,
      userId,
    },
  })
  // 刚建出来的分类必然是空的。原来这里挂着 include._count，等于为一个恒等于
  // 0 的数字让 D1 对整张 Expression 表分组一次。
  return { ...folder, _count: { expressions: 0 } }
}

export async function getExpressionFolderById(userId: string, id: string) {
  const normalizedId = normalizeText(id)
  if (!normalizedId) throw new AppError('folder id is required', 400)
  const folder = await prisma.expressionFolder.findFirst({
    where: { id: normalizedId, userId },
    include: {
      expressions: {
        orderBy: { createdAt: 'desc' },
      },
    },
  })
  if (!folder) throw new AppError('expression folder not found', 404)
  // 条数直接数取回来的那串 —— expressions 已经在手里了。
  return { ...folder, _count: { expressions: folder.expressions.length } }
}

export async function deleteExpressionFolder(userId: string, id: string) {
  const normalizedId = normalizeText(id)
  if (!normalizedId) throw new AppError('folder id is required', 400)
  const existing = await prisma.expressionFolder.findFirst({
    where: { id: normalizedId, userId },
  })
  if (!existing) throw new AppError('expression folder not found', 404)

  // 表达只挂在一个分类下（Expression.folderId 是必填的），分类没了它们就无处
  // 可去 —— 一起删，一个事务里做完，不留没主的表达。
  await prisma.$transaction([
    prisma.expression.deleteMany({ where: { folderId: normalizedId } }),
    prisma.expressionFolder.delete({ where: { id: normalizedId } }),
  ])

  return { id: normalizedId }
}

export async function getExpressions(
  userId: string,
  filters?: {
    q?: string
    sceneTag?: string
    isMastered?: boolean
    folderId?: string
  },
) {
  const q = normalizeText(filters?.q)
  const sceneTag = normalizeText(filters?.sceneTag)
  const folderId = normalizeText(filters?.folderId)

  return prisma.expression.findMany({
    where: {
      folder: { userId },
      ...(folderId ? { folderId } : {}),
      ...(sceneTag ? { sceneTag: { contains: sceneTag } } : {}),
      ...(filters?.isMastered !== undefined ? { isMastered: filters.isMastered } : {}),
      ...(q
        ? {
            OR: [
              { zhText: { contains: q } },
              { enCasual: { contains: q } },
              { jpCasual: { contains: q } },
              { sceneTag: { contains: q } },
              { note: { contains: q } },
            ],
          }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
  })
}

export async function getExpressionById(userId: string, id: string) {
  const normalizedId = normalizeText(id)
  if (!normalizedId) {
    throw new AppError('expression id is required', 400)
  }

  const expression = await prisma.expression.findFirst({
    where: { id: normalizedId, folder: { userId } },
  })
  if (!expression) {
    throw new AppError('expression not found', 404)
  }
  return expression
}

export async function createExpression(userId: string, input: CreateExpressionInput) {
  const zhText = normalizeText(input.zhText)
  const folderId = normalizeText(input.folderId)
  const enCasual = normalizeText(input.enCasual)
  const jpCasual = normalizeText(input.jpCasual)
  const sceneTag = normalizeText(input.sceneTag)
  const note = normalizeText(input.note)

  if (!zhText) {
    throw new AppError('zhText is required', 400)
  }
  if (!folderId) {
    throw new AppError('folderId is required', 400)
  }
  const folder = await prisma.expressionFolder.findFirst({
    where: { id: folderId, userId },
  })
  if (!folder) throw new AppError('expression folder not found', 404)

  return prisma.expression.create({
    data: {
      zhText,
      folderId,
      enCasual,
      jpCasual,
      sceneTag,
      note,
      isMastered: input.isMastered ?? false,
    },
    include: {
      folder: true,
    },
  })
}

export async function updateExpression(
  userId: string,
  id: string,
  input: UpdateExpressionInput,
) {
  const normalizedId = normalizeText(id)
  if (!normalizedId) {
    throw new AppError('expression id is required', 400)
  }

  const existing = await prisma.expression.findFirst({
    where: { id: normalizedId, folder: { userId } },
  })
  if (!existing) {
    throw new AppError('expression not found', 404)
  }

  const data: {
    zhText?: string
    folderId?: string
    enCasual?: string
    jpCasual?: string
    sceneTag?: string
    note?: string
    isMastered?: boolean
  } = {}

  if (input.zhText !== undefined) {
    const value = normalizeText(input.zhText)
    if (!value) throw new AppError('zhText cannot be empty', 400)
    data.zhText = value
  }
  if (input.folderId !== undefined) {
    const value = normalizeText(input.folderId)
    if (!value) throw new AppError('folderId cannot be empty', 400)
    const folder = await prisma.expressionFolder.findFirst({
      where: { id: value, userId },
    })
    if (!folder) throw new AppError('expression folder not found', 404)
    data.folderId = value
  }
  if (input.enCasual !== undefined) data.enCasual = normalizeText(input.enCasual)
  if (input.jpCasual !== undefined) data.jpCasual = normalizeText(input.jpCasual)
  if (input.sceneTag !== undefined) data.sceneTag = normalizeText(input.sceneTag)
  if (input.note !== undefined) data.note = normalizeText(input.note)
  if (input.isMastered !== undefined) data.isMastered = Boolean(input.isMastered)

  if (Object.keys(data).length === 0) {
    return existing
  }

  return prisma.expression.update({
    where: { id: normalizedId },
    data,
    include: {
      folder: true,
    },
  })
}

export async function deleteExpression(userId: string, id: string) {
  const normalizedId = normalizeText(id)
  if (!normalizedId) {
    throw new AppError('expression id is required', 400)
  }
  const existing = await prisma.expression.findFirst({
    where: { id: normalizedId, folder: { userId } },
  })
  if (!existing) {
    throw new AppError('expression not found', 404)
  }

  await prisma.expression.delete({
    where: { id: normalizedId },
  })
  return { id: normalizedId }
}
