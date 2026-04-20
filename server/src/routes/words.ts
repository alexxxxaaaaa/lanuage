import { Router } from 'express'
import {
  createWordController,
  deleteWordController,
  getWordsController,
  updateWordController,
} from '../controllers/wordController'

export const wordsRouter = Router()

wordsRouter.post('/', createWordController)
wordsRouter.get('/', getWordsController)
wordsRouter.patch('/:id', updateWordController)
wordsRouter.delete('/:id', deleteWordController)
