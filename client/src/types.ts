export type Folder = {
  id: string
  name: string
  language: 'en' | 'jp'
  _count?: {
    words: number
  }
}

export type FolderDetail = Folder & {
  words: Word[]
}

export type CreateFolderPayload = {
  name: string
  language: 'en' | 'jp'
}

export type UpdateFolderPayload = {
  name?: string
  language?: 'en' | 'jp'
}

export type UpdateWordPayload = {
  word?: string
  reading?: string
  meaning?: string
  example?: string
  note?: string
}

export type Word = {
  id: string
  word: string
  reading: string
  meaning: string
  example: string
  note: string
  language: string
  folderId: string
  createdAt?: string
  folder?: Folder
}

export type ReviewItem = {
  id: string
  wordId: string
  interval: number
  repetition: number
  easeFactor: number
  nextReviewDate: string
  lastReviewedAt: string | null
  word: Word & {
    folder: Folder
  }
}

export type ReviewRating = 'again' | 'hard' | 'easy'

export type CreateWordPayload = {
  word: string
  reading: string
  meaning: string
  example: string
  note: string
  language: string
  folderId: string
}
