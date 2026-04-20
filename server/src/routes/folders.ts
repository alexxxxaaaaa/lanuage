import { Router } from 'express'
import {
  createFolderController,
  deleteFolderController,
  getFolderByIdController,
  getFoldersController,
  updateFolderController,
} from '../controllers/folderController'

export const foldersRouter = Router()

foldersRouter.post('/', createFolderController)
foldersRouter.get('/', getFoldersController)
foldersRouter.get('/:id', getFolderByIdController)
foldersRouter.patch('/:id', updateFolderController)
foldersRouter.delete('/:id', deleteFolderController)
