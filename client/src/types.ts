export type Folder = {
  id: string
  name: string
  language: 'en' | 'jp'
  dueCount?: number
  masteredCount?: number
  reviewedTodayCount?: number
  _count?: {
    words: number
  }
}

export type Note = {
  id: string
  title: string
  content: string
  course: string
  lesson: string
  createdAt: string
  _count?: {
    words: number
  }
}

export type Expression = {
  id: string
  zhText: string
  enCasual: string
  jpCasual: string
  sceneTag: string
  note: string
  isMastered: boolean
  folderId: string
  folder?: ExpressionFolder
  createdAt: string
  updatedAt: string
}

export type ExpressionFolder = {
  id: string
  name: string
  language: 'en' | 'jp'
  createdAt: string
  _count?: {
    expressions: number
  }
  expressions?: Expression[]
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
  partOfSpeech?: string
  sourceNoteId?: string | null
  folderId?: string
}

export type Review = {
  id: string
  wordId: string
  interval: number
  repetition: number
  easeFactor: number
  difficultyScore?: number
  lastRating?: string
  recentRatings?: string
  firstLearnedAt?: string | null
  nextReviewDate: string
  lastReviewedAt: string | null
}

export type Word = {
  id: string
  word: string
  reading: string
  meaning: string
  example: string
  note: string
  partOfSpeech: string
  language: string
  folderId: string
  sourceNoteId?: string | null
  createdAt?: string
  folder?: Folder
  sourceNote?: Note | null
  review?: Review | null
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
  partOfSpeech: string
  sourceNoteId?: string
  language: string
  folderId: string
}
