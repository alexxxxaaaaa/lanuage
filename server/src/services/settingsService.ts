import { prisma } from '../lib/prisma'
import { AppError } from '../errors/AppError'

/**
 * 设置页的偏好。都是小而封闭的枚举，所以逐字段白名单校验 ——
 * 客户端传来的任何多余键直接丢掉，写进库的值一定是这里列出的那几个。
 */
export type UserSettings = {
  /** 空串 = 跟随系统，由客户端解析成 light / dark。 */
  theme: '' | 'light' | 'dark'
  uiLanguage: 'zh' | 'en' | 'jp'
  examMode: 'strict' | 'self'
  localDictEnabled: boolean
}

/** 和 schema.prisma 里的列默认值一致 —— 缺行时返回它。 */
export const DEFAULT_SETTINGS: UserSettings = {
  theme: '',
  uiLanguage: 'zh',
  examMode: 'strict',
  localDictEnabled: true,
}

const THEMES = ['', 'light', 'dark'] as const
const UI_LANGUAGES = ['zh', 'en', 'jp'] as const
const EXAM_MODES = ['strict', 'self'] as const

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new AppError(`invalid ${field}`, 400)
  }
  return value as T
}

function toSettings(row: {
  theme: string
  uiLanguage: string
  examMode: string
  localDictEnabled: boolean
}): UserSettings {
  return {
    // 库里存的值理论上只可能是白名单内的，但老行 / 手改过的行不该让整个
    // 设置接口 500，读的时候一律回落到默认值。
    theme: THEMES.includes(row.theme as never)
      ? (row.theme as UserSettings['theme'])
      : DEFAULT_SETTINGS.theme,
    uiLanguage: UI_LANGUAGES.includes(row.uiLanguage as never)
      ? (row.uiLanguage as UserSettings['uiLanguage'])
      : DEFAULT_SETTINGS.uiLanguage,
    examMode: EXAM_MODES.includes(row.examMode as never)
      ? (row.examMode as UserSettings['examMode'])
      : DEFAULT_SETTINGS.examMode,
    localDictEnabled: row.localDictEnabled,
  }
}

/**
 * `saved` 区分「存过默认值」和「从没存过」：后者客户端会把本机 localStorage
 * 里的旧选择推上来，换机器登录才不会把偏好清成默认。
 */
export async function getSettings(userId: string) {
  const row = await prisma.userSettings.findUnique({ where: { userId } })
  return { settings: row ? toSettings(row) : DEFAULT_SETTINGS, saved: row !== null }
}

export async function updateSettings(userId: string, input: Record<string, unknown>) {
  const data: Partial<UserSettings> = {}
  if (input.theme !== undefined) data.theme = pickEnum(input.theme, THEMES, 'theme')
  if (input.uiLanguage !== undefined) {
    data.uiLanguage = pickEnum(input.uiLanguage, UI_LANGUAGES, 'uiLanguage')
  }
  if (input.examMode !== undefined) {
    data.examMode = pickEnum(input.examMode, EXAM_MODES, 'examMode')
  }
  if (input.localDictEnabled !== undefined) {
    if (typeof input.localDictEnabled !== 'boolean') {
      throw new AppError('invalid localDictEnabled', 400)
    }
    data.localDictEnabled = input.localDictEnabled
  }

  const row = await prisma.userSettings.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  })
  return toSettings(row)
}
