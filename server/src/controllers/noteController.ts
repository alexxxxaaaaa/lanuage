import type { Request, Response } from 'express'
import { createNote, getNoteById, getNotes, updateNote } from '../services/noteService'

function getPathParam(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : ''
}

export async function getNotesController(_request: Request, response: Response) {
  const notes = await getNotes()
  return response.json(notes)
}

export async function getNoteByIdController(request: Request, response: Response) {
  const note = await getNoteById(getPathParam(request.params.id))
  return response.json(note)
}

export async function createNoteController(request: Request, response: Response) {
  const { title, content, course, lesson } = request.body as {
    title?: string
    content?: string
    course?: string
    lesson?: string
  }

  const note = await createNote({
    title: title ?? '',
    content: content ?? '',
    course,
    lesson,
  })

  return response.status(201).json(note)
}

export async function updateNoteController(request: Request, response: Response) {
  const { title, content, course, lesson } = request.body as {
    title?: string
    content?: string
    course?: string
    lesson?: string
  }

  const note = await updateNote(getPathParam(request.params.id), {
    title,
    content,
    course,
    lesson,
  })

  return response.json(note)
}
