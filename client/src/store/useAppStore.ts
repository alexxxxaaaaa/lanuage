import { create } from 'zustand'
import { getErrorMessage } from '../api/error'
import {
  createFolder as createFolderApi,
  deleteFolder as deleteFolderApi,
  getFolderById as getFolderByIdApi,
  getFolders as getFoldersApi,
  updateFolder as updateFolderApi,
} from '../api/folders'
import {
  getTodayReviews as getTodayReviewsApi,
  submitReviewResult,
} from '../api/review'
import {
  createWord as createWordApi,
  deleteWord as deleteWordApi,
  getWords as getWordsApi,
  updateWord as updateWordApi,
} from '../api/words'
import type {
  CreateFolderPayload,
  CreateWordPayload,
  Folder,
  FolderDetail,
  ReviewItem,
  ReviewRating,
  UpdateFolderPayload,
  UpdateWordPayload,
  Word,
} from '../types'

type AppState = {
  folders: Folder[]
  currentFolder: FolderDetail | null
  dueReviews: ReviewItem[]
  todayReviews: ReviewItem[]
  totalReviewCount: number
  sessionLimit: number | null
  /** 复习时筛选的分类；null 表示全部 */
  reviewFolderId: string | null
  searchedWords: Word[]
  searchKeyword: string
  currentIndex: number
  isCardFlipped: boolean
  isLoadingFolders: boolean
  isLoadingFolder: boolean
  isLoadingReviews: boolean
  isSubmitting: boolean
  error: string | null
  fetchFolders: () => Promise<void>
  fetchFolderById: (id: string) => Promise<void>
  createFolder: (payload: CreateFolderPayload) => Promise<Folder | null>
  updateFolder: (id: string, payload: UpdateFolderPayload) => Promise<void>
  deleteFolder: (id: string) => Promise<void>
  fetchTodayReviews: () => Promise<void>
  searchWords: (keyword: string) => Promise<void>
  clearWordSearch: () => void
  setReviewFolderId: (folderId: string | null) => void
  setSessionLimit: (limit: number | null) => void
  startReviewSession: (limit?: number | null) => void
  createWord: (payload: CreateWordPayload) => Promise<void>
  updateWord: (id: string, payload: UpdateWordPayload) => Promise<void>
  deleteWord: (id: string) => Promise<void>
  submitReview: (rating: ReviewRating) => Promise<void>
  toggleCard: () => void
  resetReviewSession: () => void
  goToNextReview: () => void
  setReviewIndex: (index: number) => void
  clearError: () => void
  clearCurrentFolder: () => void
}

const SESSION_LIMIT_KEY = 'word-sprint-session-limit'
const REVIEW_FOLDER_KEY = 'word-sprint-review-folder-id'

function loadSessionLimit(): number | null {
  if (typeof window === 'undefined') return 20
  try {
    const raw = window.localStorage.getItem(SESSION_LIMIT_KEY)
    if (raw === null) return 20
    if (raw === 'null') return null
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 20
  } catch {
    return 20
  }
}

function loadReviewFolderId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(REVIEW_FOLDER_KEY)
    if (raw === null || raw === '' || raw === 'null') return null
    return raw
  } catch {
    return null
  }
}

function persistReviewFolderId(folderId: string | null) {
  if (typeof window === 'undefined') return
  try {
    if (folderId === null) {
      window.localStorage.removeItem(REVIEW_FOLDER_KEY)
    } else {
      window.localStorage.setItem(REVIEW_FOLDER_KEY, folderId)
    }
  } catch {
    // ignore
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
    // ignore
  }
}

function slicePool(pool: ReviewItem[], limit: number | null) {
  if (limit === null) return [...pool]
  return pool.slice(0, limit)
}

function filterReviewsByFolder(items: ReviewItem[], folderId: string | null) {
  if (!folderId) return items
  return items.filter((item) => item.word.folderId === folderId)
}

