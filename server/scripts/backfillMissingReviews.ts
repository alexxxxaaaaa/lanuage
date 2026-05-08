import { prisma } from '../src/lib/prisma'

async function main() {
  const wordsWithoutReview = await prisma.word.findMany({
    where: {
      review: {
        is: null,
      },
    },
    select: {
      id: true,
    },
  })

  if (wordsWithoutReview.length === 0) {
    console.log('No missing review records found.')
    return
  }

  const now = new Date()
  const operations = wordsWithoutReview.map((word) =>
    prisma.review.create({
      data: {
        wordId: word.id,
        interval: 1,
        repetition: 0,
        easeFactor: 2.5,
        nextReviewDate: now,
      },
    }),
  )

  await prisma.$transaction(operations)
  console.log(`Backfilled ${wordsWithoutReview.length} review records.`)
}

void main()
  .catch((error) => {
    console.error('Backfill failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
