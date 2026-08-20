# Deploy to Cloudflare (Workers + Pages + D1)

Architecture:
- **Backend**: Cloudflare Worker (`server/`) — Hono framework, Prisma + D1 adapter
- **Database**: Cloudflare D1 (SQLite)
- **Frontend**: Cloudflare Pages (`client/`) — Vite build

Local dev keeps working via SQLite at `server/prisma/dev.db`.

---

## One-time setup

### 1. Login to Cloudflare

```bash
cd server
npx wrangler login
```

A browser tab will open. Authorize. This stores credentials at `~/.config/.wrangler/`.

### 2. Create the D1 database

```bash
cd server
npx wrangler d1 create word-sprint-db
```

Output looks like:

```
[[d1_databases]]
binding = "DB"
database_name = "word-sprint-db"
database_id = "abcdef12-3456-7890-abcd-ef1234567890"
```

**Copy the `database_id`** and paste it into [server/wrangler.toml](server/wrangler.toml), replacing `REPLACE_WITH_D1_DATABASE_ID`.

### 3. Apply the initial schema to remote D1

```bash
cd server
npm run d1:schema:apply:remote
```

This runs the SQLite migration in `prisma/migrations/20260508113011_init/migration.sql` against the cloud D1.

建库之后的每一次结构变更都是单独手工 execute 对应的那个迁移文件，不走 wrangler 的
迁移系统 —— 见下面 Day-2 的 **Schema change**，那里连同两个必须避开的坑一起写了。

### 4. Seed remote D1 with your existing data

```bash
cd server
npm run export:sqlite-to-d1-sql
npx wrangler d1 execute word-sprint-db --remote --file=./d1_seed.sql
```

This dumps your local SQLite into `d1_seed.sql` (217KB, ~540 INSERTs) and applies it to the cloud D1.

Verify:

```bash
npx wrangler d1 execute word-sprint-db --remote --command="SELECT COUNT(*) FROM Word;"
```

Should return 184.

### 5. Set Worker secrets

```bash
cd server
npx wrangler secret put JWT_SECRET     # paste long random string
npx wrangler secret put OPENAI_API_KEY # paste your OpenAI key
```

`OPENAI_MODEL` is non-sensitive and already set in `wrangler.toml` `[vars]`.

### 6. Deploy the Worker

```bash
cd server
npm run wrangler:deploy
```

Output gives you the Worker URL, like `https://word-sprint-server.your-subdomain.workers.dev`.

### 7. Wire frontend to the Worker URL

Edit [client/.env.production](client/.env.production):

```
VITE_API_BASE_URL="https://word-sprint-server.your-subdomain.workers.dev"
```

### 8. Deploy the frontend to Pages

First time:

```bash
cd client
npm run build
npx wrangler pages deploy dist --project-name word-sprint-client
```

It will ask whether to create a new project — answer **yes**. After upload it prints the Pages URL, like `https://word-sprint-client.pages.dev`.

---

## Day-2 deploys

**代码改动：push 就够了，不要手工 deploy。**

```bash
git push github main
```

前后端都由 Cloudflare 侧连着这个 GitHub 仓库自动构建：

| | 机制 | 触发 |
|---|---|---|
| 前端 | Pages Git 集成（项目 `word-sprint-client`） | push `main` |
| 后端 | Workers Builds（Worker `word-sprint-server`，root directory `server`） | push `main` |

构建记录在各自的 Deployments 页面看。

因此**协作者只要有本仓库的 write 权限就能发布全栈，不需要 Cloudflare 账号**。

两个陷阱：

- `client` 的 `pages:deploy` 脚本推到的是 `word-sprint-client.pages.dev`，自定义域名不指向那里 —— 跑它不会更新生产。同理 `server` 的 `wrangler:deploy` 只在你想绕过 CI 手动发一版时才用。
- Workers Builds 从 root directory（也就是 `server/`）里读 `.nvmrc` 决定 Node 版本，仓库根那份读不到。所以 `server/.nvmrc` 必须留着 —— 删了会回落到旧 Node，`prisma generate` 会以 `ERR_REQUIRE_ESM` 崩掉。

**Schema change**（这一步仍然手工，故意不自动化）:

1. 改 `server/prisma/schema.prisma`
2. 手写迁移：在 `server/prisma/migrations/` 下新建 `YYYYMMDDHHMMSS_改动名/migration.sql`，
   照已有那些文件的样子写 SQL，顶上用注释交代**为什么**要改（那些注释是这个目录最值钱的部分）
3. 应用到本地 dev.db：

   ```bash
   cd server
   sqlite3 prisma/dev.db < prisma/migrations/<你的目录>/migration.sql
   ```

4. 应用到生产 D1 —— **只 execute 你新加的那一个文件**：

   ```bash
   cd server
   npx wrangler d1 execute word-sprint-db --remote \
     --file=./prisma/migrations/<你的目录>/migration.sql
   ```

5. `npx prisma generate`，然后 push 让 Workers Builds 发版（想绕过 CI 就 `npm run wrangler:deploy`）

两个会出事的坑：

