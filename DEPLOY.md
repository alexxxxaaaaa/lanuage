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

### 3. Apply migrations to remote D1

```bash
cd server
npm run d1:migrations:apply:remote
```

This runs the SQLite migration in `prisma/migrations/20260508113011_init/migration.sql` against the cloud D1.

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
1. Edit `server/prisma/schema.prisma`
2. `npx prisma migrate dev --name your_change` (creates a new local migration + updates `dev.db`)
3. `cd server && npm run d1:migrations:apply:remote` (applies same migration to cloud D1)
4. Re-deploy worker: `npm run wrangler:deploy`

**New Worker secret**:
```bash
cd server && npx wrangler secret put NAME_HERE
```

---

## Troubleshooting

- **CORS errors in browser**: Worker already enables `cors()` for all origins. If you see CORS blocks, it's usually a misconfigured `VITE_API_BASE_URL` (trailing slash, wrong protocol).
- **`Failed to fetch` on R2 objects (transcripts) while audio plays fine**: the `jlpt` bucket has no CORS rules. Audio goes through an `<audio>` tag (no CORS), transcripts go through `fetch()` (CORS required). Fix by applying [server/scripts/r2-cors.json](server/scripts/r2-cors.json): `cd server && npm run cors:r2` (takes ~10s to propagate; check with `npx wrangler r2 bucket cors list jlpt`). Add any new front-end origin to that file — the rules cover the whole bucket, not just transcripts.
- **`process.env.X is undefined` in Worker logs**: Check that the secret is set (`wrangler secret list`) and that you're reading via `getEnv()`, not direct `process.env`.
- **D1 query fails locally with `wrangler dev`**: Run `npm run d1:migrations:apply:local` first to set up the local D1 simulator.
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