export const useAppStore = create<AppState>((set, get) => ({
  folders: [],
  currentFolder: null,
  dueReviews: [],
  todayReviews: [],
  totalReviewCount: 0,
  sessionLimit: loadSessionLimit(),
  reviewFolderId: loadReviewFolderId(),
  searchedWords: [],
  searchKeyword: '',
  currentIndex: 0,
  isCardFlipped: false,
  isLoadingFolders: false,
  isLoadingFolder: false,
  isLoadingReviews: false,
  isSubmitting: false,
  error: null,
  clearError: () => set({ error: null }),
  clearCurrentFolder: () => set({ currentFolder: null }),
  toggleCard: () => {
    set((state) => ({
      isCardFlipped: !state.isCardFlipped,
    }))
  },
  resetReviewSession: () =>
    set({
      currentIndex: 0,
      isCardFlipped: false,
    }),
  goToNextReview: () =>
    set((state) => {
      const max = state.todayReviews.length - 1
      if (max <= 0) return state
      return {
        currentIndex: Math.min(state.currentIndex + 1, max),
        isCardFlipped: false,
      }
    }),
  setReviewIndex: (index) =>
    set((state) => {
      const max = state.todayReviews.length - 1
      const safeIndex = Math.max(0, Math.min(index, Math.max(0, max)))
      return { currentIndex: safeIndex, isCardFlipped: false }
    }),
  fetchFolders: async () => {
    set({ isLoadingFolders: true, error: null })

    try {
      const response = await getFoldersApi()
      const folders = Array.isArray(response) ? response : []

      set({ folders, isLoadingFolders: false })
    } catch (error) {
      set({
        isLoadingFolders: false,
        error: getErrorMessage(error, '加载分类失败'),
      })
    }
  },
  fetchFolderById: async (id) => {
    set({ isLoadingFolder: true, error: null })

    try {
      const folder = await getFolderByIdApi(id)
      set({ currentFolder: folder, isLoadingFolder: false })
    } catch (error) {
      set({
        isLoadingFolder: false,
        error: getErrorMessage(error, '加载分类详情失败'),
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
        error: getErrorMessage(error, '创建分类失败'),
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
      if (get().currentFolder?.id === id) {
        await get().fetchFolderById(id)
      }
    } catch (error) {
      set({
        isSubmitting: false,
        error: getErrorMessage(error, '更新分类失败'),
      })
    }
  },
  deleteFolder: async (id) => {
    set({ isSubmitting: true, error: null })

    try {
      await deleteFolderApi(id)
      set({ isSubmitting: false })
      if (get().currentFolder?.id === id) {
        set({ currentFolder: null })
      }
      if (get().reviewFolderId === id) {
        persistReviewFolderId(null)
        set({ reviewFolderId: null })
      }
      await get().fetchFolders()
    } catch (error) {
      set({
        isSubmitting: false,
        error: getErrorMessage(error, '删除分类失败'),
      })
    }
  },
  fetchTodayReviews: async () => {
    set({ isLoadingReviews: true, error: null })

    try {
      const folderId = get().reviewFolderId
      const result = await getTodayReviewsApi()
      const allDueItems = Array.isArray(result.items) ? result.items : []
      const sessionItems = filterReviewsByFolder(allDueItems, folderId)

      set({
        dueReviews: allDueItems,
        todayReviews: sessionItems,
        totalReviewCount: sessionItems.length,
        currentIndex: 0,
        isCardFlipped: false,
        isLoadingReviews: false,
      })
    } catch (error) {
      set({
        isLoadingReviews: false,
        error: getErrorMessage(error, '加载今日复习失败'),
      })
    }
  },
  searchWords: async (keyword) => {
    const normalized = keyword.trim()
    set({ isLoadingReviews: true, error: null, searchKeyword: normalized })
    try {
      const words = await getWordsApi(normalized ? { q: normalized } : undefined)
      const safeWords = Array.isArray(words) ? words : []
      set({
        searchedWords: safeWords,
        isLoadingReviews: false,
      })
    } catch (error) {
      set({
        isLoadingReviews: false,
        error: getErrorMessage(error, '搜索单词失败'),
      })
    }
  },
  clearWordSearch: () => set({ searchedWords: [], searchKeyword: '' }),
  setReviewFolderId: (folderId) => {
    persistReviewFolderId(folderId)
    set({ reviewFolderId: folderId })
  },
  setSessionLimit: (limit) => {
    persistSessionLimit(limit)
    set({ sessionLimit: limit })
  },
  startReviewSession: (limit) => {
    const nextLimit = limit === undefined ? get().sessionLimit : limit
    if (limit !== undefined) {
      persistSessionLimit(limit)
    }
    const pool = get().dueReviews
    const session = slicePool(pool, nextLimit)

    set({
      sessionLimit: nextLimit,
      todayReviews: session,
      totalReviewCount: session.length,
      currentIndex: 0,
      isCardFlipped: false,
    })
  },
  createWord: async (payload) => {
    set({ isSubmitting: true, error: null })

    try {
      await createWordApi(payload)

      set({ isSubmitting: false })
      await get().fetchFolders()
      if (get().currentFolder?.id === payload.folderId) {
        await get().fetchFolderById(payload.folderId)
      }
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
      const folderId = get().currentFolder?.id
      if (folderId) {
        await get().fetchFolderById(folderId)
      }
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
      const folderId = get().currentFolder?.id
      if (folderId) {
        await get().fetchFolderById(folderId)
      }
      await get().fetchFolders()
    } catch (error) {
      set({
        isSubmitting: false,
        error: getErrorMessage(error, '删除单词失败'),
      })
    }
  },
  submitReview: async (rating) => {
    const currentItem = get().todayReviews[get().currentIndex]

    if (!currentItem) {
      return
    }

    set({ isSubmitting: true, error: null })

    try {
      await submitReviewResult({
        wordId: currentItem.wordId,
        rating,
      })

      set((state) => {
        const nextItems = state.todayReviews.filter(
          (item) => item.wordId !== currentItem.wordId,
        )
        const nextDue = state.dueReviews.filter(
          (item) => item.wordId !== currentItem.wordId,
        )

        return {
          todayReviews: nextItems,
          dueReviews: nextDue,
          currentIndex:
            nextItems.length === 0 ? 0 : Math.min(state.currentIndex, nextItems.length - 1),
          isCardFlipped: false,
          isSubmitting: false,
        }
      })
    } catch (error) {
      set({
        isSubmitting: false,
        error: getErrorMessage(error, '更新复习结果失败'),
      })
    }
  },
}))
