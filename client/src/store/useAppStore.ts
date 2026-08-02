import { create } from 'zustand'
import { getErrorMessage } from '../api/error'
import {
  createFolder as createFolderApi,
  deleteFolder as deleteFolderApi,
  getFolders as getFoldersApi,
  updateFolder as updateFolderApi,
} from '../api/folders'
import { getTodayReviews as getTodayReviewsApi } from '../api/review'
import {
  createWord as createWordApi,
  deleteWord as deleteWordApi,
  updateWord as updateWordApi,
} from '../api/words'
import type {
  CreateFolderPayload,
  CreateWordPayload,
  Folder,
  ReviewItem,
  UpdateFolderPayload,
  UpdateWordPayload,
} from '../types'

/**
 * Cross-page shared state: the wordlists, today's due pool, and the global
 * "learn count" preference.
 *
 * Deliberately NOT here: the state of a running learn/review session. Those
 * are per-wordlist and several can be half-finished at once (start one, go
 * look a word up, start another) — a single set of `currentIndex` / `queue`
 * fields in a global store would let one session clobber another. Each
 * session page owns its own state instead and stays mounted via
 * `KeepAliveOutlet`, so leaving and coming back resumes exactly where it was.
 */
type AppState = {
  folders: Folder[]
  /** Every word due today, across all wordlists. Sessions snapshot from it. */
  dueReviews: ReviewItem[]
  /** False until the due pool has been fetched once — sessions wait for it. */
  hasLoadedReviews: boolean
  /** How many new words one learn session covers. `null` = no cap. */
  sessionLimit: number | null
  isLoadingFolders: boolean
  isLoadingReviews: boolean
  isSubmitting: boolean
  error: string | null
  fetchFolders: () => Promise<void>
  createFolder: (payload: CreateFolderPayload) => Promise<Folder | null>
  updateFolder: (id: string, payload: UpdateFolderPayload) => Promise<void>
  deleteFolder: (id: string) => Promise<void>
  fetchTodayReviews: () => Promise<void>
  /** Drops words from the due pool once they are reviewed or mastered. */
  dropDueWords: (wordIds: readonly string[]) => void
  shuffleDueReviews: () => void
  setSessionLimit: (limit: number | null) => void
  createWord: (payload: CreateWordPayload) => Promise<void>
  updateWord: (id: string, payload: UpdateWordPayload) => Promise<void>
  deleteWord: (id: string) => Promise<void>
  clearError: () => void
}

const SESSION_LIMIT_KEY = 'word-sprint-session-limit'
const DEFAULT_SESSION_LIMIT = 20

function loadSessionLimit(): number | null {
  if (typeof window === 'undefined') return DEFAULT_SESSION_LIMIT
  try {
    const raw = window.localStorage.getItem(SESSION_LIMIT_KEY)
    if (raw === null) return DEFAULT_SESSION_LIMIT
    if (raw === 'null') return null
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SESSION_LIMIT
  } catch {
    return DEFAULT_SESSION_LIMIT
  }
}

function persistSessionLimit(limit: number | null) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      SESSION_LIMIT_KEY,
      limit === null ? 'null' : String(limit),
    )
  } catch {
    // Private mode / quota — the in-memory value still applies this session.
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  folders: [],
  dueReviews: [],
  hasLoadedReviews: false,
  sessionLimit: loadSessionLimit(),
  isLoadingFolders: false,
  isLoadingReviews: false,
  isSubmitting: false,
  error: null,
  clearError: () => set({ error: null }),
  fetchFolders: async () => {
    set({ isLoadingFolders: true, error: null })

    try {
      const response = await getFoldersApi()
      set({
        folders: Array.isArray(response) ? response : [],
        isLoadingFolders: false,
      })
    } catch (error) {
      set({
        isLoadingFolders: false,
        error: getErrorMessage(error, '加载词单失败'),
      })
    }
  },
  createFolder: async (payload) => {
    set({ isSubmitting: true, error: null })

    try {
      const folder = await createFolderApi(payload)
      set({ isSubmitting: false })
      await get().fetchFolders()
      return folder
    } catch (error) {
      set({
        isSubmitting: false,
        error: getErrorMessage(error, '创建词单失败'),
      })
      return null
    }
  },
  updateFolder: async (id, payload) => {
    set({ isSubmitting: true, error: null })

    try {
      await updateFolderApi(id, payload)
      set({ isSubmitting: false })
      await get().fetchFolders()
    } catch (error) {
      set({
        isSubmitting: false,
        error: getErrorMessage(error, '更新词单失败'),
      })
    }
  },
  deleteFolder: async (id) => {
    set({ isSubmitting: true, error: null })

    try {
      await deleteFolderApi(id)
      set((state) => ({
        isSubmitting: false,
        // Its words went with it — keep the due pool from listing ghosts.
        dueReviews: state.dueReviews.filter((item) => item.word.folderId !== id),
      }))
      await get().fetchFolders()
    } catch (error) {
      set({
        isSubmitting: false,
        error: getErrorMessage(error, '删除词单失败'),
      })
    }
  },
  fetchTodayReviews: async () => {
    set({ isLoadingReviews: true, error: null })

    try {
      const result = await getTodayReviewsApi()
      set({
        dueReviews: Array.isArray(result.items) ? result.items : [],
        hasLoadedReviews: true,
        isLoadingReviews: false,
      })
    } catch (error) {
      set({
        isLoadingReviews: false,
        error: getErrorMessage(error, '加载今日复习失败'),
      })
    }
  },
  dropDueWords: (wordIds) => {
    const drop = new Set(wordIds)
    if (drop.size === 0) return
    set((state) => ({
      dueReviews: state.dueReviews.filter((item) => !drop.has(item.wordId)),
    }))
  },
  shuffleDueReviews: () =>
    // Fisher–Yates. Only lasts until the next fetch — that's intentional:
    // shuffling is a per-attempt mood-break, not a stored preference.
    set((state) => {
      const out = [...state.dueReviews]
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[out[i], out[j]] = [out[j], out[i]]
      }
      return { dueReviews: out }
    }),
  setSessionLimit: (limit) => {
    persistSessionLimit(limit)
    set({ sessionLimit: limit })
  },
  createWord: async (payload) => {
    set({ isSubmitting: true, error: null })

    try {
      await createWordApi(payload)
      set({ isSubmitting: false })
      await get().fetchFolders()
    } catch (error) {
      set({
        isSubmitting: false,
        error: getErrorMessage(error, '添加单词失败'),
      })
      throw error
    }
  },
  updateWord: async (id, payload) => {
    set({ isSubmitting: true, error: null })

    try {
      await updateWordApi(id, payload)
      set({ isSubmitting: false })
    } catch (error) {
      set({
        isSubmitting: false,
        error: getErrorMessage(error, '更新单词失败'),
      })
      throw error
    }
  },
  deleteWord: async (id) => {
    set({ isSubmitting: true, error: null })

    try {
      await deleteWordApi(id)
      set({ isSubmitting: false })
      await get().fetchFolders()
    } catch (error) {
      set({
        isSubmitting: false,
        error: getErrorMessage(error, '删除单词失败'),
      })
    }
  },
}))
