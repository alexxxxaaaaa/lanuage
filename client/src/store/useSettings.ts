import { create } from 'zustand'
import {
  fetchSettings,
  patchSettings,
  type ThemeChoice,
  type UserSettings,
} from '../api/settings'
import { toast } from '@heroui/react'
import { lookup, messages } from '../i18n'
import { useAuthStore } from './authStore'

/**
 * 设置页的偏好。服务端是唯一真相，localStorage 只是本机快照。
 *
 * 之所以两头都留一份：主题和界面语言必须在 React 首帧之前就定下来，等一个
 * 网络请求回来再决定的话，深色模式下每次刷新都会先闪一屏白的。所以启动时先
 * 用快照渲染，登录态就绪后再和服务端对账 —— 服务端存过就以服务端为准，
 * 从没存过（换了新账号 / 首次上线）就把本机这份推上去。
 */

const CACHE_KEY = 'word-sprint-settings'

/** 旧版按项分散存的键。只在快照缺失时读一次，让老用户的选择平滑迁移过来。 */
const LEGACY_KEYS = {
  theme: 'theme',
  uiLanguage: 'word-sprint-ui-language',
  examMode: 'word-sprint-exam-mode',
} as const

/** 和 server/src/services/settingsService.ts 的 DEFAULT_SETTINGS 保持一致。 */
export const DEFAULT_SETTINGS: UserSettings = {
  theme: '',
  uiLanguage: 'zh',
  examMode: 'strict',
  localDictEnabled: true,
}

const THEMES: readonly ThemeChoice[] = ['', 'light', 'dark']
const UI_LANGUAGES: readonly UserSettings['uiLanguage'][] = ['zh', 'en', 'jp']
const EXAM_MODES: readonly UserSettings['examMode'][] = ['strict', 'self']

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

/** localStorage 和接口返回都可能是任意形状，一律过一遍白名单再进 state。 */
function normalize(raw: Partial<Record<keyof UserSettings, unknown>>): UserSettings {
  return {
    theme: pick(raw.theme, THEMES, DEFAULT_SETTINGS.theme),
    uiLanguage: pick(raw.uiLanguage, UI_LANGUAGES, DEFAULT_SETTINGS.uiLanguage),
    examMode: pick(raw.examMode, EXAM_MODES, DEFAULT_SETTINGS.examMode),
    localDictEnabled:
      typeof raw.localDictEnabled === 'boolean'
        ? raw.localDictEnabled
        : DEFAULT_SETTINGS.localDictEnabled,
  }
}

function loadCache(): UserSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    if (raw) return normalize(JSON.parse(raw) as Record<string, unknown>)
    return normalize({
      theme: window.localStorage.getItem(LEGACY_KEYS.theme),
      uiLanguage: window.localStorage.getItem(LEGACY_KEYS.uiLanguage),
      examMode: window.localStorage.getItem(LEGACY_KEYS.examMode),
    })
  } catch {
    // 无痕模式 / 配额满 —— 本次会话用默认值，对账后仍会拿到账号里的设置。
    return DEFAULT_SETTINGS
  }
}

function saveCache(settings: UserSettings) {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(settings))
  } catch {
    /* 同上，写不进去不影响本次会话 */
  }
}

type SettingsState = {
  settings: UserSettings
  /** 和服务端对过账没有。设置页据此决定要不要禁用控件。 */
  isSynced: boolean
  /** 登录后拉一次：服务端存过就采纳，没存过就把本机这份推上去。 */
  sync: () => Promise<void>
  /** 立刻生效 + 落库；写失败就回滚，不让界面和账号里的值悄悄分叉。 */
  update: (patch: Partial<UserSettings>) => void
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: loadCache(),
  isSynced: false,
  sync: async () => {
    if (!useAuthStore.getState().token) return
    try {
      const { settings, saved } = await fetchSettings()
      if (saved) {
        const next = normalize(settings)
        saveCache(next)
        set({ settings: next, isSynced: true })
      } else {
        const local = get().settings
        set({ isSynced: true })
        await patchSettings(local)
      }
    } catch {
      // 拉不到就继续用本机快照，下次进应用再对账。
    }
  },
  update: (patch) => {
    const previous = get().settings
    const next = { ...previous, ...patch }
    saveCache(next)
    set({ settings: next })
    // 未登录时（登录页也能切主题）只落本机，否则 401 会把人踢去重新登录。
    if (!useAuthStore.getState().token) return
    void patchSettings(patch).catch(() => {
      saveCache(previous)
      set({ settings: previous })
      // 用回滚后的语言取文案 —— 失败的那次改动可能正是切界面语言。
      toast.danger(lookup(messages[previous.uiLanguage], 'settings.saveFailed'))
    })
  },
}))

// 多标签页同步：另一个标签改了设置，这里跟着变，不必刷新。
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== CACHE_KEY || !event.newValue) return
    try {
      useSettings.setState({
        settings: normalize(JSON.parse(event.newValue) as Record<string, unknown>),
      })
    } catch {
      /* 别人写坏了就当没看见 */
    }
  })
}
