# Word Sprint

A vocabulary learning app with spaced repetition, AI-assisted word entries, expression drills, and rich-text notes.

- **client**: React 19 + Vite + HeroUI + Tailwind + BlockNote + Zustand
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

That's it — your local `server/prisma/dev.db` is fresh and empty. There is no
registration screen and no public registration endpoint: accounts are created
either from the admin dashboard (`POST /api/admin/users`) or, when the database
is still empty, from the CLI:

```bash
cd server && npm run user:create -- me 'your-password'
```

Then add `me` to `ADMIN_USERNAMES` in `server/.env` if this account should also
reach the admin dashboard, and sign in at `/login`.

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

# 1. 建表（本地 SQLite 用 prisma migrate；线上 D1 按顺序打 migration.sql）
#    下面三个都是一次性的：后两个是 ALTER TABLE，打第二遍会报 duplicate column。
npx wrangler d1 execute word-sprint-db --remote \
  --file=./prisma/migrations/20260802000000_qbank/migration.sql
npx wrangler d1 execute word-sprint-db --remote \
  --file=./prisma/migrations/20260802140000_qbank_alt_answer/migration.sql
npx wrangler d1 execute word-sprint-db --remote \
  --file=./prisma/migrations/20260802150000_qbank_ai_explain/migration.sql

# 2. 题目：markdown → 本地库 → 分片 SQL → D1
npm run import:qbank             # 3207 题写进 server/prisma/dev.db
npm run export:qbank-d1-sql      # 生成 d1_qbank/*.sql（31 片，gitignored）
bash d1_qbank/apply.sh           # 逐片打到线上 D1

# 3. 媒体：听力 mp3 + 情報検索图片 → R2 公共桶 jlpt 的 qbank/ 前缀
#    mp3 不入 git（R2 是唯一线上副本），本地得先跑 n1-qbank 的抓取脚本才有
npm run upload:qbank-media       # 1102 个文件 / 约 1.6 GB，可断点续传
```

行 id 是从「卷 + 卷内题号」推出来的稳定值（`n1-202012-q1`），
所以第 2 步能重复跑（`apply.sh` 里只带建表那个迁移，其余全是 `INSERT OR REPLACE`），
用户的作答记录和收藏不会被冲掉。
媒体地址由服务端拼，改域名只要改 `QBANK_MEDIA_BASE`（`server/wrangler.toml`）。

两处跟答案有关的口径，改数据或改判分前先看一眼：

- **分歧题两个答案都算对**：全库 11 道题两个来源（纳豆 / mojidict）答案不一致，
  官方答案无从查证，所以 `answer` 和 `altAnswer` 都判对。判分只有
  `qbankService.isAcceptedAnswer` 一处，精练和整卷模考共用；
  已交卷的整卷成绩是当时的快照，不追溯重算。
- **AI 解析缓存是全局的**：`QbankAiExplain` 一题一行，不带 userId ——
  第一个点的人付 token，之后所有人零成本命中，「重新生成」会覆盖所有人那一份。
  听力题（题干在音频里）和情報検索（材料是整张图）不给这个入口。

### 模拟考试（整卷计时考）

「JLPT → 模拟考试」把同一批题当整卷来考，只多一张用户维度的表
`QbankExamAttempt`（每人每套卷一行，重置 = 删行）。它取代了旧的「真题 / 精读」
板块（`Exam` / `ExamAttempt` 两表 + PDF→AI 解析那一套），后者已整体下线：

```bash
cd server
# 建模拟考试表
npx wrangler d1 execute word-sprint-db --remote \
  --file=./prisma/migrations/20260802120000_qbank_exam/migration.sql
# 删旧的真题 / 精读表（不可逆，建议先导出备份，见迁移文件里的说明）
npx wrangler d1 execute word-sprint-db --remote \
  --file=./prisma/migrations/20260802130000_drop_exam/migration.sql
