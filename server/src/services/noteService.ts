import { prisma } from '../lib/prisma'
import { AppError } from '../errors/AppError'

type CreateNoteInput = {
  title: string
  content: string
  course?: string
  lesson?: string
}

type UpdateNoteInput = Partial<CreateNoteInput>

function normalizeText(input?: string) {
  return (input ?? '').trim()
}

export async function getNotes() {
  return prisma.note.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: {
        select: { words: true },
      },
    },
  })
}

export async function getNoteById(id: string) {
  const normalizedId = normalizeText(id)
  if (!normalizedId) {
    throw new AppError('note id is required', 400)
  }

  const note = await prisma.note.findUnique({
    where: { id: normalizedId },
    include: {
      words: {
        include: {
          folder: true,
          review: true,
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  })

  if (!note) {
    throw new AppError('note not found', 404)
  }

  return note
}

export async function createNote(input: CreateNoteInput) {
  const title = normalizeText(input.title)
  const content = normalizeText(input.content)
  const course = normalizeText(input.course)
  const lesson = normalizeText(input.lesson)

  if (!title) {
    throw new AppError('title is required', 400)
  }
  if (!content) {
    throw new AppError('content is required', 400)
  }

  return prisma.note.create({
    data: {
      title,
      content,
      course,
      lesson,
    },
  })
}

export async function updateNote(id: string, input: UpdateNoteInput) {
  const normalizedId = normalizeText(id)
  if (!normalizedId) {
    throw new AppError('note id is required', 400)
  }

  const existing = await prisma.note.findUnique({ where: { id: normalizedId } })
  if (!existing) {
    throw new AppError('note not found', 404)
  }

  const data: {
    title?: string
    content?: string
    course?: string
    lesson?: string
  } = {}

  if (input.title !== undefined) {
    const title = normalizeText(input.title)
    if (!title) throw new AppError('title cannot be empty', 400)
    data.title = title
  }
  if (input.content !== undefined) {
    const content = normalizeText(input.content)
    if (!content) throw new AppError('content cannot be empty', 400)
    data.content = content
  }
  if (input.course !== undefined) {
    data.course = normalizeText(input.course)
  }
  if (input.lesson !== undefined) {
    data.lesson = normalizeText(input.lesson)
  }

  if (Object.keys(data).length === 0) {
    return existing
  }

  return prisma.note.update({
    where: { id: normalizedId },
    data,
  })
}
