export interface AuthUser {
  id: string
  username: string
  createdAt?: string
}

export interface LoginResponse {
  token: string
  user: AuthUser
}

export interface Paged<T> {
  total: number
  page: number
  pageSize: number
  rows: T[]
}

export interface AdminStats {
  users: number
  folders: number
  words: number
  notes: number
  expressions: number
  expressionFolders: number
  reviews: number
  aiLogs: number
  aiTotalTokens: number
  aiPromptTokens: number
  aiCompletionTokens: number
  last7DaysNewUsers: number
}

export interface AdminUserRow {
  id: string
  username: string
  passwordHash?: string
  createdAt: string
  folderCount: number
  noteCount: number
  expressionFolderCount: number
  aiUsageCount: number
}

export interface AdminUserDetail extends AdminUserRow {
  passwordHash: string
  wordCount: number
  expressionCount: number
  aiTotalTokens: number
  aiPromptTokens: number
  aiCompletionTokens: number
}

export interface AdminFolderRow {
  id: string
  name: string
  language: string
  userId: string
  username: string
  wordCount: number
}

export interface AdminWordRow {
  id: string
  word: string
  reading: string
  meaning: string
  partOfSpeech: string
  example: string
  language: string
  folderId: string
  folderName: string
  userId: string
  username: string
  createdAt: string
}

export interface AdminNoteRow {
  id: string
  title: string
  course: string
  lesson: string
  createdAt: string
  userId: string
  username: string
  wordCount: number
}

export interface AdminNoteDetail extends AdminNoteRow {
  content: string
  user: { username: string }
}

export interface AdminExpressionRow {
  id: string
  zhText: string
  enCasual: string
  jpCasual: string
  sceneTag: string
  isMastered: boolean
  folderId: string
  folderName: string
  language: string
  userId: string
  username: string
  createdAt: string
}

export interface AdminAiUsageRow {
  id: string
  word: string
  language: string
  model: string
  feature: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  createdAt: string
  userId: string
  username: string
}

export interface AdminAiUsageResponse extends Paged<AdminAiUsageRow> {
  totals: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}
