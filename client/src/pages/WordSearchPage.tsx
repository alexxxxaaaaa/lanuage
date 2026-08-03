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
import { Plus, RotateCcw, Sparkles, Trash2 } from 'lucide-react'
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
  languageForDirection,
  type AiDictView,
} from '../lib/aiDictEntry'
import { DictEntryResults } from '../components/DictEntryResults'
import { DictIndexPanel } from '../components/DictIndexPanel'
import { SearchSuggest, type SearchSuggestHandle } from '../components/SearchSuggest'
import { SpeakButton } from '../components/SpeakButton'
import { usePageActive } from '../components/layout/pageContext'
import { useI18n } from '../i18n'
import { useAppStore } from '../store/useAppStore'
import { useSettings } from '../store/useSettings'
import { useWordIndex } from '../store/useWordIndex'
import type { Word } from '../types'

type SourceOverride = 'auto' | 'zh' | 'jp' | 'en'

const CHINESE_TARGET_KEY = 'word-search-chinese-target'

function readStoredChineseTarget(): 'jp' | 'en' {
  if (typeof window === 'undefined') return 'jp'
  const v = window.localStorage.getItem(CHINESE_TARGET_KEY)
  return v === 'en' || v === 'jp' ? v : 'jp'
}

function detectFromChars(text: string): 'zh' | 'jp' | 'en' {
  // Kana presence is the only unambiguous Japanese signal — kanji is shared
  // with Chinese. Pure ASCII = English. Otherwise treat as Chinese; the user
  // can override via the picker if a kanji-only string is actually Japanese.
  if (/[぀-ヿㇰ-ㇿ]/.test(text)) return 'jp'
  if (/[一-龯]/.test(text)) return 'zh'
  if (/[a-zA-Z]/.test(text)) return 'en'
  return 'en'
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
  const [sourceOverride, setSourceOverride] = useState<SourceOverride>('auto')
  const [chineseTarget, setChineseTarget] = useState<'en' | 'jp'>(() =>
    readStoredChineseTarget(),
  )
  const [isSearchingAi, setIsSearchingAi] = useState(false)
  const [aiProgress, setAiProgress] = useState(0)
  const aiLookupTokenRef = useRef(0)
  const [isSavingWord, setIsSavingWord] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 词典区块 AI 小节的内容。两个来源：entries 里带回的缓存行（重搜秒出），
  // 或 fill-word 刚生成的响应 —— 两边都收敛成同一个平铺形状。
  const [aiView, setAiView] = useState<AiDictView | null>(null)
  const [localMatches, setLocalMatches] = useState<Word[]>([])
  const [dictEntries, setDictEntries] = useState<DictEntry[]>([])
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

  // Persist last chosen target language so the next zh search defaults to it.
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(CHINESE_TARGET_KEY, chineseTarget)
  }, [chineseTarget])

  // What the page is currently about: whatever is being typed, falling back to
  // the query the result on screen came from once the box has been cleared.
  const activeTerm = keyword.trim() || q.trim()
  const detectedSource = detectFromChars(activeTerm)
  const effectiveSource: 'zh' | 'jp' | 'en' =
    sourceOverride === 'auto' ? detectedSource : sourceOverride
  // The language the *saved* word ends up in:
  //   - zh source → translate target (jp/en)
  //   - jp/en source → same as source (definition mode)
  const targetLanguage: 'en' | 'jp' =
    effectiveSource === 'zh' ? chineseTarget : effectiveSource

  useEffect(() => {
    void useAppStore.getState().fetchFolders()
  }, [])

  // The text to look up is always passed in, never read from `keyword`: the
  // box is empty on page entry, and the q-change effect below calls this
  // before its own `setKeyword` has committed.
  const runAiLookup = async (rawText: string, refresh = false) => {
    const text = rawText.trim()
    if (!text) {
      setError(t('wordSearch.enterKeyword'))
      return
    }
    // Detect off that same text rather than off `effectiveSource`, for the
    // same reason — it is derived from state the caller can be ahead of.
    const source: 'zh' | 'jp' | 'en' =
      sourceOverride === 'auto' ? detectFromChars(text) : sourceOverride
    const target: 'en' | 'jp' = source === 'zh' ? chineseTarget : source
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
      })
      if (token !== aiLookupTokenRef.current) return
      setAiView(fillResultToAiView({ ...word, language: word.language ?? target }))
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
    setAiView(null)
    setLocalMatches([])
    setDictEntries([])
    setIsSearchingLocal(q.trim().length > 0)
  }

  useEffect(() => {
    const trimmed = q.trim()
    if (!trimmed) return
    let cancelled = false
    void (async () => {
      try {
        // 语种从 trimmed 现算，不读 effectiveSource —— 后者派生自 keyword，
        // 而这个 effect 是被 URL 的 q 触发的，两者可以差一帧。runAiLookup
        // 里也是同样的理由。
        const source = sourceOverride === 'auto' ? detectFromChars(trimmed) : sourceOverride
        const target = source === 'zh' ? chineseTarget : source

        // 词典（本地来源 + AI 缓存行同表同查询）和「我的单词库」一起发，
        // 两个都是本地查询，串行没有意义。任一失败都不该让另一边的结果消失。
        // 英语查词也发 —— 'en-zh' 方向只有 AI 缓存行，正是要它。
        const [dict, mine] = await Promise.all([
          fetchDictEntries(trimmed).catch(() => [] as DictEntry[]),
          getWords({ q: trimmed }).catch(() => [] as Word[]),
        ])
        if (cancelled) return
        setDictEntries(dict)
        setLocalMatches(mine ?? [])
        // entries 里带回的 AI 缓存行直接喂给 AI 小节 —— 重搜已生成过的词
        // 零 token 秒出。两个方向都有缓存时按目标语言优先。
        const aiEntries = dict.filter((entry) => entry.source === AI_SOURCE)
        const preferred =
          aiEntries.find((entry) => languageForDirection(entry.direction) === target) ??
          aiEntries[0] ??
          null
        setAiView(preferred ? entryToAiView(preferred) : null)
      } finally {
        if (!cancelled) setIsSearchingLocal(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // Re-fire on q change only; same-q re-search is handled in submitKeyword.
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
    try {
      await clearAiDictEntry(cleared.word, directionForLanguage(cleared.language))
      setAiView(null)
      // dictEntries 里那份缓存行也一并掉，别让后续派生又把它捡回来。
      setDictEntries((prev) => prev.filter((entry) => entry.source !== AI_SOURCE))
    } catch (clearError) {
      void alertDialog.error({
        title: t('wordSearch.aiClearFailed'),
        content: getErrorMessage(clearError, t('wordSearch.tryLater')),
      })
    }
  }

  /**
   * 从右侧索引点词：回填输入框并按该方向取词条。
   *
   * 走 setSearchParams 和回车是同一条路，所以 URL 里始终留着当前查的词，
   * 刷新和分享链接都还原得回来。索引里的词一定在词库里，不会触发 AI。
   */
  const handlePickFromIndex = (row: { word: string }) => {
    setKeyword(row.word)
    setError(null)
    if (row.word !== q) setSearchParams({ q: row.word })
  }

  // 词典区块的本地来源分块（AI 行单独渲染，不进 DictEntryResults）。
  const localEntries = useMemo(
    () => dictEntries.filter((entry) => entry.source !== AI_SOURCE),
    [dictEntries],
  )
  // 没有 AI 内容时的加词兜底：仅限日语词且本地词库有这个词头 —— word/reading
  // 取词典行，内容字段留空（词典内容只读，永不复制进 Word，词卡上可再 AI 补全）。
  const jaLocalEntry = useMemo(() => {
    const term = q.trim()
    if (!term) return null
    return (
      localEntries.find(
        (entry) => entry.direction === 'ja-zh' && entry.word === term,
      ) ?? null
    )
  }, [localEntries, q])

  // 「加入单词库」播种源：优先 AI 内容，其次本地词库的词头（内容留空）。
  const addSeed: AiDictView | null =
    aiView ??
    (targetLanguage === 'jp' && jaLocalEntry
      ? {
          word: jaLocalEntry.word,
          language: 'jp',
          reading: jaLocalEntry.reading,
          partOfSpeech: '',
          meaning: '',
          example: '',
          note: '',
        }
      : null)

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
  // 发音只在词头语言明确时给：中文查询在 AI 出结果前词头还是中文，不该念。
  const speakLang: 'en' | 'jp' | null =
    aiView?.language ??
    (existingWord
      ? existingWord.language === 'jp'
        ? 'jp'
        : 'en'
      : exactLocalEntry?.direction === 'ja-zh'
        ? 'jp'
        : effectiveSource !== 'zh'
          ? effectiveSource
          : null)

  // 词单标签行的数据。语言口径：已入库的词跟它自己，否则跟播种内容/目标语言。
  const wordLanguage: 'en' | 'jp' =
    existingWord?.language === 'jp' || existingWord?.language === 'en'
      ? existingWord.language
      : (addSeed?.language ?? targetLanguage)
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
  // 本地来源分块的显隐：设置开关 + 英语查词时本地词库帮不上忙（'en-zh' 只有
  // AI 行）。AI 小节不受这个开关影响，恒在。
  const showLocalBlock = localDictEnabled && targetLanguage !== 'en'

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
              <label className="lang-picker" title="覆盖自动检测的输入语言">
                <span className="muted">输入</span>
                <SelectField
                  value={sourceOverride}
                  onChange={(v) => setSourceOverride(v)}
                  className="min-w-[140px]"
                  options={[
                    {
                      value: 'auto',
                      label: `自动 (${detectedSource === 'zh' ? '中文' : detectedSource === 'jp' ? '日语' : '英语'})`,
                    },
                    { value: 'zh', label: '中文' },
                    { value: 'jp', label: '日语' },
                    { value: 'en', label: '英语' },
                  ]}
                />
              </label>
              {effectiveSource === 'zh' ? (
                <label className="lang-picker" title="把这个中文词翻译成…">
                  <span className="muted">查</span>
                  <SelectField
                    value={chineseTarget}
                    onChange={(v) => setChineseTarget(v)}
                    className="min-w-[90px]"
                    options={[
                      { value: 'jp', label: '日语' },
                      { value: 'en', label: '英语' },
                    ]}
                  />
                </label>
              ) : null}
              <Button type="button" onPress={() => submitKeyword()}>
                {t('wordSearch.search')}
              </Button>
            </div>
            {error ? <p className="error-text m-0">{error}</p> : null}
          </div>

          {hasQuery ? (
            <article className="card grid gap-3">
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
                  本地词库开启时右侧标出本地 / AI 哪边有内容（和右侧索引同款）。 */}
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
                {showLocalBlock && (localEntries.length > 0 || aiView) ? (
                  <span className="ml-auto flex items-center gap-1.5">
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

        <DictIndexPanel
          query={activeTerm}
          language={targetLanguage}
          onPick={handlePickFromIndex}
        />
      </div>
    </section>
  )
}
