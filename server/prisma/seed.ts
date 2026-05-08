import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const SEED_USER_ID = '00000000-0000-0000-0000-000000000001'

async function main() {
  await prisma.review.deleteMany()
  await prisma.word.deleteMany()
  await prisma.folder.deleteMany()

  const englishFolder = await prisma.folder.create({
    data: {
      name: 'CET-4',
      language: 'en',
      userId: SEED_USER_ID,
      words: {
        create: [
          {
            word: 'abandon',
            reading: '/əˈbændən/',
            meaning: '放弃；抛弃',
            example: 'He decided to abandon the plan.',
            note: '常见于阅读理解',
            language: 'en',
            review: {
              create: {
                interval: 1,
                repetition: 0,
                easeFactor: 2.5,
                nextReviewDate: new Date(),
              },
            },
          },
          {
            word: 'efficient',
            reading: '/ɪˈfɪʃənt/',
            meaning: '高效的',
            example: 'This method is simple and efficient.',
            note: '可用于写作表达',
            language: 'en',
          },
        ],
      },
    },
    include: {
      words: {
        include: {
          review: true,
        },
      },
    },
  })

  const japaneseFolder = await prisma.folder.create({
    data: {
      name: 'N5',
      language: 'jp',
      userId: SEED_USER_ID,
      words: {
        create: [
          {
            word: '猫',
            reading: 'ねこ',
            meaning: '猫',
            example: 'この猫はとてもかわいいです。',
            note: '日语常用名词',
            language: 'jp',
          },
        ],
      },
    },
    include: {
      words: true,
    },
  })

  console.log('Seeded folders:', {
    englishFolderId: englishFolder.id,
    japaneseFolderId: japaneseFolder.id,
    englishWords: englishFolder.words.length,
    japaneseWords: japaneseFolder.words.length,
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
