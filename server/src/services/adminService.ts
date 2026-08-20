import { prisma } from '../lib/prisma'
import { AppError } from '../errors/AppError'
import { noteContentToText } from '../lib/noteContent'
import {
  assertCredentialFormat,
  assertPasswordFormat,
  normalizeUsername,
} from '../lib/credentials'
import { hashPassword } from '../lib/password'

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

/**
 * 建号。公开注册下线之后这是唯一的入口。
 *
 * 不返回 token —— 管理员建的是别人的号，建完让本人自己去登录页登，避免后台顺手
 * 拿到一个能冒充该用户的凭证。
 */
export async function createUser(rawUsername: string, password: string) {
  const username = normalizeUsername(rawUsername)
  assertCredentialFormat(username, password)

  // 这里没有「先查再建」的竞态：唯一约束是最终判据，P2002 由 errorHandler 兜住。
  // 先查一次只是为了把消息说清楚。
  const existing = await prisma.user.findUnique({ where: { username }, select: { id: true } })
  if (existing) {
    throw new AppError('用户名已被占用', 409)
  }

  const user = await prisma.user.create({
    data: { username, passwordHash: await hashPassword(password) },
    select: { id: true, username: true, createdAt: true },
  })
  return user
}

export async function listUsers(params: { keyword?: string; page: number; pageSize: number }) {
  const { keyword, page, pageSize } = params
  const where = keyword ? { username: { contains: keyword.toLowerCase() } } : {}

  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      // passwordHash 不在这里，也不该在任何出参里：管理员没有需要看它的场景，
      // 而 hash 一旦落到浏览器缓存或截图里就等于把离线爆破的靶子递出去了。
      // 要换密码走 resetUserPassword。
      select: {
        id: true,
        username: true,
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
    // 同 listUsers：select 而不是 include，免得以后往 User 上加敏感列时被
    // 「整行带出去」默默泄露。
    select: {
      id: true,
      username: true,
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
  })
  if (!user) throw new AppError('用户不存在', 404)

  const [wordCount, expressionCount, aiTotals] = await Promise.all([
    prisma.word.count({ where: { userId: id } }),
    prisma.expression.count({ where: { folder: { userId: id } } }),
    prisma.aiUsageLog.aggregate({
      where: { userId: id },
      _sum: { totalTokens: true, promptTokens: true, completionTokens: true },
    }),
  ])

  return {
    id: user.id,
    username: user.username,
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
  assertPasswordFormat(newPassword)
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true } })
  if (!user) throw new AppError('用户不存在', 404)

  await prisma.user.update({
    where: { id },
    data: {
      passwordHash: await hashPassword(newPassword),
      // 换了密码就把该用户在外的 token 全作废。少了这一句，重置密码只是「以后
      // 得用新密码登」，已经泄露的旧 token 还能再用满 30 天 —— 那就等于没救回
      // 这个账号。
      tokenVersion: { increment: 1 },
    },
  })
  return { ok: true }
}

/**
 * 删用户及其全部数据。
 *
 * 这里必须逐张表列全：所有指向 User 的外键都是 ON DELETE RESTRICT，漏一张就是
 * 最后那句 user.delete 抛 P2003。而 D1 不支持事务（Prisma 的 D1 adapter 会把
 * $transaction 降级成逐条执行，见 pris.ly/d/d1-transactions），失败时前面删掉的
 * 行回不来 —— 用户的词和笔记已经没了，账号却还在。所以这里不包 $transaction：
 * 那层包装在生产上是假的，留着只会让人以为有原子性。
 *
 * 换来的性质是「幂等且可重试」：每一步都是 deleteMany，中途失败再点一次删除能
 * 从断点继续推进。
 *
 * 顺序 = 从叶子往根走。往 User 上挂新表时，这个列表要跟着加。
 */
