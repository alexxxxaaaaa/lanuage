/**
 * 建账号的命令行入口。
 *
 * 公开注册接口下线后，日常建号走管理后台（POST /api/admin/users）—— 但那需要
 * 先有一个管理员登得进去。全新的库里一个用户都没有，就成了死循环。这个脚本是
 * 打破循环的那一手，也是生产上换管理员时的退路。
 *
 *   npm run user:create -- alice 'her-password'          # 写本地 dev.db
 *   npm run user:create -- alice 'her-password' --sql     # 只打印 INSERT，喂给 D1
 *
 * 管理员身份不在这张表里 —— 建完还要把用户名加进 ADMIN_USERNAMES
 * （本地在 server/.env，线上在 wrangler.toml 的 [vars]）。
 */
import { prisma } from '../src/lib/prisma'
import { assertCredentialFormat, normalizeUsername } from '../src/lib/credentials'
import { hashPassword } from '../src/lib/password'

function usage(): never {
  console.error("用法: npm run user:create -- <用户名> <密码> [--sql]")
  process.exit(1)
}

async function main() {
  const args = process.argv.slice(2)
  const sqlOnly = args.includes('--sql')
  const [rawUsername, password] = args.filter((a) => a !== '--sql')
  if (!rawUsername || !password) usage()

  const username = normalizeUsername(rawUsername)
  assertCredentialFormat(username, password)

  const passwordHash = await hashPassword(password)
  const id = crypto.randomUUID()

  if (sqlOnly) {
    // 手写 INSERT 而不是 prisma —— D1 不在这个进程能连的范围内，输出交给
    // `npx wrangler d1 execute word-sprint-db --remote --command "<贴这里>"`。
    // 用户名和哈希都过了上面的格式校验，不含引号，直接内联是安全的。
    console.log(
      `INSERT INTO "User" ("id","username","passwordHash","tokenVersion","createdAt") ` +
        `VALUES ('${id}','${username}','${passwordHash}',0,CURRENT_TIMESTAMP);`,
    )
    return
  }

  const existing = await prisma.user.findUnique({ where: { username }, select: { id: true } })
  if (existing) {
    console.error(`用户名 ${username} 已被占用`)
    process.exit(1)
  }

  await prisma.user.create({ data: { id, username, passwordHash } })
  console.log(`已创建用户 ${username}（id ${id}）`)
  console.log('要让它能进管理后台，把用户名加进 ADMIN_USERNAMES 再重启服务。')
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
