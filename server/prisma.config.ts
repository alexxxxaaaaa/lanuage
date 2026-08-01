import path from 'node:path'
import 'dotenv/config'
import { defineConfig } from '@prisma/config'

/**
 * Prisma 7 moved the datasource connection out of schema.prisma and into this
 * file. It covers the CLI only (migrate / studio / db push) and always points
 * at local SQLite — production runs on Cloudflare D1, whose schema is applied
 * with `npm run d1:schema:apply:remote`, not with `prisma migrate`.
 *
 * The runtime connection is separate and comes from a driver adapter:
 * createNodePrismaClient() in src/lib/prisma.ts for Node, PrismaD1 in
 * src/worker.ts for Workers. Keep the URL default below in sync with the
 * former — both address the same local database file.
 */
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  datasource: {
    url: process.env.DATABASE_URL ?? 'file:./prisma/dev.db',
  },
})
