import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  Checkbox,
  CheckboxGroup,
  Chip,
  Input,
  Popover,
  ProgressBar,
  Skeleton,
  Tag,
  TagGroup,
  Tooltip,
  toast,
} from '@heroui/react'
import { Lightbulb, Plus, RotateCcw, Sparkles, Trash2 } from 'lucide-react'
import { SelectField } from '../components/ui/SelectField'
import { alertDialog, confirm } from '../components/ui/dialog'
import { useSearchParams } from 'react-router'
import { fillWordByAi } from '../api/ai'
import { getErrorMessage, isDuplicateWordError } from '../api/error'
import { createWord, deleteWord, getWords, updateWord } from '../api/words'
import { clearAiDictEntry, fetchDictEntries, type DictEntry } from '../api/dict'
import {
  AI_SOURCE,
  directionForLanguage,
  entryToAiView,
  fillResultToAiView,
  type AiDictView,
} from '../lib/aiDictEntry'
import type { IndexRow } from '../lib/dictIndex'
import { useJlptLevels } from '../lib/jlptVocab'
import {
  DIRECTION_LABEL,
  DIRECTION_META,
  DIRECTIONS,
  detectDirection,
  resolveByDict,
  type DirectionChoice,
  type SearchDirection,
} from '../lib/searchDirection'
import { DictEntryResults } from '../components/DictEntryResults'
import { DictIndexPanel } from '../components/DictIndexPanel'
import { JlptChips } from '../components/JlptChips'
import { SearchSuggest, type SearchSuggestHandle } from '../components/SearchSuggest'
import { SpeakButton } from '../components/SpeakButton'
import { usePageActive } from '../components/layout/pageContext'
import { useI18n } from '../i18n'
import { useAppStore } from '../store/useAppStore'
import { useSettings } from '../store/useSettings'
import { useWordIndex } from '../store/useWordIndex'
import type { Word } from '../types'

const DIRECTION_KEY = 'word-search-direction'

function readStoredChoice(): DirectionChoice {
  if (typeof window === 'undefined') return 'auto'
  const stored = window.localStorage.getItem(DIRECTION_KEY)
  return stored === 'auto' || DIRECTIONS.some((direction) => direction === stored)
    ? (stored as DirectionChoice)
    : 'auto'
}

