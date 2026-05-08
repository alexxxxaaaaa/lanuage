import { Router } from 'express'
import {
  createWordController,
  deleteWordController,
  exportWordsCsvController,
  getTodayNewWordsController,
  getWordsController,
  updateWordController,
} from '../controllers/wordController'

export const wordsRouter = Router()

wordsRouter.post('/', createWordController)
wordsRouter.get('/today-new', getTodayNewWordsController)
wordsRouter.get('/export', exportWordsCsvController)
wordsRouter.get('/', getWordsController)
wordsRouter.patch('/:id', updateWordController)
wordsRouter.delete('/:id', deleteWordController)
