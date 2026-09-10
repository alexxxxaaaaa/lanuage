import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { flattenWord, WORD_FOLDERS } from '../lib/wordShape'
import { chunkIds, sortByIdOrder, wordIdsInFolder } from '../lib/folderWords'
import { toPrismaDate } from '../lib/d1'
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
  })

  if (folders.length === 0) return []

  const folderIds = folders.map((folder) => folder.id)
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date()
  todayEnd.setHours(23, 59, 59, 999)

  // 归属在 WordFolder 上，所以按它分组、条件下沉到 review。
  // 一个词挂在两个词单里就两边各算一次，这是对的：两个词单各自的「今日到期」
  // 都该显示它，复习掉之后两边一起归零。
  //
  // 四个统计合成一条查询，用条件 SUM 而不是四次 groupBy。
  //
  // 这是全站读取行数的大头 —— 免费版 D1 的日读取上限被它一个人吃掉 91%（实测
  // 一天 382 万行，上限 500 万，全站接口一起 500）。原因是四次 groupBy 各自把
  // WordFolder 扫一遍：其中三次还要 LEFT JOIN Word 和 Review，一次读 9729 行
  // 只为返回八个数字（wrangler d1 insights 报的 queryEfficiency 是 0.0006）。
  // 首页加载一次 ≈ 3.2 万行，而首页一天被打一百多次。
  //
  // 合成一条之后只扫一遍，而且去掉了 Word 那次 JOIN —— WordFolder 两个外键都
  // 是 onDelete: Cascade，不可能有指向已删除 Word 的孤儿行，那次 JOIN 纯属
  // Prisma 的防御性写法。实测它让单次读取从 3250 行涨到 9729 行。
  //
  // 走原生 SQL 是因为 Prisma 的查询构造器做不到「一次分组、多个条件计数」。
  // folderIds 是这个用户的词单数（个位数），离 D1 的绑定参数上限很远。
  const rows = await prisma.$queryRaw<
    Array<{
      folderId: string
      total: number | bigint
      due: number | bigint
      mastered: number | bigint
      reviewedToday: number | bigint
    }>
  >(Prisma.sql`
    SELECT
      wf.folderId AS folderId,
      COUNT(*) AS total,
      SUM(CASE WHEN r.lastReviewedAt IS NOT NULL AND r.nextReviewDate <= ${toPrismaDate(todayEnd)}
               THEN 1 ELSE 0 END) AS due,
      SUM(CASE WHEN r.repetition >= 5 OR r."interval" >= 21
               THEN 1 ELSE 0 END) AS mastered,
      SUM(CASE WHEN r.lastReviewedAt >= ${toPrismaDate(todayStart)} AND r.lastReviewedAt <= ${toPrismaDate(todayEnd)}
               THEN 1 ELSE 0 END) AS reviewedToday
    FROM WordFolder wf
    LEFT JOIN Review r ON r.wordId = wf.wordId
    WHERE wf.folderId IN (${Prisma.join(folderIds)})
    GROUP BY wf.folderId
  `)

  // D1 的聚合结果是 BigInt。序列化那头有 worker.ts 的 toJSON 兜着，但总词数
  // 前端要拿去求和（首页汇总），所以四个数一律显式收成 number。
  const stats = new Map(
    rows.map((row) => [
      row.folderId,
      {
        total: Number(row.total),
        due: Number(row.due),
        mastered: Number(row.mastered),
        reviewedToday: Number(row.reviewedToday),
      },
    ]),
  )

  return folders.map((folder) => {
    const row = stats.get(folder.id)
    return {
      ...folder,
      // 形状保持不变 —— 前端读的是 folder._count.words（词单卡片、首页汇总）。
      _count: { words: row?.total ?? 0 },
      dueCount: row?.due ?? 0,
      masteredCount: row?.mastered ?? 0,
      reviewedTodayCount: row?.reviewedToday ?? 0,
    }
  })
}

export async function getFolderById(userId: string, id: string) {
  // 路由层拿不到 :id 时会传上来空值。不挡住的话它会一路进到 Prisma，报一句
  // 「Missing data field (Value): 'id'」——一个和真实原因毫无关系的内部错误，
  // 查起来极其费劲。
  if (!id?.trim()) {
    throw new AppError('folder id is required', 400)
  }

  const folder = await prisma.folder.findFirst({ where: { id, userId } })
  if (!folder) {
    throw new AppError('folder not found', 404)
  }

  // 词 id 和顺序都在 SQL 里定好，再按 id IN 分批取——不能用
  // `folders: { some: { folderId } }`，理由见 lib/folderWords。
  const ids = await wordIdsInFolder(id, userId)
  if (ids.length === 0) {
    return { ...folder, _count: { words: 0 }, words: [] }
  }

  const fetchChunk = (chunk: string[]) =>
    prisma.word.findMany({
      where: { id: { in: chunk } },
      include: { review: true, sourceNote: true, ...WORD_FOLDERS },
    })
  const rows: Awaited<ReturnType<typeof fetchChunk>> = []
  for (const chunk of chunkIds(ids)) rows.push(...(await fetchChunk(chunk)))
  sortByIdOrder(rows, ids)

  // 连接表只是存储细节，对外还是一串词。
  //
  // 词数直接数取回来的那串。原来这里挂着 include._count，等于为一个已经在手
  // 的数字额外让 D1 对整张 WordFolder 做一次 GROUP BY。
  return {
    ...folder,
    _count: { words: rows.length },
    words: rows.map(flattenWord),
  }
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
  //
  // 全程集合式 SQL，绝不把 wordId 列表拉回来再拼 IN：D1 的绑定参数上限在 100
  // 上下（同一条限制在 grammarQuestionService 里也记着），而一个词单动辄几千
  // 个词 —— 实测「N1」有 3480 个，老写法在这里直接 500。
  //
  // 顺序有讲究：孤儿判定要读 WordFolder，所以这张表的清理必须排在孤儿删除
  // 之后。删 Word 时它自己的 WordFolder 行会被级联带走（onDelete: Cascade）。
  const orphanFilter = Prisma.sql`
    SELECT wf.wordId FROM WordFolder wf
    WHERE wf.folderId = ${id}
      AND NOT EXISTS (
        SELECT 1 FROM WordFolder other
        WHERE other.wordId = wf.wordId AND other.folderId <> ${id}
      )
  `
  await prisma.$transaction([
    prisma.$executeRaw`DELETE FROM Review WHERE wordId IN (${orphanFilter})`,
    prisma.$executeRaw`DELETE FROM Word WHERE id IN (${orphanFilter})`,
    prisma.$executeRaw`DELETE FROM WordFolder WHERE folderId = ${id}`,
    prisma.$executeRaw`DELETE FROM Folder WHERE id = ${id}`,
  ])

  return { id }
}
