import cors from 'cors'
import express from 'express'
import { errorHandler } from './middleware/errorHandler'
import { foldersRouter } from './routes/folders'
import { healthRouter } from './routes/health'
import { reviewRouter } from './routes/review'
import { wordsRouter } from './routes/words'

export const app = express()

app.use(cors())
app.use(express.json())

app.get('/', (_request, response) => {
  response.json({
    name: 'word-sprint-server',
    message: 'Vocabulary app backend is ready',
  })
})

app.use('/folders', foldersRouter)
app.use('/words', wordsRouter)
app.use('/review', reviewRouter)
app.use('/api/folders', foldersRouter)
app.use('/api/words', wordsRouter)
app.use('/api/review', reviewRouter)
app.use('/api/health', healthRouter)
app.use(errorHandler)
