import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { aiRouter } from './routes/ai'
import { authRouter } from './routes/auth'
import { dictionaryRouter } from './routes/dictionary'
import { expressionsRouter } from './routes/expressions'
import { foldersRouter } from './routes/folders'
import { healthRouter } from './routes/health'
import { notesRouter } from './routes/notes'
import { reviewRouter } from './routes/review'
import { wordsRouter } from './routes/words'
import { handleError } from './middleware/errorHandler'
import { requireAuth, type AppEnv } from './middleware/requireAuth'

export function createApp() {
  const app = new Hono<AppEnv>()

  app.use('*', cors())

  app.get('/', (c) =>
    c.json({
      name: 'word-sprint-server',
      message: 'Vocabulary app backend is ready',
    }),
  )

  // Public
  app.route('/api/auth', authRouter)
  app.route('/api/health', healthRouter)

  // Protected
  app.use('/api/folders/*', requireAuth)
  app.route('/api/folders', foldersRouter)

  app.use('/api/words/*', requireAuth)
  app.route('/api/words', wordsRouter)

  app.use('/api/review/*', requireAuth)
  app.route('/api/review', reviewRouter)

  app.use('/api/notes/*', requireAuth)
  app.route('/api/notes', notesRouter)

  app.use('/api/expressions/*', requireAuth)
  app.route('/api/expressions', expressionsRouter)

  app.use('/api/dictionary/*', requireAuth)
  app.route('/api/dictionary', dictionaryRouter)

  app.use('/api/ai/*', requireAuth)
  app.route('/api/ai', aiRouter)

  app.onError((err, c) => handleError(err, c))

  return app
}
