import type { Request, Response } from 'express'
import {
  createExpressionFolder,
  createExpression,
  deleteExpression,
  getExpressionFolderById,
  getExpressionFolders,
  getExpressionById,
  getExpressions,
  updateExpression,
} from '../services/expressionService'

function getPathParam(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : ''
}

export async function getExpressionsController(request: Request, response: Response) {
  const q = typeof request.query.q === 'string' ? request.query.q : undefined
  const sceneTag = typeof request.query.sceneTag === 'string' ? request.query.sceneTag : undefined
  const folderId = typeof request.query.folderId === 'string' ? request.query.folderId : undefined
  const isMastered =
    typeof request.query.isMastered === 'string'
      ? request.query.isMastered === 'true'
      : undefined

  const expressions = await getExpressions({ q, sceneTag, isMastered, folderId })
  return response.json(expressions)
}

export async function getExpressionFoldersController(_request: Request, response: Response) {
  const folders = await getExpressionFolders()
  return response.json(folders)
}

export async function getExpressionFolderByIdController(request: Request, response: Response) {
  const folder = await getExpressionFolderById(getPathParam(request.params.id))
  return response.json(folder)
}

export async function createExpressionFolderController(request: Request, response: Response) {
  const { name, language } = request.body as { name?: string; language?: string }
  const folder = await createExpressionFolder({ name: name ?? '', language: language ?? '' })
  return response.status(201).json(folder)
}

export async function getExpressionByIdController(request: Request, response: Response) {
  const expression = await getExpressionById(getPathParam(request.params.id))
  return response.json(expression)
}

export async function createExpressionController(request: Request, response: Response) {
  const { zhText, folderId, enCasual, jpCasual, sceneTag, note, isMastered } = request.body as {
    zhText?: string
    folderId?: string
    enCasual?: string
    jpCasual?: string
    sceneTag?: string
    note?: string
    isMastered?: boolean
  }

  const created = await createExpression({
    zhText: zhText ?? '',
    folderId: folderId ?? '',
    enCasual,
    jpCasual,
    sceneTag,
    note,
    isMastered,
  })

  return response.status(201).json(created)
}

export async function updateExpressionController(request: Request, response: Response) {
  const { zhText, folderId, enCasual, jpCasual, sceneTag, note, isMastered } = request.body as {
    zhText?: string
    folderId?: string
    enCasual?: string
    jpCasual?: string
    sceneTag?: string
    note?: string
    isMastered?: boolean
  }

  const updated = await updateExpression(getPathParam(request.params.id), {
    zhText,
    folderId,
    enCasual,
    jpCasual,
    sceneTag,
    note,
    isMastered,
  })
  return response.json(updated)
}

export async function deleteExpressionController(request: Request, response: Response) {
  const result = await deleteExpression(getPathParam(request.params.id))
  return response.json(result)
}