- **不要跑 `wrangler d1 migrations apply --remote`。** `wrangler.toml` 里确实配着
  `migrations_dir`，但生产的 `d1_migrations` 表从建库起就是空的 —— 历次变更都是按上面
  第 4 步逐个文件打的。跑 migrations apply 会认为全部迁移都没应用过，从 init 那个
  `CREATE TABLE` 开始重跑一遍。
- **不要跑 `prisma migrate dev`。** 有几个历史迁移文件在应用之后被改过，checksum 对不
  上，它会要求 reset 本地 dev.db（词典那 57 万行连同你的开发数据一起没）。手写迁移目录
  就是为了绕开它。

迁移文件名按时间戳排序，新的必须排在旧的后面：将来真要从零重建一个库，是照文件名顺序
一个个跑下来的。

**New Worker secret**:
```bash
cd server && npx wrangler secret put NAME_HERE
```

### 账号 / 登录相关的一次性动作

**本次账号系统加固要跑的迁移**（在部署新代码之前）：

```bash
cd server
npx wrangler d1 execute word-sprint-db --remote \
  --file=./prisma/migrations/20260805000000_auth_hardening/migration.sql
```

它给 `User` 加 `tokenVersion` 列、建 `LoginThrottle` 表。密码哈希不用迁移：新旧
格式在同一列里共存，老的 bcrypt 行会在各自下次登录时自动换成 PBKDF2。

部署后**所有人需要重新登录一次** —— token 里多了签发方和 `tokenVersion`，旧代码
签的那些验不过。这是一次性的。

**建账号**：日常走管理后台的「新建用户」。库里一个人都没有、或者要在生产补一个
管理员时，用脚本生成 INSERT 再喂给 D1：

```bash
cd server
npm run user:create -- someone 'their-password' --sql
# 把打印出来的那行 INSERT 贴进去：
npx wrangler d1 execute word-sprint-db --remote --command="<粘贴>"
```

管理员身份不在库里，而是看用户名在不在 `wrangler.toml` `[vars]` 的
`ADMIN_USERNAMES` 里 —— 改它要重新部署 Worker 才生效。

---

## Troubleshooting

- **CORS errors in browser**: the Worker only echoes back origins listed in `ALLOWED_ORIGINS` (`wrangler.toml` `[vars]`), plus any `localhost` / `127.0.0.1` port. A new front-end domain has to be added there and redeployed. Leaving the var empty falls back to allowing every origin. If the origin *is* listed, the cause is usually a misconfigured `VITE_API_BASE_URL` (trailing slash, wrong protocol).
- **Everyone got logged out after a deploy**: expected once, right after the auth-hardening release — tokens now carry an issuer and a `tokenVersion`, so ones signed by the old code no longer validate. Signing in again is all it takes.
- **`登录失败次数过多` on a valid password**: that IP tripped the login throttle (8 failures in 15 min → locked for 15 min). Clear it with `npx wrangler d1 execute word-sprint-db --remote --command="DELETE FROM LoginThrottle WHERE key='ip:1.2.3.4';"`.
- **`Failed to fetch` on R2 objects (transcripts) while audio plays fine**: the `jlpt` bucket has no CORS rules. Audio goes through an `<audio>` tag (no CORS), transcripts go through `fetch()` (CORS required). Fix by applying [server/scripts/r2-cors.json](server/scripts/r2-cors.json): `cd server && npm run cors:r2` (takes ~10s to propagate; check with `npx wrangler r2 bucket cors list jlpt`). Add any new front-end origin to that file — the rules cover the whole bucket, not just transcripts.
- **`process.env.X is undefined` in Worker logs**: Check that the secret is set (`wrangler secret list`) and that you're reading via `getEnv()`, not direct `process.env`.
- **D1 query fails locally with `wrangler dev`**: Run `npm run d1:schema:apply:local` first to set up the local D1 simulator. 它只灌 init 那个文件，之后的迁移要照 Schema change 第 3 步逐个 execute。
- **Local `npm run dev` (Node) and Workers behave differently**: Both share the same `app.ts`/routes/services. Differences are only in the entry (`index.ts` vs `worker.ts`), prisma adapter, and env source. If something works in Node but not Workers, it's almost always one of those three.

---

## What changed vs. the old MySQL/Express setup

| Before | After |
|---|---|
| `mysql` provider in Prisma | `sqlite` provider |
| `@db.Text/LongText` types | plain `String` (SQLite has no varchar limit) |
| Express + cors + body-parser | Hono with `cors()` middleware |
| `jsonwebtoken` | `jose` (works on Workers' V8) |
| `process.env` everywhere | `getEnv()` helper backed by AsyncLocalStorage |
| `prisma` singleton in `lib/prisma.ts` | proxy that picks the per-request client (Workers) or the singleton (Node) |
| Single Express entry `index.ts` | `index.ts` (Node) + `worker.ts` (Workers) sharing `createApp()` |
| MySQL local dev DB | Local SQLite at `prisma/dev.db` |

The MySQL legacy data was migrated via `scripts/migrateMysqlToSqlite.ts` (kept for reference).
