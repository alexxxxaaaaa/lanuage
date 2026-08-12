import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { fillWordByAi } from '../api/ai'
import { clearAiDictEntry, fetchDictEntries, type DictEntriesResult, type DictEntry } from '../api/dict'
import { getErrorMessage } from '../api/error'
import { getWords } from '../api/words'
import { useI18n } from '../i18n'
import {
  AI_SOURCE,
  directionForLanguage,
  entryToAiView,
  fillResultToAiView,
  type AiDictView,
} from '../lib/aiDictEntry'
import { useJlptLevels, type JlptLevel } from '../lib/jlptVocab'
import { DIRECTION_META, type SearchDirection } from '../lib/searchDirection'
import type { Word } from '../types'

/**
 * 「查一个词」的全部数据：本地词库词条、我的单词库里那一条、AI 释义（读缓存 /
 * 生成 / 清除），以及标题区要显示的词头、读音、JLPT 级别。
 *
 * 查词页和文解析页共用。两边的差别只在外壳 —— 查词页有输入框、方向下拉和右侧
 * 索引栏，文解析页是点了解析结果里的某个词之后按辞書形查 —— 卡片里的内容和
 * 行为完全一样，所以那一份实现（尤其是「AI 缓存行 vs 刚生成」这套收敛）只该
 * 存在一次。
 *
 * 渲染部分见 components/WordLookupCard.tsx，词单增删也在那边（它是 UI：弹层、
 * 确认框、toast），本 hook 只留 replaceWord/removeWord 两个口子让它写回来。
 */

export type UseWordLookupOptions = {
  /** 要查的词。空串 = 不查，各字段回到初始态。 */
  term: string
  direction: SearchDirection
  /**
   * 生成 AI 释义时是否把日语活用形校准到辞書形。
   *
   * 查词页传 false：那边在结果里给辞書形建议，改不改由用户点，输入的词不背着
   * 人换掉。文解析页传进来的本来就是解析出的辞書形，同样不需要再校准。
   */
  normalize?: boolean
  /** 本地查询回来时的回调。查词页拿它做「纯汉字输入」的方向判定。 */
  onLoaded?: (result: DictEntriesResult) => void
}

export type WordLookup = {
  term: string
  direction: SearchDirection
  meta: (typeof DIRECTION_META)[SearchDirection]
  /** 本地查询（词典 + 我的单词库）在飞。 */
  isLoadingLocal: boolean
  isGeneratingAi: boolean
  /** 0 = 没在生成。假进度条，见 generateAi。 */
  aiProgress: number
  /** AI 生成失败的消息。下一次生成时清空。 */
  aiError: string | null
  /** 全方向的原始词条 —— 方向判定这类页面级逻辑要用。 */
  entries: DictEntry[]
  /** 当前方向、非 AI 来源的词条（词典区块渲染这些）。 */
  localEntries: DictEntry[]
  /** 当前方向的 AI 释义：刚生成的优先，否则用词条里带回的缓存行。 */
  aiView: AiDictView | null
  /** 输入是日语活用形时词库给出的辞書形建议，否则 null。 */
  baseForm: string | null
  /** 这个词头在我的单词库里对应的那一条。 */
  existingWord: Word | null
  /** 还没入库时，加词要用的播种内容。两者都为 null 就加不了词。 */
  addSeed: AiDictView | null
  /** 加词/建词单时用的语言口径。 */
  wordLanguage: 'en' | 'jp'
  headWord: string
  headReading: string
  /** 词头语言明确时才给发音，中→日 在 AI 出结果前是 null。 */
  speakLang: 'en' | 'jp' | null
  headLevels: readonly JlptLevel[]
  generateAi: (refresh?: boolean) => Promise<void>
  clearAi: () => Promise<void>
  /** 词单增删之后把新的 Word 写回来（新增或更新）。 */
  replaceWord: (word: Word) => void
  removeWord: (id: string) => void
}

