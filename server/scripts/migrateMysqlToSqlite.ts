/**
 * One-time migration: copy all rows from local MySQL (LEGACY_MYSQL_URL)
 * into the local SQLite file (DATABASE_URL).
 *
 * Usage:
 *   node --import tsx scripts/migrateMysqlToSqlite.ts
 */

import 'dotenv/config'
import mysql from 'mysql2/promise'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const mysqlUrl = process.env.LEGACY_MYSQL_URL
  if (!mysqlUrl) {
    throw new Error('LEGACY_MYSQL_URL not set in .env')
  }

  console.log('Connecting to MySQL…')
  const conn = await mysql.createConnection(mysqlUrl)

  type Row = Record<string, unknown>
  async function read<T extends Row>(sql: string): Promise<T[]> {
    const [rows] = await conn.query(sql)
    return rows as T[]
  }

  function toDate(value: unknown): Date | null {
    if (value === null || value === undefined) return null
    if (value instanceof Date) return value
    return new Date(String(value))
  }
  function toBool(value: unknown): boolean {
    return value === 1 || value === true || value === '1'
  }

  console.log('Reading source rows…')
  const users = await read<{
    id: string
    username: string
    passwordHash: string
    createdAt: unknown
  }>('SELECT id, username, passwordHash, createdAt FROM User')
  const folders = await read<{
    id: string
    name: string
    language: string
    userId: string
  }>('SELECT id, name, language, userId FROM Folder')
  const notes = await read<{
    id: string
    title: string
    content: string
    course: string
    lesson: string
    createdAt: unknown
    userId: string
  }>('SELECT id, title, content, course, lesson, createdAt, userId FROM Note')
  const expressionFolders = await read<{
    id: string
    name: string
    language: string
    createdAt: unknown
    userId: string
  }>('SELECT id, name, language, createdAt, userId FROM ExpressionFolder')
  const words = await read<{
    id: string
    word: string
    reading: string
    meaning: string
    example: string
    note: string
    partOfSpeech: string
    language: string
    folderId: string
    sourceNoteId: string | null
    createdAt: unknown
  }>(
    'SELECT id, word, reading, meaning, example, note, partOfSpeech, language, folderId, sourceNoteId, createdAt FROM Word',
  )
  const reviews = await read<{
    id: string
    wordId: string
    interval: number
    repetition: number
    easeFactor: number
    difficultyScore: number
    lastRating: string
    recentRatings: string
    firstLearnedAt: unknown
    nextReviewDate: unknown
    lastReviewedAt: unknown
  }>(
    'SELECT id, wordId, `interval`, repetition, easeFactor, difficultyScore, lastRating, recentRatings, firstLearnedAt, nextReviewDate, lastReviewedAt FROM Review',
  )
  const expressions = await read<{
    id: string
    zhText: string
    enCasual: string
    jpCasual: string
    sceneTag: string
    note: string
    isMastered: number | boolean
    folderId: string
    createdAt: unknown
    updatedAt: unknown
  }>(
    'SELECT id, zhText, enCasual, jpCasual, sceneTag, note, isMastered, folderId, createdAt, updatedAt FROM Expression',
  )
  const aiUsageLogs = await read<{
    id: string
    word: string
    language: string
    model: string
    feature: string
    promptTokens: number
    completionTokens: number
    totalTokens: number
    createdAt: unknown
    userId: string
  }>(
    'SELECT id, word, language, model, feature, promptTokens, completionTokens, totalTokens, createdAt, userId FROM AiUsageLog',
  )

  await conn.end()

  console.log(
    `Source counts → User=${users.length}, Folder=${folders.length}, Note=${notes.length}, ` +
      `ExpressionFolder=${expressionFolders.length}, Word=${words.length}, Review=${reviews.length}, ` +
      `Expression=${expressions.length}, AiUsageLog=${aiUsageLogs.length}`,
  )

  console.log('Writing into SQLite…')

  // Order matters because of FK relations.
  for (const u of users) {
    await prisma.user.upsert({
      where: { id: u.id },
      update: {},
      create: {
        id: u.id,
        username: u.username,
        passwordHash: u.passwordHash,
        createdAt: toDate(u.createdAt) ?? new Date(),
      },
    })
  }

  for (const f of folders) {
    await prisma.folder.upsert({
      where: { id: f.id },
      update: {},
      create: { id: f.id, name: f.name, language: f.language, userId: f.userId },
    })
  }

  for (const n of notes) {
    await prisma.note.upsert({
      where: { id: n.id },
      update: {},
      create: {
        id: n.id,
        title: n.title,
        content: n.content,
        course: n.course ?? '',
        lesson: n.lesson ?? '',
        createdAt: toDate(n.createdAt) ?? new Date(),
        userId: n.userId,
      },
    })
  }

  for (const ef of expressionFolders) {
    await prisma.expressionFolder.upsert({
      where: { id: ef.id },
      update: {},
      create: {
        id: ef.id,
        name: ef.name,
        language: ef.language,
        createdAt: toDate(ef.createdAt) ?? new Date(),
        userId: ef.userId,
      },
    })
  }

  for (const w of words) {
    await prisma.word.upsert({
      where: { id: w.id },
      update: {},
      create: {
        id: w.id,
        word: w.word,
        reading: w.reading,
        meaning: w.meaning,
        example: w.example,
        note: w.note,
        partOfSpeech: w.partOfSpeech ?? '',
        language: w.language,
        folderId: w.folderId,
        sourceNoteId: w.sourceNoteId,
        createdAt: toDate(w.createdAt) ?? new Date(),
      },
    })
  }

  for (const r of reviews) {
    await prisma.review.upsert({
      where: { id: r.id },
      update: {},
      create: {
        id: r.id,
        wordId: r.wordId,
        interval: r.interval,
        repetition: r.repetition,
        easeFactor: r.easeFactor,
        difficultyScore: r.difficultyScore ?? 0,
        lastRating: r.lastRating ?? '',
        recentRatings: r.recentRatings ?? '',
        firstLearnedAt: toDate(r.firstLearnedAt),
        nextReviewDate: toDate(r.nextReviewDate) ?? new Date(),
        lastReviewedAt: toDate(r.lastReviewedAt),
      },
    })
  }

  for (const e of expressions) {
    await prisma.expression.upsert({
      where: { id: e.id },
      update: {},
      create: {
        id: e.id,
        zhText: e.zhText,
        enCasual: e.enCasual,
        jpCasual: e.jpCasual,
        sceneTag: e.sceneTag ?? '',
        note: e.note,
        isMastered: toBool(e.isMastered),
        folderId: e.folderId,
        createdAt: toDate(e.createdAt) ?? new Date(),
        updatedAt: toDate(e.updatedAt) ?? new Date(),
      },
    })
  }

  for (const log of aiUsageLogs) {
    await prisma.aiUsageLog.upsert({
      where: { id: log.id },
      update: {},
      create: {
        id: log.id,
        word: log.word,
        language: log.language,
        model: log.model,
        feature: log.feature ?? 'other',
        promptTokens: log.promptTokens,
        completionTokens: log.completionTokens,
        totalTokens: log.totalTokens,
        createdAt: toDate(log.createdAt) ?? new Date(),
        userId: log.userId,
      },
    })
  }

  console.log('Verifying SQLite counts:')
  const counts = await Promise.all([
    prisma.user.count(),
    prisma.folder.count(),
    prisma.note.count(),
    prisma.expressionFolder.count(),
    prisma.word.count(),
    prisma.review.count(),
    prisma.expression.count(),
    prisma.aiUsageLog.count(),
  ])
  const labels = [
    'User',
    'Folder',
    'Note',
    'ExpressionFolder',
    'Word',
    'Review',
    'Expression',
    'AiUsageLog',
  ]
  labels.forEach((label, i) => console.log(`  ${label}: ${counts[i]}`))
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
