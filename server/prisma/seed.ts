import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const SEED_USER_ID = '00000000-0000-0000-0000-000000000001'

async function main() {
  await prisma.review.deleteMany()
  await prisma.wordFolder.deleteMany()
  await prisma.word.deleteMany()
  await prisma.folder.deleteMany()

  const englishFolder = await prisma.folder.create({
    data: { name: 'CET-4', language: 'en', userId: SEED_USER_ID },
  })
  const japaneseFolder = await prisma.folder.create({
    data: { name: 'N5', language: 'jp', userId: SEED_USER_ID },
  })

  // 词单归属挂在 WordFolder 上，所以词是先建再挂进词单的。
  const seedWords = [
    {
      folderId: englishFolder.id,
      word: 'abandon',
      reading: '/əˈbændən/',
      meaning: '放弃；抛弃',
      example: 'He decided to abandon the plan.',
      note: '常见于阅读理解',
      language: 'en',
      withReview: true,
    },
    {
      folderId: englishFolder.id,
      word: 'efficient',
      reading: '/ɪˈfɪʃənt/',
      meaning: '高效的',
      example: 'This method is simple and efficient.',
      note: '可用于写作表达',
      language: 'en',
      withReview: false,
    },
    {
      folderId: japaneseFolder.id,
      word: '猫',
      reading: 'ねこ',
      meaning: '猫',
      example: 'この猫はとてもかわいいです。',
      note: '日语常用名詞',
      language: 'jp',
      withReview: false,
    },
  ]

  for (const { folderId, withReview, ...word } of seedWords) {
    await prisma.word.create({
      data: {
        ...word,
        userId: SEED_USER_ID,
        partOfSpeech: '',
        pinnedAt: new Date(),
        folders: { create: { folderId } },
        ...(withReview
          ? {
              review: {
                create: {
                  interval: 1,
                  repetition: 0,
                  easeFactor: 2.5,
                  nextReviewDate: new Date(),
                },
              },
            }
          : {}),
      },
    })
  }

  console.log('Seeded folders:', {
    englishFolderId: englishFolder.id,
    japaneseFolderId: japaneseFolder.id,
    words: seedWords.length,
  })
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