export function useWordLookup({
  term,
  direction,
  normalize = false,
  onLoaded,
}: UseWordLookupOptions): WordLookup {
  const { t } = useI18n()
  const meta = DIRECTION_META[direction]

  const [entries, setEntries] = useState<DictEntry[]>([])
  const [baseForm, setBaseForm] = useState<string | null>(null)
  const [localMatches, setLocalMatches] = useState<Word[]>([])
  const [isLoadingLocal, setIsLoadingLocal] = useState(() => term.trim().length > 0)
  // fill-word 刚生成出来的 AI 释义。另一个来源（词条里带回的缓存行）是从 entries
  // 直接派生的，不进 state —— 两边都收敛成同一个平铺形状。连方向一起记：换了
  // 方向这份内容就不是当前这次查询的答案了。
  const [generated, setGenerated] = useState<{
    direction: SearchDirection
    view: AiDictView
  } | null>(null)
  const [isGeneratingAi, setIsGeneratingAi] = useState(false)
  const [aiProgress, setAiProgress] = useState(0)
  const [aiError, setAiError] = useState<string | null>(null)
  const aiTokenRef = useRef(0)

  // 换词是一次全新的查询：上一次的结果不能有任何一帧留在屏幕上，所以在渲染期
  // 就清掉，而不是等 effect 跑完。
  const query = term.trim()
  const [appliedTerm, setAppliedTerm] = useState(query)
  if (appliedTerm !== query) {
    setAppliedTerm(query)
    setEntries([])
    setBaseForm(null)
    setLocalMatches([])
    setGenerated(null)
    setAiError(null)
    setIsLoadingLocal(query.length > 0)
  }

  // 回调按 ref 走：调用方多半是行内箭头函数，进依赖数组会让每次渲染都重查。
  const onLoadedRef = useRef(onLoaded)
  useEffect(() => {
    onLoadedRef.current = onLoaded
  })

  useEffect(() => {
    if (!query) return
    let cancelled = false
    void (async () => {
      try {
        // 词典（本地来源 + AI 缓存行同表同查询）和「我的单词库」一起发，两个都是
        // 本地查询，串行没有意义。任一失败都不该让另一边的结果消失。词典不带
        // direction 全方向取回来，按方向的筛选在下面派生 —— 换方向就不必重新
        // 发请求，纯汉字的方向判定也正好吃这份结果。
        const [dict, mine] = await Promise.all([
          fetchDictEntries(query).catch(() => ({
            entries: [] as DictEntry[],
            baseForm: null,
          })),
          getWords({ q: query }).catch(() => [] as Word[]),
        ])
        if (cancelled) return
        setEntries(dict.entries)
        setBaseForm(dict.baseForm)
        setLocalMatches(mine ?? [])
        onLoadedRef.current?.(dict)
      } finally {
        if (!cancelled) setIsLoadingLocal(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [query])

  // 只看当前方向的词条：中日共用的词头（「保護」）在库里两个方向各有一条，
  // 不筛就会把另一边的读音和释义混进来。
  const directionEntries = useMemo(
    () => (meta.entry ? entries.filter((entry) => entry.direction === meta.entry) : []),
    [entries, meta.entry],
  )
  const localEntries = useMemo(
    () => directionEntries.filter((entry) => entry.source !== AI_SOURCE),
    [directionEntries],
  )
  const cachedAiView = useMemo(() => {
    const row = directionEntries.find((entry) => entry.source === AI_SOURCE)
    return row ? entryToAiView(row) : null
  }, [directionEntries])
  const aiView =
    (generated?.direction === direction ? generated.view : null) ?? cachedAiView

  const generateAi = useCallback(
    async (refresh = false) => {
      if (!query) return
      const { source, target } = meta
      // 取消令牌：两次生成赛跑时（慢的先发、快的后发），晚回来的旧结果会盖掉
      // 新的。令牌对不上就整个丢弃。
      const token = ++aiTokenRef.current
      setIsGeneratingAi(true)
      setAiProgress(8)
      setAiError(null)
      const timer = window.setInterval(() => {
        setAiProgress((current) => {
          if (current >= 88) return current
          const delta = current < 50 ? 6 : current < 75 ? 3 : 1
          return Math.min(88, current + delta)
        })
      }, 400)
      try {
        const word = await fillWordByAi({
          word: query,
          sourceLanguage: source,
          targetLanguage: target,
          refresh,
          normalize,
        })
        if (token !== aiTokenRef.current) return
        setGenerated({
          direction,
          view: fillResultToAiView({ ...word, language: word.language ?? target }),
        })
      } catch (error) {
        if (token !== aiTokenRef.current) return
        setAiError(getErrorMessage(error, t('wordSearch.lookupFailed')))
      } finally {
        window.clearInterval(timer)
        if (token === aiTokenRef.current) {
          setAiProgress(100)
          window.setTimeout(() => setAiProgress(0), 400)
          setIsGeneratingAi(false)
        }
      }
    },
    [query, meta, direction, normalize, t],
  )

  const clearAi = useCallback(async () => {
    if (!aiView) return
    const clearedDirection = directionForLanguage(aiView.language)
    await clearAiDictEntry(aiView.word, clearedDirection)
    setGenerated(null)
    // entries 里那份缓存行也一并掉，别让后续派生又把它捡回来。
    setEntries((prev) =>
      prev.filter(
        (entry) => !(entry.source === AI_SOURCE && entry.direction === clearedDirection),
      ),
    )
  }, [aiView])

  const replaceWord = useCallback((word: Word) => {
    setLocalMatches((prev) =>
      prev.some((match) => match.id === word.id)
        ? prev.map((match) => (match.id === word.id ? word : match))
        : [word, ...prev],
    )
  }, [])

  const removeWord = useCallback((id: string) => {
    setLocalMatches((prev) => prev.filter((match) => match.id !== id))
  }, [])

  // 这个词头在单词库里对应的那条 Word：词单标签、加词/移除都围绕它。AI 归一化
  // 词形和输入不一致的漏网场景仍由服务端 409 兜底。
  const existingWord = useMemo(() => {
    return (
      (aiView
        ? localMatches.find(
            (match) => match.word === aiView.word && match.language === aiView.language,
          )
        : undefined) ??
      localMatches.find((match) => match.word === query) ??
      null
    )
  }, [localMatches, aiView, query])

  // 标题区的词头/读音：AI 内容优先，其次单词库，再退到本地词典的精确词头，
  // 最后兜底显示查询词本身（此时可能还什么内容都没有）。
  const exactLocalEntry = useMemo(
    () => (query ? (localEntries.find((entry) => entry.word === query) ?? null) : null),
    [localEntries, query],
  )
  const headWord = aiView?.word ?? existingWord?.word ?? exactLocalEntry?.word ?? query
  const headReading =
    aiView?.reading ?? existingWord?.reading ?? exactLocalEntry?.reading ?? ''
  const speakLang: 'en' | 'jp' | null =
    aiView?.language ??
    (existingWord
      ? existingWord.language === 'jp'
        ? 'jp'
        : 'en'
      : meta.source === 'zh'
        ? null
        : meta.source)
  // 出題基準只收日语词，词头还没落到日语上（中→日 在 AI 出结果前）就不必查。
  const headLevels = useJlptLevels(speakLang === 'jp')(headWord)

  // 没有 AI 内容时的加词兜底：只有 日→中 的词头本身就是要入库的日语词（中→日
  // 的词头是中文，英→中 没有本地词条）。word/reading 取词典行，内容字段留空
  // —— 词典内容只读，永不复制进 Word，词卡上可再 AI 补全。
  const addSeed: AiDictView | null =
    aiView ??
    (direction === 'ja-zh' && exactLocalEntry
      ? {
          word: exactLocalEntry.word,
          language: 'jp',
          reading: exactLocalEntry.reading,
          partOfSpeech: '',
          meaning: '',
          example: '',
          note: '',
        }
      : null)

  const wordLanguage: 'en' | 'jp' =
    existingWord?.language === 'jp' || existingWord?.language === 'en'
      ? existingWord.language
      : (addSeed?.language ?? meta.target)

  return {
    term: query,
    direction,
    meta,
    isLoadingLocal,
    isGeneratingAi,
    aiProgress,
    aiError,
    entries,
    localEntries,
    aiView,
    baseForm,
    existingWord,
    addSeed,
    wordLanguage,
    headWord,
    headReading,
    speakLang,
    headLevels,
    generateAi,
    clearAi,
    replaceWord,
    removeWord,
  }
}
