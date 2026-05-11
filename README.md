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

## Importing legacy MySQL data (one-off)

If you have data in the old MySQL database and want to migrate it into local SQLite:

1. Set `LEGACY_MYSQL_URL` in `server/.env` to your MySQL connection string.
2. `cd server && npm run migrate:mysql-to-sqlite`

Note: this expects a `User` table to exist in MySQL. If the source MySQL predates the auth refactor, the script will need manual adjustment.
