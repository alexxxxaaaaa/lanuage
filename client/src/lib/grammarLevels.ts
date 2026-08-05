/**
 * 语法条目的级别。
 *
 * 比词表那五级多一个 CUSTOM（「自建」）：手工建的句型多半不对应 JLPT 里的某一
 * 级，新建表单默认就落在这一档，蓝宝书导进来的条目才带 N1-N5。
 *
 * 库里 level 是自由文本（服务端只做 trim），所以读出来一律先过 toGrammarLevel()
 * 归一 —— 认不出的值全算自建，既不会渲染出没有配色的裸标签，也让筛选器不至于
 * 因为一个手滑写进去的值多出一档。
 */
import { useCallback } from 'react'
import { useI18n } from '../i18n'
import { JLPT_LEVELS, type JlptLevel } from './jlptVocab'

export const CUSTOM_LEVEL = 'CUSTOM'

export type GrammarLevel = JlptLevel | typeof CUSTOM_LEVEL

/** 下拉框里的顺序：自建排头，它是新建条目的默认值。 */
export const GRAMMAR_LEVELS: readonly GrammarLevel[] = [CUSTOM_LEVEL, ...JLPT_LEVELS]

export function toGrammarLevel(level: string | undefined): GrammarLevel {
  return JLPT_LEVELS.find((candidate) => candidate === level) ?? CUSTOM_LEVEL
}

// 六种取值的单元素数组预先建好：<JlptChips /> 每次渲染拿到的是同一个引用。
const AS_ARRAY: Record<GrammarLevel, readonly GrammarLevel[]> = {
  CUSTOM: [CUSTOM_LEVEL],
  N1: ['N1'],
  N2: ['N2'],
  N3: ['N3'],
  N4: ['N4'],
  N5: ['N5'],
}

/** 单值 level 字段转成标签数组，喂给 <JlptChips />。 */
export function asGrammarLevels(level: string | undefined) {
  return AS_ARRAY[toGrammarLevel(level)]
}

/**
 * 级别的显示名。N1-N5 三种界面语言下都是这几个字母，只有自建要翻。
 */
export function useGrammarLevelLabel() {
  const { t } = useI18n()
  return useCallback(
    (level: GrammarLevel) => (level === CUSTOM_LEVEL ? t('grammar.levelCustom') : level),
    [t],
  )
}