export async function deleteUser(id: string) {
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true } })
  if (!user) throw new AppError('用户不存在', 404)

  // 无外键、纯按 userId 存的答题记录，先清掉。
  await prisma.reviewEvent.deleteMany({ where: { userId: id } })
  await prisma.grammarQuestionAttempt.deleteMany({ where: { userId: id } })
  await prisma.qbankAttempt.deleteMany({ where: { userId: id } })
  await prisma.qbankFavorite.deleteMany({ where: { userId: id } })
  await prisma.qbankExamAttempt.deleteMany({ where: { userId: id } })

  // 语法：GrammarReview 指向 Grammar 且是 RESTRICT，得走在前面；GrammarQuestion
  // 是 CASCADE，跟着 Grammar 一起走。
  await prisma.grammarReview.deleteMany({ where: { grammar: { userId: id } } })
  await prisma.grammar.deleteMany({ where: { userId: id } })

  await prisma.podcast.deleteMany({ where: { userId: id } })
  await prisma.aiUsageLog.deleteMany({ where: { userId: id } })

  // 单词：Review 和 WordFolder 都挂在 Word 上。
  await prisma.review.deleteMany({ where: { word: { userId: id } } })
  await prisma.wordFolder.deleteMany({ where: { word: { userId: id } } })
  await prisma.word.deleteMany({ where: { userId: id } })
  await prisma.folder.deleteMany({ where: { userId: id } })

  await prisma.expression.deleteMany({ where: { folder: { userId: id } } })
  await prisma.expressionFolder.deleteMany({ where: { userId: id } })

  // Note 要等 Word 走完 —— Word.sourceNoteId 指着它。
  await prisma.note.deleteMany({ where: { userId: id } })
  await prisma.userSettings.deleteMany({ where: { userId: id } })

  await prisma.user.delete({ where: { id } })
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
  // 和 folderService.deleteFolder 同一套语义：只删归属，词只有在不属于任何
  // 别的词单时才跟着删。
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

  await prisma.$transaction(async (tx) => {
    await tx.wordFolder.deleteMany({ where: { folderId: id } })
    await tx.review.deleteMany({ where: { wordId: { in: orphanIds } } })
    await tx.word.deleteMany({ where: { id: { in: orphanIds } } })
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
  if (folderId) where.folders = { some: { folderId } }
  if (language) where.language = language
  if (userId) where.userId = userId
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
        user: { select: { id: true, username: true } },
        folders: { select: { folder: { select: { id: true, name: true } } } },
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
      folderId: w.folders[0]?.folder.id ?? '',
      folderName: w.folders.map((link) => link.folder.name).join(' / '),
      userId: w.user.id,
      username: w.user.username,
      createdAt: w.createdAt,
    })),
  }
}

export async function deleteWord(id: string) {
  await prisma.$transaction(async (tx) => {
    await tx.review.deleteMany({ where: { wordId: id } })
    await tx.wordFolder.deleteMany({ where: { wordId: id } })
    await tx.word.delete({ where: { id } })
  })
  return { ok: true }
}

export async function listNotes(params: {
  userId?: string
  keyword?: string
  page: number
  pageSize: number
}) {
  const { userId, keyword, page, pageSize } = params
  const where: any = {}
  if (userId) where.userId = userId
  if (keyword) {
    // 正文在库里是 JSON / HTML，LIKE 会顺带命中标签名和键名。后台只是粗查，
    // 认了；用户端的搜索在 noteService 里过了纯文本，那边是准的。
    where.OR = [
      { title: { contains: keyword } },
      { tag: { contains: keyword } },
      { content: { contains: keyword } },
    ]
  }

  const [total, rows] = await Promise.all([
    prisma.note.count({ where }),
    prisma.note.findMany({
      where,
      orderBy: [{ noteAt: 'desc' }, { createdAt: 'desc' }],
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
      tag: n.tag,
      noteAt: n.noteAt ?? n.createdAt,
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
  // 后台只读，给纯文本就够了：原始的 BlockNote JSON 后台渲染不了，运下去纯属
  // 浪费；顺手也免了把用户写的富文本原样塞进后台 DOM。
  const { content, ...rest } = note
  return {
    ...rest,
    noteAt: note.noteAt ?? note.createdAt,
    contentText: noteContentToText(content),
  }
}

export async function deleteNote(id: string) {
  // 同 noteService.deleteNote：解绑单词由外键的 ON DELETE SET NULL 完成，
  // 不需要额外的 UPDATE，也不需要（在 D1 上根本不生效的）事务。
  await prisma.note.delete({ where: { id } })
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
