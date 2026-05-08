import { Router } from 'express'
import { lookupDictionaryController } from '../controllers/dictionaryController'

export const dictionaryRouter = Router()

dictionaryRouter.get('/lookup', lookupDictionaryController)
