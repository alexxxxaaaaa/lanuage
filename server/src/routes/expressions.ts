import { Router } from 'express'
import {
  createExpressionFolderController,
  createExpressionController,
  deleteExpressionController,
  getExpressionFolderByIdController,
  getExpressionFoldersController,
  getExpressionByIdController,
  getExpressionsController,
  updateExpressionController,
} from '../controllers/expressionController'

export const expressionsRouter = Router()

expressionsRouter.get('/folders', getExpressionFoldersController)
expressionsRouter.get('/folders/:id', getExpressionFolderByIdController)
expressionsRouter.post('/folders', createExpressionFolderController)

expressionsRouter.get('/', getExpressionsController)
expressionsRouter.get('/:id', getExpressionByIdController)
expressionsRouter.post('/', createExpressionController)
expressionsRouter.patch('/:id', updateExpressionController)
expressionsRouter.delete('/:id', deleteExpressionController)
