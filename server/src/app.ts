import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { adminRouter } from './routes/admin'
import { aiRouter } from './routes/ai'
import { authRouter } from './routes/auth'
import { dictionaryRouter } from './routes/dictionary'
import { expressionsRouter } from './routes/expressions'
import { foldersRouter } from './routes/folders'
import { grammarRouter } from './routes/grammar'
import { grammarQuestionsRouter } from './routes/grammarQuestions'
import { grammarReviewRouter } from './routes/grammarReview'
import { healthRouter } from './routes/health'
import { notesRouter } from './routes/notes'
import { podcastsRouter } from './routes/podcasts'
import { qbankRouter } from './routes/qbank'
import { reviewRouter } from './routes/review'
import { settingsRouter } from './routes/settings'
import { weeklyReviewRouter } from './routes/weeklyReview'
import { wordsRouter } from './routes/words'
import { getEnv } from './lib/env'
import { handleError } from './middleware/errorHandler'
import { requireAdmin } from './middleware/requireAdmin'
import { requireAuth, type AppEnv } from './middleware/requireAuth'

/**
 * 不需要登录的接口。除了这里列出的，/api/* 一律要 token —— 默认拒绝，新加的
 * 路由自动是受保护的。反过来（逐条 app.use(path, requireAuth)）漏一条就是一个
 * 敞开的接口，而漏登记一条公开路由只会得到 401，错的方向是安全的那一侧。
 */
const PUBLIC_API_PATHS = ['/api/auth/login', '/api/health']

const LOCAL_ORIGIN_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

let originCache: { raw: string; set: Set<string> } | null = null

function isAllowedOrigin(origin: string): boolean {
  // 注意不能在 createApp() 顶层读 env：Worker 里 createApp 是模块加载时跑的，
  // 那会儿还没进 withEnv 的上下文。这个函数每次请求才调，是安全的。
  const raw = getEnv('ALLOWED_ORIGINS') ?? ''
  if (originCache?.raw !== raw) {
    originCache = {
      raw,
      set: new Set(
        raw
          .split(',')
          .map((s) => s.trim().replace(/\/$/, ''))
          .filter(Boolean),
      ),
    }
  }
  // 没配就放行所有来源 —— 退回加固前的行为。这样「先部署代码、后补配置」不会把
  // 线上前端锁在门外；真实的白名单跟着 wrangler.toml 一起发布，不靠人记得配。
  if (originCache.set.size === 0) return true
  return originCache.set.has(origin) || LOCAL_ORIGIN_RE.test(origin)
}

export function createApp() {
  const app = new Hono<AppEnv>()

  app.use(
    '*',
    cors({
      origin: (origin) => (origin && isAllowedOrigin(origin) ? origin : null),
      allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      maxAge: 86400,
    }),
  )

  app.get('/', (c) =>
    c.json({
      name: 'word-sprint-server',
      message: 'Vocabulary app backend is ready',
    }),
  )

  app.use('/api/*', async (c, next) => {
    const path = c.req.path
    const isPublic = PUBLIC_API_PATHS.some((p) => path === p || path.startsWith(`${p}/`))
    return isPublic ? next() : requireAuth(c, next)
  })

  // Admin：认证已由上面的守卫做掉，requireAdmin 只再校验一次管理员身份。
  // 用户名需在 ADMIN_USERNAMES（逗号分隔，小写）中。
  app.use('/api/admin/*', requireAdmin)

  app.route('/api/auth', authRouter)
  app.route('/api/health', healthRouter)
  app.route('/api/folders', foldersRouter)
  app.route('/api/words', wordsRouter)
  app.route('/api/review', reviewRouter)
  app.route('/api/settings', settingsRouter)
  app.route('/api/notes', notesRouter)
  app.route('/api/expressions', expressionsRouter)
  app.route('/api/grammar', grammarRouter)
  app.route('/api/grammar-questions', grammarQuestionsRouter)
  app.route('/api/grammar-reviews', grammarReviewRouter)
  app.route('/api/podcasts', podcastsRouter)
  app.route('/api/dictionary', dictionaryRouter)
  app.route('/api/qbank', qbankRouter)
  app.route('/api/weekly-review', weeklyReviewRouter)
  app.route('/api/ai', aiRouter)
  app.route('/api/admin', adminRouter)

  app.onError((err, c) => handleError(err, c))

  return app
}