export function WordSearchPage() {
  const { t } = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const q = searchParams.get('q') ?? ''
  const folders = useAppStore((state) => state.folders)
  const localDictEnabled = useSettings((state) => state.settings.localDictEnabled)
  // Deliberately empty even when the URL already carries a `?q=` — the box is
  // for the *next* search; the current one is what the results below show.
  const [keyword, setKeyword] = useState('')
  const [choice, setChoice] = useState<DirectionChoice>(readStoredChoice)
  // 「自动」当前落在哪个方向。纯汉字输入字符层面判不出来（中日共用），这时保持
  // 不动，等这次查询的词典结果回来再定 —— 所以它是 state，不是纯派生。
  const [autoDirection, setAutoDirection] = useState<SearchDirection>('zh-ja')
  const [isSearchingAi, setIsSearchingAi] = useState(false)
  const [aiProgress, setAiProgress] = useState(0)
  const aiLookupTokenRef = useRef(0)
  const [isSavingWord, setIsSavingWord] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // fill-word 刚生成出来的 AI 释义。另一个来源（entries 里带回的缓存行）是从
  // dictEntries 直接派生的，不进 state —— 两边都收敛成同一个平铺形状。
  // 连方向一起记：换了方向这份内容就不是当前这次查询的答案了。
  const [generated, setGenerated] = useState<{
    direction: SearchDirection
    view: AiDictView
  } | null>(null)
  const [localMatches, setLocalMatches] = useState<Word[]>([])
  const [dictEntries, setDictEntries] = useState<DictEntry[]>([])
  // 输入是日语活用形时，词库给出的辞書形。只是个建议：这一次查询照用户输入的
  // 原样执行，换不换词由用户点结果区第一行那条提示。
  const [baseForm, setBaseForm] = useState<string | null>(null)
  // A `?q=` already in the URL on mount means the effect below is about to run,
  // so start out in the searching state instead of flashing "no results".
  const [isSearchingLocal, setIsSearchingLocal] = useState(() => q.trim().length > 0)

  // Arriving on the page — first mount, or coming back from another one — hands
  // over an empty box with the cursor already in it, so clicking the sidebar
  // entry is enough to start typing. What is below stays put: the last lookup
  // is still there to read. Cleared during render rather than in the effect so
  // the incoming frame is already empty, same as the `?q=` reset further down.
  const searchRef = useRef<SearchSuggestHandle>(null)
  const isActive = usePageActive()
  const [wasActive, setWasActive] = useState(isActive)
  if (wasActive !== isActive) {
    setWasActive(isActive)
    if (isActive) setKeyword('')
  }
  useEffect(() => {
    if (isActive) searchRef.current?.focus()
  }, [isActive])

  // 下拉选的方向记住，下次进页面还是它。
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(DIRECTION_KEY, choice)
  }, [choice])

  // What the page is currently about: whatever is being typed, falling back to
  // the query the result on screen came from once the box has been cleared.
  const activeTerm = keyword.trim() || q.trim()

  // 右侧索引栏定位用的词：查的是活用形时停在辞書形那一行 —— 索引里根本没有
  // 「食べました」这一行，不换就会落到毫无关系的位置。定位不改变查的是什么，
  // 所以这里可以直接用建议值；输入框已经在敲别的词时仍跟着输入走。
  const indexTerm = baseForm && activeTerm === q.trim() ? baseForm : activeTerm

  // 字符层面能定方向的输入（假名 / 拉丁字母）当场就定，纯汉字返回 null ——
  // 那时保持上一次的方向不动，等 q 的词典结果回来用词库判（见下面的 effect）。
  // 放在渲染期同步而不是 effect 里：effect 改 state 要多跑一帧，索引栏会先按
  // 旧方向渲染一次再跳。初值是空串而不是 activeTerm，好让带着 `?q=` 直接进
  // 页面（刷新、分享链接）的第一帧也走一遍判定。
  const [syncedTerm, setSyncedTerm] = useState('')
  if (syncedTerm !== activeTerm) {
    setSyncedTerm(activeTerm)
    const detected = detectDirection(activeTerm)
    if (detected && detected !== autoDirection) setAutoDirection(detected)
  }

  const direction: SearchDirection = choice === 'auto' ? autoDirection : choice
  const meta = DIRECTION_META[direction]

  useEffect(() => {
    void useAppStore.getState().fetchFolders()
  }, [])

  // The text to look up is always passed in, never read from `keyword`: the
  // box is empty on page entry.
  const runAiLookup = async (rawText: string, refresh = false) => {
    const text = rawText.trim()
    if (!text) {
      setError(t('wordSearch.enterKeyword'))
      return
    }
    // 方向就用屏幕上这一次查询已经定下来的那个：调用点全是用户在当前这一帧
    // 按下的按钮，不存在比 state 更新的输入。
    const { source, target } = meta
    // Cancellation token: when two AI lookups race (slow first, fast second),
    // the late-resolving stale call would otherwise overwrite the newer result.
    // We bump the ref and ignore results whose token no longer matches.
    const token = ++aiLookupTokenRef.current
    setIsSearchingAi(true)
    setAiProgress(8)
    setError(null)
    const progressTimer = window.setInterval(() => {
      setAiProgress((current) => {
        if (current >= 88) return current
        const delta = current < 50 ? 6 : current < 75 ? 3 : 1
        return Math.min(88, current + delta)
      })
    }, 400)
    try {
      const word = await fillWordByAi({
        word: text,
        sourceLanguage: source,
        targetLanguage: target,
        refresh,
        // 查的就是屏幕上这个词。活用形不背着人换成辞書形 —— 那条路由上面的
        // 建议行走，用户点了才换。
        normalize: false,
      })
      if (token !== aiLookupTokenRef.current) return
      setGenerated({
        direction,
        view: fillResultToAiView({ ...word, language: word.language ?? target }),
      })
    } catch (searchError) {
      if (token !== aiLookupTokenRef.current) return
      setError(getErrorMessage(searchError, t('wordSearch.lookupFailed')))
    } finally {
      window.clearInterval(progressTimer)
      if (token === aiLookupTokenRef.current) {
        setAiProgress(100)
        window.setTimeout(() => setAiProgress(0), 400)
        setIsSearchingAi(false)
      }
    }
  }

  // A new `?q=` is a fresh search: mirror it into the box and drop the previous
  // round's results. Done during render rather than in an effect so the stale
  // result never gets a frame on screen.
  const [appliedQuery, setAppliedQuery] = useState(q)
  if (appliedQuery !== q) {
    setAppliedQuery(q)
    setKeyword(q)
    setGenerated(null)
    setLocalMatches([])
    setDictEntries([])
    setBaseForm(null)
    setIsSearchingLocal(q.trim().length > 0)
  }

  useEffect(() => {
    const trimmed = q.trim()
    if (!trimmed) return
    let cancelled = false
    void (async () => {
      try {
        // 词典（本地来源 + AI 缓存行同表同查询）和「我的单词库」一起发，
        // 两个都是本地查询，串行没有意义。任一失败都不该让另一边的结果消失。
        // 词典不带 direction 全方向取回来，按方向的筛选在下面派生 —— 换方向
        // 就不必重新发请求，纯汉字的方向判定也正好吃这份结果。
        const [dict, mine] = await Promise.all([
          fetchDictEntries(trimmed).catch(() => ({
            entries: [] as DictEntry[],
            baseForm: null,
          })),
          getWords({ q: trimmed }).catch(() => [] as Word[]),
        ])
        if (cancelled) return
        setDictEntries(dict.entries)
        setBaseForm(dict.baseForm)
        setLocalMatches(mine ?? [])
        // 纯汉字 + 自动：到这一步才判得了方向 —— 日语词库收了这个词头就按
        // 日语词看，没收就当中文词翻成日语。用户显式选过方向就不插手。
        if (choice === 'auto' && detectDirection(trimmed) === null) {
          setAutoDirection(resolveByDict(trimmed, dict.entries))
        }
      } finally {
        if (!cancelled) setIsSearchingLocal(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // q 变才重查（同 q 重搜由 submitKeyword 处理）；方向变只影响下面的派生筛选，
    // 手上这份 dictEntries 已经是全方向的了，不必再发一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  const wordFolders = useMemo(
    () => (Array.isArray(folders) ? folders : []),
    [folders],
  )

  /** The one submit path: Enter in the box, a picked suggestion, the button. */
  const submitKeyword = (raw: string = keyword) => {
    const text = raw.trim()
    if (!text) {
      setError(t('wordSearch.enterKeyword'))
      return
    }
    setError(null)
    setKeyword(text)
    // Same query as the URL — results are already on screen; AI is now
    // button-driven, so there is nothing to re-fire here.
    if (text !== q) setSearchParams({ q: text })
  }

  /** 「清除」：删掉这个词的 AI 缓存行，按钮退回「生成 AI 释义」。 */
  const handleClearAi = async () => {
    if (!aiView) return
    const ok = await confirm({
      title: t('wordSearch.aiClearConfirm'),
      status: 'warning',
    })
    if (!ok) return
    const cleared = aiView
    const clearedDirection = directionForLanguage(cleared.language)
    try {
      await clearAiDictEntry(cleared.word, clearedDirection)
      setGenerated(null)
      // dictEntries 里那份缓存行也一并掉，别让后续派生又把它捡回来。
      setDictEntries((prev) =>
        prev.filter(
          (entry) =>
            !(entry.source === AI_SOURCE && entry.direction === clearedDirection),
        ),
      )
    } catch (clearError) {
      void alertDialog.error({
        title: t('wordSearch.aiClearFailed'),
        content: getErrorMessage(clearError, t('wordSearch.tryLater')),
      })
    }
  }

  /**
   * 从右侧索引点词：回填输入框并按当前方向查这个词。
   *
   * 顺手把方向从「自动」定死成索引当前翻的这一本 —— 索引里这一行属于哪个方向
   * 是确定的，再交给自动判定重猜一遍，「保護」这种中日共有的词就会跑到另一个
   * 方向去。走 setSearchParams 和回车是同一条路，所以 URL 里始终留着当前查的
   * 词，刷新和分享链接都还原得回来。
   */
  const handlePickFromIndex = (row: IndexRow) => {
    setChoice(direction)
    setKeyword(row.word)
    setError(null)
    if (row.word !== q) setSearchParams({ q: row.word })
  }

  // 只看当前方向的词条：中日共用的词头（「保護」）在库里两个方向各有一条，
  // 不筛就会把另一边的读音和释义混进来。
  const directionEntries = useMemo(
    () => (meta.entry ? dictEntries.filter((entry) => entry.direction === meta.entry) : []),
    [dictEntries, meta.entry],
  )
  // 词典区块的本地来源分块（AI 行单独渲染，不进 DictEntryResults）。
  const localEntries = useMemo(
    () => directionEntries.filter((entry) => entry.source !== AI_SOURCE),
    [directionEntries],
  )
  // AI 小节：刚生成的优先，否则用 entries 带回的缓存行 —— 重搜已生成过的词
  // 零 token 秒出。两者都跟着方向走，换方向自然换内容。
  const cachedAiView = useMemo(() => {
    const row = directionEntries.find((entry) => entry.source === AI_SOURCE)
    return row ? entryToAiView(row) : null
  }, [directionEntries])
  const aiView =
    (generated?.direction === direction ? generated.view : null) ?? cachedAiView
  // 这个词头在单词库里对应的那条 Word：词单标签、加词/移除都围绕它。
  // localMatches 来自 q-effect 的同一次查询，不用多发请求；AI 归一化词形
  // 和输入不一致的漏网场景仍由服务端 409 兜底。
  const existingWord = useMemo(() => {
    const term = q.trim()
    return (
      (aiView
        ? localMatches.find(
            (match) => match.word === aiView.word && match.language === aiView.language,
          )
        : undefined) ??
      localMatches.find((match) => match.word === term) ??
      null
    )
  }, [localMatches, aiView, q])

  // 标题区的词头/读音：AI 内容优先，其次单词库，再退到本地词典的精确词头，
  // 最后兜底显示查询词本身（此时可能还什么内容都没有）。
  const exactLocalEntry = useMemo(() => {
    const term = q.trim()
    if (!term) return null
    return localEntries.find((entry) => entry.word === term) ?? null
  }, [localEntries, q])
  const headWord = aiView?.word ?? existingWord?.word ?? exactLocalEntry?.word ?? q.trim()
  const headReading =
    aiView?.reading ?? existingWord?.reading ?? exactLocalEntry?.reading ?? ''
  // 发音只在词头语言明确时给：中→日 / 中→英 在 AI 出结果前词头还是中文，不该念。
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

  // 没有 AI 内容时的加词兜底：只有 日→中 的词头本身就是要入库的日语词
  //（中→日 的词头是中文，英→中 没有本地词条）。word/reading 取词典行，内容
  // 字段留空 —— 词典内容只读，永不复制进 Word，词卡上可再 AI 补全。
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

  // 词单标签行的数据。语言口径：已入库的词跟它自己，否则跟播种内容/目标语言。
  const wordLanguage: 'en' | 'jp' =
    existingWord?.language === 'jp' || existingWord?.language === 'en'
      ? existingWord.language
      : (addSeed?.language ?? meta.target)
  const currentFolders = useMemo(() => {
    if (!existingWord) return []
    const byId = new Map(wordFolders.map((folder) => [folder.id, folder]))
    return existingWord.folderIds.flatMap((id) => {
      const folder = byId.get(id) ?? existingWord.folders?.find((item) => item.id === id)
      return folder ? [{ id, name: folder.name }] : []
    })
  }, [existingWord, wordFolders])
  const availableFolders = useMemo(
    () =>
      wordFolders.filter(
        (folder) =>
          folder.language === wordLanguage &&
          !existingWord?.folderIds.includes(folder.id),
      ),
    [wordFolders, wordLanguage, existingWord],
  )

  // 「+ 添加到词单」弹层：多选未加入的词单，也可以现场新建一个同语言词单。
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [pickedFolderIds, setPickedFolderIds] = useState<string[]>([])
  const [newFolderName, setNewFolderName] = useState('')

  const handleAddOpenChange = (open: boolean) => {
    setIsAddOpen(open)
    if (open) {
      setPickedFolderIds([])
      setNewFolderName('')
    }
  }

  const handleAddToFolders = async () => {
    const name = newFolderName.trim()
    if (pickedFolderIds.length === 0 && !name) return
    setIsSavingWord(true)
    try {
      const folderIds = [...pickedFolderIds]
      if (name) {
        const folder = await useAppStore
          .getState()
          .createFolder({ name, language: wordLanguage })
        if (!folder) throw new Error(t('wordSearch.addFailed'))
        folderIds.push(folder.id)
      }
      if (existingWord) {
        const updated = await updateWord(existingWord.id, {
          folderIds: [...new Set([...existingWord.folderIds, ...folderIds])],
        })
        setLocalMatches((prev) =>
          prev.map((match) => (match.id === updated.id ? updated : match)),
        )
      } else if (addSeed) {
        const saved = await createWord({
          folderIds,
          language: addSeed.language,
          word: addSeed.word,
          reading: addSeed.reading,
          partOfSpeech: addSeed.partOfSpeech,
          meaning: addSeed.meaning,
          example: addSeed.example,
          note: addSeed.note,
        })
        setLocalMatches((prev) => [saved, ...prev.filter((m) => m.id !== saved.id)])
      }
      // 右侧索引和词单卡片的计数都要跟上（这里没走 useAppStore.createWord）。
      useWordIndex.getState().refresh()
      void useAppStore.getState().fetchFolders()
      toast.success(t('wordSearch.addedSuccess'))
      setIsAddOpen(false)
    } catch (saveError) {
      if (isDuplicateWordError(saveError)) {
        void alertDialog.warning({ title: t('wordSearch.duplicate') })
      } else {
        void alertDialog.error({
          title: t('wordSearch.addFailed'),
          content: getErrorMessage(saveError, t('wordSearch.tryLater')),
        })
      }
    } finally {
      setIsSavingWord(false)
    }
  }

  /**
   * 点掉一个词单标签。服务端要求词至少留在一个词单里，所以移除最后一个
   * 标签等于把词从单词库删掉（连复习进度），这一步要用户确认。词单被移空
   * 时顺手删掉词单本身 —— 词单是词的标签，空标签没有存在的意义。
   */
  const handleRemoveFolder = async (folderId: string) => {
    if (!existingWord || isSavingWord) return
    const isLast = existingWord.folderIds.length <= 1
    if (isLast) {
      const ok = await confirm({
        title: t('wordSearch.removeLastTitle'),
        content: t('wordSearch.removeLastContent', { word: existingWord.word }),
        status: 'warning',
      })
      if (!ok) return
    }
    setIsSavingWord(true)
    try {
      if (isLast) {
        await deleteWord(existingWord.id)
        setLocalMatches((prev) => prev.filter((match) => match.id !== existingWord.id))
      } else {
        const updated = await updateWord(existingWord.id, {
          folderIds: existingWord.folderIds.filter((id) => id !== folderId),
        })
        setLocalMatches((prev) =>
          prev.map((match) => (match.id === updated.id ? updated : match)),
        )
      }
      useWordIndex.getState().refresh()
      toast.success(t('wordSearch.removedSuccess'))
      const rest = await getWords({ folderId }).catch(() => null)
      if (rest && rest.length === 0) {
        await useAppStore.getState().deleteFolder(folderId)
      } else {
        void useAppStore.getState().fetchFolders()
      }
    } catch (removeError) {
      void alertDialog.error({
        title: t('wordSearch.removeFailed'),
        content: getErrorMessage(removeError, t('wordSearch.tryLater')),
      })
    } finally {
      setIsSavingWord(false)
    }
  }

  const hasQuery = q.trim().length > 0
  // 本地来源分块的显隐：设置开关 + 这个方向本地词库有没有收（英语那两个方向
  // 只有 AI 行）。AI 小节不受这个开关影响，恒在。
  const showLocalBlock = localDictEnabled && meta.hasLocalDict
  // 词单标签行右侧的来源标记：这个词有哪几种释义。JLPT 级别是词本身的属性，
  // 不是一回事，所以分成两组、隔开一段距离摆。
  const hasSourceTags = showLocalBlock && (localEntries.length > 0 || Boolean(aiView))

  // 方向下拉。「自动」把当前判出来的方向写在标签里，省得用户去猜它选了哪边。
  const directionOptions = useMemo(
    () => [
      {
        value: 'auto' as DirectionChoice,
        label: t('wordSearch.dirAuto', { dir: t(DIRECTION_LABEL[autoDirection]) }),
      },
      ...DIRECTIONS.map((each) => ({
        value: each as DirectionChoice,
        label: t(DIRECTION_LABEL[each]),
      })),
    ],
    [t, autoDirection],
  )

  return (
    <section className="page">
      <div className="section-header">
        <div>
          <h2>{t('wordSearch.title')}</h2>
          <p className="muted">
            {localDictEnabled
              ? t('wordSearch.subtitle')
              : t('wordSearch.subtitleAiOnly')}
          </p>
        </div>
      </div>

      <div className="flex items-start gap-5">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="card grid gap-2.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <SearchSuggest
                ref={searchRef}
                value={keyword}
                onChange={setKeyword}
                onSubmit={submitKeyword}
                placeholder={t('wordSearch.placeholder')}
                inputClassName="w-full rounded-xl border border-border bg-surface px-3.5 py-3 text-[15px] text-foreground focus:border-accent focus:ring-3 focus:ring-accent/15 focus:outline-none"
                className="min-w-[200px] flex-[1_1_240px] max-[720px]:basis-full"
              />
              <SelectField
                aria-label={t('wordSearch.directionLabel')}
                value={choice}
                onChange={setChoice}
                className="min-w-[160px] shrink-0"
                options={directionOptions}
              />
              <Button type="button" onPress={() => submitKeyword()}>
                {t('wordSearch.search')}
              </Button>
            </div>
            {error ? <p className="error-text m-0">{error}</p> : null}
          </div>

          {hasQuery ? (
            <article className="card grid gap-3">
              {/* 辞書形建议：输入是活用形时摆在整张卡最上面。只提示不改写 ——
                  点了才把输入框和这次查询一起换成辞書形，故意查活用形的人
                  照样查得到。 */}
              {baseForm ? (
                <button
                  type="button"
                  onClick={() => submitKeyword(baseForm)}
                  className="flex w-full items-center gap-2 rounded-xl border border-dashed border-accent/40 bg-accent/5 px-3 py-2 text-left text-[13px] text-muted transition-colors hover:bg-accent/10"
                >
                  <Lightbulb className="size-3.5 shrink-0 text-accent" aria-hidden />
                  <span className="min-w-0 flex-1">
                    {t('wordSearch.baseFormSuggest', {
                      input: q.trim(),
                      base: baseForm,
                    })}
                  </span>
                  <span className="shrink-0 font-medium text-accent">
                    {t('wordSearch.baseFormSwitch')}
                  </span>
                </button>
              ) : null}

              {/* 标题区：词头 + 发音 + 读音就是这张卡的标题；
                  没生成过 AI 释义时，生成按钮放右上角。 */}
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                  <h3 className="m-0 text-2xl/tight font-bold text-foreground">
                    {headWord}
                  </h3>
                  {speakLang ? (
                    <SpeakButton
                      text={headWord}
                      reading={headReading}
                      lang={speakLang}
                      size="md"
                    />
                  ) : null}
                  {headReading ? (
                    <span className="muted text-sm">{headReading}</span>
                  ) : null}
                </div>
                {!aiView && !isSearchingAi ? (
                  <Button
                    variant="primary"
                    size="sm"
                    type="button"
                    onPress={() => void runAiLookup(q)}
                  >
                    <Sparkles className="size-3.5" aria-hidden />
                    {t('wordSearch.aiGenerate')}
                  </Button>
                ) : null}
              </div>

              {/* 词单标签行：已在的词单可点叉移除，末尾是「+ 添加到词单」；
                  右侧先标出本地 / AI 哪边有内容（和右侧索引同款），再隔开一段
                  距离挂这个词的 JLPT 级别。 */}
              <div className="flex flex-wrap items-center gap-1.5">
                {currentFolders.length > 0 ? (
                  <TagGroup
                    aria-label={t('wordSearch.inFolders')}
                    size="sm"
                    onRemove={(keys) => void handleRemoveFolder(String([...keys][0]))}
                  >
                    <TagGroup.List items={currentFolders} className="gap-1.5">
                      {(folder) => (
                        <Tag key={folder.id} id={folder.id} textValue={folder.name}>
                          {folder.name}
                        </Tag>
                      )}
                    </TagGroup.List>
                  </TagGroup>
                ) : null}
                {existingWord || addSeed ? (
                  <Popover isOpen={isAddOpen} onOpenChange={handleAddOpenChange}>
                    <Button
                      size="sm"
                      variant="ghost"
                      type="button"
                      className="h-7 min-h-7 gap-1 rounded-full border border-dashed border-border px-2.5 text-xs font-normal text-muted"
                    >
                      <Plus className="size-3.5" aria-hidden />
                      {t('wordSearch.addWord')}
                    </Button>
                    <Popover.Content className="w-72">
                      <Popover.Dialog className="grid gap-3">
                        <Popover.Heading className="m-0 text-sm font-semibold">
                          {t('wordSearch.addWord')}
                        </Popover.Heading>
                        {availableFolders.length > 0 ? (
                          <CheckboxGroup
                            aria-label={t('wordSearch.addWord')}
                            value={pickedFolderIds}
                            onChange={setPickedFolderIds}
                            className="max-h-56 gap-2 overflow-y-auto"
                          >
                            {availableFolders.map((folder) => (
                              <Checkbox key={folder.id} value={folder.id}>
                                <Checkbox.Content>
                                  <Checkbox.Control>
                                    <Checkbox.Indicator />
                                  </Checkbox.Control>
                                  <span className="truncate">{folder.name}</span>
                                </Checkbox.Content>
                              </Checkbox>
                            ))}
                          </CheckboxGroup>
                        ) : (
                          <p className="muted m-0 text-[13px]">
                            {t('wordSearch.noFolderOption')}
                          </p>
                        )}
                        <Input
                          value={newFolderName}
                          onChange={(event) => setNewFolderName(event.target.value)}
                          placeholder={t('wordSearch.newFolderPlaceholder')}
                        />
                        <Button
                          size="sm"
                          type="button"
                          isPending={isSavingWord}
                          isDisabled={
                            pickedFolderIds.length === 0 && !newFolderName.trim()
                          }
                          onPress={() => void handleAddToFolders()}
                        >
                          {t('wordSearch.confirmAdd')}
                        </Button>
                      </Popover.Dialog>
                    </Popover.Content>
                  </Popover>
                ) : null}
                {hasSourceTags || headLevels.length > 0 ? (
                  <span className="ml-auto flex items-center gap-4">
                    {hasSourceTags ? (
                      <span className="flex items-center gap-1.5">
                        {localEntries.length > 0 ? (
                          <Chip size="sm" variant="soft">
                            <Chip.Label>{t('wordSearch.tagLocal')}</Chip.Label>
                          </Chip>
                        ) : null}
                        {aiView ? (
                          <Chip size="sm" color="accent" variant="soft">
                            <Chip.Label>{t('wordSearch.tagAi')}</Chip.Label>
                          </Chip>
                        ) : null}
                      </span>
                    ) : null}
                    <JlptChips levels={headLevels} />
                  </span>
                ) : null}
              </div>

              {/* AI 释义：排在其他来源上面。没生成时整块不出现（按钮在右上角）。 */}
              {aiView || isSearchingAi || aiProgress > 0 ? (
                <div className="grid gap-3 border-t border-border pt-3">
                  {aiView ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip size="sm" variant="soft" color="accent">
                        <Chip.Label>{t('wordSearch.sourceAi')}</Chip.Label>
                      </Chip>
                      {aiView.partOfSpeech ? (
                        <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-bold text-accent">
                          {aiView.partOfSpeech}
                        </span>
                      ) : null}
                      <div className="ml-auto flex items-center gap-1.5">
                        <Button
                          variant="secondary"
                          size="sm"
                          type="button"
                          isPending={isSearchingAi}
                          onPress={() => void runAiLookup(q, true)}
                        >
                          <RotateCcw className="size-3.5" aria-hidden />
                          {t('wordSearch.regenerate')}
                        </Button>
                        <Tooltip delay={0}>
                          <Button
                            isIconOnly
                            variant="ghost"
                            size="sm"
                            type="button"
                            aria-label={t('wordSearch.aiClear')}
                            isDisabled={isSearchingAi}
                            onPress={() => void handleClearAi()}
                          >
                            <Trash2 className="size-3.5" aria-hidden />
                          </Button>
                          <Tooltip.Content>{t('wordSearch.aiClear')}</Tooltip.Content>
                        </Tooltip>
                      </div>
                    </div>
                  ) : null}

                  {isSearchingAi || aiProgress > 0 ? (
                    <ProgressBar
                      aria-label={t('wordSearch.aiSearching')}
                      color={isSearchingAi ? 'accent' : 'success'}
                      size="sm"
                      value={aiProgress}
                    >
                      <ProgressBar.Track>
                        <ProgressBar.Fill />
                      </ProgressBar.Track>
                    </ProgressBar>
                  ) : null}

                  {aiView?.meaning ? (
                    <p className="m-0 text-[15px]/[1.7] whitespace-pre-wrap text-foreground">
                      {aiView.meaning}
                    </p>
                  ) : null}

                  {aiView?.example ? (
                    <div className="grid gap-1 rounded-xl border border-border bg-foreground/2 px-3.5 py-3">
                      <span className="text-xs font-bold tracking-[0.06em] text-muted uppercase">
                        {t('wordSearch.example')}
                      </span>
                      <p className="m-0 leading-[1.7] whitespace-pre-wrap text-foreground">
                        {aiView.example}
                      </p>
                    </div>
                  ) : null}

                  {aiView?.note ? (
                    <div className="grid gap-1 rounded-xl border border-border bg-foreground/2 px-3.5 py-3">
                      <span className="text-xs font-bold tracking-[0.06em] text-muted uppercase">
                        {t('wordSearch.note')}
                      </span>
                      <p className="m-0 leading-[1.7] whitespace-pre-wrap text-foreground">
                        {aiView.note}
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* 其他来源：本地词库的词典条目，排在 AI 释义后面。 */}
              {showLocalBlock ? (
                <div className="grid gap-4 border-t border-border pt-3">
                  {isSearchingLocal ? (
                    <div className="grid gap-2 py-1">
                      <Skeleton className="h-4 w-2/5 rounded-lg" />
                      <Skeleton className="h-3 w-4/5 rounded-lg" />
                      <Skeleton className="h-3 w-3/5 rounded-lg" />
                    </div>
                  ) : localEntries.length === 0 ? (
                    <p className="muted m-0">{t('wordSearch.dictEmpty')}</p>
                  ) : (
                    <DictEntryResults entries={localEntries} />
                  )}
                </div>
              ) : null}
            </article>
          ) : null}

        </div>

        {/* 中→英 没有中英词头表可翻，整条侧栏就不占地方了。 */}
        {meta.index ? (
          <DictIndexPanel
            kind={meta.index}
            query={indexTerm}
            onPick={handlePickFromIndex}
          />
        ) : null}
      </div>
    </section>
  )
}
