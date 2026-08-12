import { prisma } from '../lib/prisma'
import { AppError } from '../errors/AppError'
import { flattenWord } from '../lib/wordShape'
import { noteContentToPreview, noteContentToText } from '../lib/noteContent'

/** 列表摘要的长度。够铺满一行，又不至于让列表接口把整篇正文运下去。 */
const PREVIEW_LENGTH = 180

/** 正文体积上限，纯粹是防滥用；一篇正常笔记离这个数远得很。 */
const MAX_CONTENT_BYTES = 1024 * 1024

const MAX_TITLE_LENGTH = 200
const MAX_TAG_LENGTH = 60

type NoteWriteInput = {
  title?: string
  content?: string
  tag?: string
  noteAt?: string | null
}

function normalizeText(input?: string) {
  return (input ?? '').trim()
}

function parseNoteAt(input: string | null | undefined): Date | undefined {
  if (input === undefined || input === null || input === '') return undefined
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) {
    throw new AppError('noteAt is not a valid date', 400)
  }
  return date
}

function assertWithin(value: string, max: number, field: string) {
  if (value.length > max) {
    throw new AppError(`${field} is too long`, 400)
  }
}

function normalizeContent(input: string | undefined) {
  const content = input ?? ''
  if (content.length > MAX_CONTENT_BYTES) {
    throw new AppError('content is too large', 413)
  }
  return content
}

/** 列表行。刻意不带正文 —— 客户端只需要摘要。 */
export type NoteListItem = {
  id: string
  title: string
  tag: string
  noteAt: Date
  createdAt: Date
  updatedAt: Date
  preview: string
  wordCount: number
}

export async function getNotes(
  userId: string,
  filters: { tag?: string; q?: string } = {},
): Promise<NoteListItem[]> {
  const tag = normalizeText(filters.tag)
  const q = normalizeText(filters.q)

  const rows = await prisma.note.findMany({
    where: {
      userId,
      ...(tag ? { tag } : {}),
      // 正文在库里是 JSON / HTML，LIKE 只能当粗筛：先把明显不含关键词的行挡在
      // D1 那边，再在下面用纯文本视图剔掉命中标签名、JSON 键这类的假阳性。
      ...(q
        ? {
            OR: [
              { title: { contains: q } },
              { tag: { contains: q } },
              { content: { contains: q } },
            ],
          }
        : {}),
    },
    orderBy: [{ noteAt: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      title: true,
      tag: true,
      content: true,
      noteAt: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { words: true } },
    },
  })

  const needle = q.toLowerCase()

  return rows
    .filter((row) => {
      if (!needle) return true
      const haystack = `${row.title}\n${row.tag}\n${noteContentToText(row.content)}`
      return haystack.toLowerCase().includes(needle)
    })
    .map((row) => ({
      id: row.id,
      title: row.title,
      tag: row.tag,
      // 这两列对老行才可能是 NULL，迁移已回填，这里只是兜底。
      noteAt: row.noteAt ?? row.createdAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt ?? row.createdAt,
      preview: noteContentToPreview(row.content, PREVIEW_LENGTH),
      wordCount: row._count.words,
    }))
}

/** 标签选项，按用得多的排前面。新建笔记时的下拉就吃这个。 */
export async function getTags(userId: string) {
  const rows = await prisma.note.findMany({
    where: { userId, tag: { not: '' } },
    select: { tag: true },
  })

  const counts = new Map<string, number>()
  for (const row of rows) {
    counts.set(row.tag, (counts.get(row.tag) ?? 0) + 1)
  }

  return Array.from(counts, ([tag, count]) => ({ tag, count })).sort(
    (a, b) => b.count - a.count || a.tag.localeCompare(b.tag),
  )
}

export async function getNoteById(userId: string, id: string) {
  const normalizedId = normalizeText(id)
  if (!normalizedId) {
    throw new AppError('note id is required', 400)
  }

  const note = await prisma.note.findFirst({
    where: { id: normalizedId, userId },
    include: {
      words: {
        select: {
          id: true,
          word: true,
          reading: true,
          meaning: true,
          folders: { select: { folderId: true, folder: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  })

  if (!note) {
    throw new AppError('note not found', 404)
  }

  return {
    ...note,
    // 连接表摊平成词单数组，和 words 接口的形状一致（共用 wordShape）。
    words: note.words.map(flattenWord),
    noteAt: note.noteAt ?? note.createdAt,
  }
}

/**
 * 建一条笔记。标题和正文都允许为空 —— 前端「新建」是先落一条空笔记再跳进
 * 编辑页，往下全靠自动保存打补丁，这跟 Notion 的行为一致。
 */
export async function createNote(userId: string, input: NoteWriteInput) {
  const title = normalizeText(input.title)
  const tag = normalizeText(input.tag)
  assertWithin(title, MAX_TITLE_LENGTH, 'title')
  assertWithin(tag, MAX_TAG_LENGTH, 'tag')

  return prisma.note.create({
    data: {
      title,
      content: normalizeContent(input.content),
      tag,
      // 选填，不给就是此刻 —— 也就是「默认为创建时间」。
      noteAt: parseNoteAt(input.noteAt) ?? new Date(),
      userId,
    },
  })
}

export async function updateNote(userId: string, id: string, input: NoteWriteInput) {
  const normalizedId = normalizeText(id)
  if (!normalizedId) {
    throw new AppError('note id is required', 400)
  }

  const existing = await prisma.note.findFirst({
    where: { id: normalizedId, userId },
    select: { id: true, createdAt: true },
  })
  if (!existing) {
    throw new AppError('note not found', 404)
  }

  const data: {
    title?: string
    content?: string
    tag?: string
    noteAt?: Date
  } = {}

  if (input.title !== undefined) {
    data.title = normalizeText(input.title)
    assertWithin(data.title, MAX_TITLE_LENGTH, 'title')
  }
  if (input.content !== undefined) {
    data.content = normalizeContent(input.content)
  }
  if (input.tag !== undefined) {
    data.tag = normalizeText(input.tag)
    assertWithin(data.tag, MAX_TAG_LENGTH, 'tag')
  }
  if (input.noteAt !== undefined) {
    // 清空时间就退回创建时间 —— 这一列业务上不留空，排序全靠它。
    data.noteAt = parseNoteAt(input.noteAt) ?? existing.createdAt
  }

  if (Object.keys(data).length === 0) {
    return getNoteById(userId, normalizedId)
  }

  await prisma.note.update({ where: { id: normalizedId }, data })
  return getNoteById(userId, normalizedId)
}

export async function deleteNote(userId: string, id: string) {
  const normalizedId = normalizeText(id)
  const existing = await prisma.note.findFirst({
    where: { id: normalizedId, userId },
    select: { id: true },
  })
  if (!existing) {
    throw new AppError('note not found', 404)
  }

  // 从笔记里加过的单词不跟着删，只是断开来源 —— 这一步是 Word.sourceNoteId 上
  // 那条外键的 ON DELETE SET NULL 干的，不用自己再补一条 UPDATE。
  //
  // 也别把两条语句包进 $transaction：Prisma 的 D1 适配器把事务静默降级成逐条
  // 执行（commit/rollback 都是空实现），包了并不保证原子性。反过来 D1 每条语句
  // 本身跑在隐式事务里，所以「一条 DELETE 让外键收尾」才是这里真正原子的写法。
  await prisma.note.delete({ where: { id: normalizedId } })

  return { ok: true }
}
