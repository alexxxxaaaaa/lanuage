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
  isPinned?: boolean
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
  isPinned?: boolean
  pinnedAt?: string | null
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
  difficultyScore?: number
  lastRating?: string
  recentRatings?: string
  firstLearnedAt?: string | null
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

export type Grammar = {
  id: string
  pattern: string
  connection: string
  meaning: string
  example: string
  exampleZh: string
  note: string
  level: string
  isPinned?: boolean
  pinnedAt?: string | null
  isLearned?: boolean
  createdAt?: string
  updatedAt?: string
  review?: GrammarReview | null
}

export type GrammarReview = {
  id: string
  grammarId: string
  interval: number
  repetition: number
  easeFactor: number
  difficultyScore: number
  lastRating: string
  recentRatings: string
  firstLearnedAt: string | null
  nextReviewDate: string
  lastReviewedAt: string | null
}

export type GrammarReviewItem = GrammarReview & {
  grammar: Grammar
}

export type CreateGrammarPayload = {
  pattern: string
  connection?: string
  meaning?: string
  example?: string
  exampleZh?: string
  note?: string
  level?: string
}

export type UpdateGrammarPayload = Partial<CreateGrammarPayload> & {
  isPinned?: boolean
  isLearned?: boolean
}

export type PodcastSummary = {
  id: string
  youtubeId: string
  // Non-empty when this is an mp3-based podcast (served from the frontend's
  // public/ folder). Frontend renders HTML audio instead of YouTube iframe.
  mp3Url?: string
  title: string
  primaryLang: 'jp' | 'en'
  thumbnail: string
  durationSec: number
  lastPositionSec?: number
  createdAt?: string
  // Last time the row was touched. Since `lastPositionSec` is PATCHed during
  // playback, this serves as a "last watched at" timestamp.
  updatedAt?: string
}

export type TranscriptLine = {
  start: number
  dur: number
  text: string
  zh?: string
}

export type Podcast = PodcastSummary & {
  transcript: {
    lines: TranscriptLine[]
    primaryTrack: { languageCode: string; kind: string }
    chineseTrack?: { languageCode: string; kind: string } | null
  }
}

export type YoutubeCaptionTrack = {
  languageCode: string
  name: string
  kind: 'asr' | 'manual'
  baseUrl: string
}

export type YoutubeInspectResult = {
  videoId: string
  title: string
  durationSec: number
  thumbnail: string
  captionTracks: YoutubeCaptionTrack[]
}

// Real-exam (真题) types. Section categories mirror the JLPT question
// families so the UI can render each with appropriate layout.
export type ExamSectionType =
  | 'vocabulary_reading'
  | 'vocabulary_kanji'
  | 'vocabulary_context'
  | 'vocabulary_paraphrase'
  | 'vocabulary_usage'
  | 'grammar_choose'
  | 'grammar_arrange'
  | 'reading_comprehension'
  | 'listening'
  | 'other'

export type ExamQuestion = {
  id: number
  stem: string
  target?: string
  choices: string[]
  // Per-question passage. Populated when a section groups multiple sub-passages
  // (e.g. 問題8 has 4 unrelated short passages; each question carries its own).
  passage?: string
  // Groups adjacent questions under a shared listening prompt (e.g. 問題5's
  // 3番 has 質問1 + 質問2 about the same audio). Frontend collapses the shared
  // heading above the first occurrence.
  groupTitle?: string
  answer: number | null
  explanation?: string
}

export type ExamSection = {
  type: ExamSectionType
  instruction: string
  passage?: string
  questions: ExamQuestion[]
}

export type ExamListItem = {
  id: string
  title: string
  year: string
  level: string
  questionPdfUrl: string
  solutionPdfUrl: string
  audioUrl: string
  createdAt: string
  updatedAt: string
}

export type SubtitleLine = {
  startMs: number
  endMs: number
  text: string
}

export type ExamDetail = ExamListItem & {
  // Optional per-exam listening subtitle URL — served from client/public/exam-media/
  // when the exam ships an SRT alongside its audio. Read out of parsedData.meta
  // so we don't have to change the DB schema.
  subtitleUrl?: string
  parsedData: {
    sections: ExamSection[]
    meta?: { subtitleUrl?: string }
  }
}
