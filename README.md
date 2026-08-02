# Word Sprint

A vocabulary learning app with spaced repetition, AI-assisted word entries, expression drills, and rich-text course notes.

- **client**: React 19 + Vite + Ant Design + Tiptap + Zustand
- **server**: Hono + Prisma + SQLite (local) / Cloudflare D1 (prod) + OpenAI
- Monorepo via npm workspaces

## First-time setup (after cloning on a new machine)

```bash
# from repo root
npm install                       # installs client + server via workspaces

# server env
cp server/.env.example server/.env
# edit server/.env: set JWT_SECRET (openssl rand -hex 32) and OPENAI_API_KEY

# initialise the local SQLite database
cd server && npx prisma migrate dev
```

That's it — your local `server/prisma/dev.db` is fresh and empty. Visit the app, register a user via `/register`, and start adding words.

## Daily development

From the repo root:

```bash
npm run dev          # runs client (Vite) and server (Hono) together
# or separately
npm run client:dev
npm run server:dev
```

- Client: <http://localhost:5173>
- Server: <http://localhost:3000>

## Using the cloud account from local dev

默认情况下 `npm run client:dev` 会读取 [client/.env.development](client/.env.development)，把 `VITE_API_BASE_URL` 指向线上 Worker，所以本地浏览器登录的是线上账号，看到的是线上 D1 的数据。本地的 `server` 进程依然可以跑，但前端不会去访问它。

如果想临时回去用本地 SQLite + 本地 server，新建 `client/.env.development.local`（已被 gitignore，因为 `.gitignore` 里有 `*.local`）：

```
VITE_API_BASE_URL=""
```

留空时 axios 走相对路径，Vite dev 代理把 `/api/*` 转到 `http://localhost:3000`，也就是本地 Hono 服务。删掉这个文件即可恢复连线上。

## What does **not** sync across machines

- **`server/prisma/dev.db`** — your local data file. Gitignored on purpose. Each machine has its own.
- **`server/.env`** — secrets. Also gitignored. Copy from `.env.example` on each machine.
- **`node_modules`** — gitignored. Run `npm install` after pulling.

## What **does** sync

- All code in `client/` and `server/`
- Prisma schema and migrations in `server/prisma/`
- Lockfiles (`package-lock.json` at root)

So the cross-machine workflow is:

| On machine A | On machine B |
|---|---|
| edit code, change schema | `git pull` |
| `npx prisma migrate dev --name <change>` (locally tests & creates migration SQL) | `npx prisma migrate dev` (re-applies migrations, regenerates client) |
| `git add server/prisma/migrations/* && git commit && git push` | resume work |

Your local data on each machine evolves independently. If you need to move actual rows between machines, scp the `dev.db` file manually — but normally you don't.

## Production deploy (Cloudflare)

Schema and seed scripts are pre-wired for Cloudflare D1 + Workers + Pages.

```bash
# Apply latest migration to remote D1
cd server && npm run d1:schema:apply:remote

# (optional) seed remote D1 with data from local SQLite
npm run export:sqlite-to-d1-sql
npm run d1:seed:remote

# Deploy backend Worker
npm run wrangler:deploy

# Deploy frontend to Cloudflare Pages
cd ../client && npm run pages:deploy
```

See `DEPLOY.md` for full details.

## JLPT 精练题库上线（qbank）

网站的「JLPT 精练」板块吃的是 `QbankPassage` / `QbankQuestion` 两张全局表，
数据源是 [`n1-qbank/markdown`](n1-qbank/README.md)（31 套真题 / 3207 题，入 git）。
题目和媒体走两条通道：

```bash
cd server

# 1. 建表（本地 SQLite 用 prisma migrate；线上 D1 直接打 migration.sql）
npx wrangler d1 execute word-sprint-db --remote \
  --file=./prisma/migrations/20260802000000_qbank/migration.sql

# 2. 题目：markdown → 本地库 → 分片 SQL → D1
npm run import:qbank             # 3207 题写进 server/prisma/dev.db
npm run export:qbank-d1-sql      # 生成 d1_qbank/*.sql（31 片，gitignored）
bash d1_qbank/apply.sh           # 逐片打到线上 D1

# 3. 媒体：听力 mp3 + 情報検索图片 → R2 公共桶 jlpt 的 qbank/ 前缀
npm run upload:qbank-media       # 1102 个文件 / 约 1.6 GB，可断点续传
```

行 id 是从「卷 + 卷内题号」推出来的稳定值（`n1-202012-q1`），
所以 1、2 两步都能重复跑，用户的作答记录和收藏不会被冲掉。
媒体地址由服务端拼，改域名只要改 `QBANK_MEDIA_BASE`（`server/wrangler.toml`）。
