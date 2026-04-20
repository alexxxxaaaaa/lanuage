import type { Request, Response } from 'express'
import {
  createFolder,
  deleteFolder,
  getFolderById,
  getFolders,
  updateFolder,
} from '../services/folderService'

function getPathParam(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : ''
}

export async function createFolderController(request: Request, response: Response) {
  const { name, language } = request.body as {
    name?: string
    language?: string
  }

  const folder = await createFolder(name ?? '', language ?? '')
  return response.status(201).json(folder)
}

export async function getFoldersController(_request: Request, response: Response) {
  const folders = await getFolders()
  return response.json(folders)
}

export async function getFolderByIdController(request: Request, response: Response) {
  const folder = await getFolderById(getPathParam(request.params.id))
  return response.json(folder)
}

export async function updateFolderController(request: Request, response: Response) {
  const { name, language } = request.body as {
    name?: string
    language?: string
  }

  const folder = await updateFolder(getPathParam(request.params.id), { name, language })
  return response.json(folder)
}

export async function deleteFolderController(request: Request, response: Response) {
  const result = await deleteFolder(getPathParam(request.params.id))
  return response.json(result)
}