```

流程是 `written`（文字・語彙 + 文法 + 読解，官方 110 分倒计时）→ 交卷 →
`listening`（听力）→ 交卷 → `done`（成绩 + 全卷解析）。两点值得记住：

- **未交卷的阶段，服务端不下发答案**：`answer` / `explain` / `stemZh` / 听力原文
  只在 `done` 时出现在接口里，交卷后服务端也拒绝再改答案。
- **听力是分段拼播**：题库只有每题一段的 mp3（整卷 `full.mp3` 没上传 R2），
  所以「全文播放」= 把该卷听力的分段排成播放列表连着放完，一段被两题共用时算一段。

考试记录与精练的答题卡/错题本互不干扰；成绩页的「加入错题本」才会把错题
写进 `QbankAttempt`。考试模式（严格 / 自我评估）存在浏览器本地，开考那一刻
定格到 attempt 上，中途改设置不影响进行中的考试。

## 笔记上线（BlockNote）

笔记从 Tiptap + HTML 换成了 [BlockNote](https://www.blocknotejs.org/)，编辑器存的是
`Block[]` 的 JSON。同时「课次」（自由文本）换成了日期字段，归类用的那个字段
仍然是笔记上的一个字符串，不建表。

```bash
cd server
# 本地：跟平时一样
npx prisma migrate dev

# 线上 D1：这条迁移是一次性的，打第二遍会报 duplicate column
npx wrangler d1 execute word-sprint-db --remote \
  --file=./prisma/migrations/20260803000000_note_lesson_at/migration.sql
```

迁移会把老的课次文本并进标题（`原标题 · L23`，标题为空就直接拿它当标题），
再把笔记时间和更新时间回填成创建时间，最后删掉 `lesson` 列。全是
`ALTER TABLE` / `UPDATE`，没有建表搬数据，`Word.sourceNoteId` 那条外键不受影响。

**正文格式是懒迁移的**。库里现在三种格式并存：BlockNote JSON（新）、Tiptap 的
HTML（老）、更早的 Slate JSON。打开一篇老笔记时，前端在
`client/src/components/notes/noteContent.ts` 里认出格式并转成 block 灌进编辑器，
等用户真的动了笔才按新格式写回去——只看不改的笔记会一直保持老格式，这是有意的，
不需要停机批量转换（HTML → block 要浏览器 DOM，服务端跑不了）。凡是服务端要
「读文字」的地方（列表摘要、搜索、后台查看）都走
`server/src/lib/noteContent.ts` 的纯文本视图，三种格式通吃。

搜索是两段式的：先用 SQL 的 `LIKE` 粗筛（正文在库里是 JSON/HTML，会顺带命中
标签名和 JSON 键），再在服务端按纯文本复筛掉假阳性，所以搜 `strong` 不会把所有
带加粗的笔记翻出来。

## 笔记去掉「课程」，改成标签

「课程」这个概念整个拿掉了：`Note.course` 改名成 `Note.tag`（界面上叫「标签」），
`Note.lessonAt` 改名成 `Note.noteAt`（界面上叫「时间」）。接口跟着改：
`GET /api/notes/courses` → `GET /api/notes/tags`，列表筛选的 query 从 `?course=`
变成 `?tag=`，写接口的 `course` / `lessonAt` 字段同理。

迁移是纯改名，用户已经填在「课程」里的字符串原样变成标签值：

```bash
cd server
# 本地
npx prisma migrate dev

# 线上 D1：一次性的，打第二遍会报 no such column
npx wrangler d1 execute word-sprint-db --remote \
  --file=./prisma/migrations/20260812120000_note_course_to_tag/migration.sql
```

两条索引是先删后建：SQLite 的 `RENAME COLUMN` 会自动改写索引里的列名，但索引
**名**还留着老列名，跟 Prisma 按 schema 推出来的名字对不上，下次 migrate 会当成
drift。
