import { Router } from 'express'
import {
  createNoteController,
  getNoteByIdController,
  getNotesController,
  updateNoteController,
} from '../controllers/noteController'

export const notesRouter = Router()

notesRouter.get('/', getNotesController)
notesRouter.get('/:id', getNoteByIdController)
notesRouter.post('/', createNoteController)
notesRouter.patch('/:id', updateNoteController)
