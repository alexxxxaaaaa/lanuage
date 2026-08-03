import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Chip, ProgressBar, Skeleton, Tooltip } from '@heroui/react'
import { RotateCcw, Sparkles, Trash2 } from 'lucide-react'
import { SelectField } from '../components/ui/SelectField'
import { SourceSection } from '../components/ui/SourceSection'
import { alertDialog, confirm } from '../components/ui/dialog'
import { Link, useSearchParams } from 'react-router'
import { fillWordByAi } from '../api/ai'
import { getErrorMessage, isDuplicateWordError } from '../api/error'
import { createWord, getWords } from '../api/words'
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
  // Once an AI result arrives the result's detected language takes priority
  // over the EN/JP toggle the user originally clicked.
  const effectiveLanguage: 'en' | 'jp' = aiView?.language ?? targetLanguage
  const defaultWordFolderId =
    wordFolders.find((folder) => folder.language === effectiveLanguage)?.id ??
    wordFolders[0]?.id ??
    ''
  const [selectedWordFolderId, setSelectedWordFolderId] = useState('')

  // When a new AI result arrives, its detected language wins over the EN/JP
  // toggle, so JP results land in a JP word list even if the user left the
  // default EN toggle alone.
  const [folderPickedFor, setFolderPickedFor] = useState<AiDictView | null>(null)
  let pickedFromResult = false
  if (aiView && folderPickedFor !== aiView) {
    setFolderPickedFor(aiView)
    pickedFromResult = true
    const matching = wordFolders.find((f) => f.language === aiView.language)
    if (matching) setSelectedWordFolderId(matching.id)
  }
  // Otherwise keep the select pointed at something real — the chosen word list
  // can disappear while the page is open.
  //
  // Both guards are load-bearing. A setState *during render* re-runs the
  // component unconditionally — React skips the usual same-value bail-out for
  // render-phase updates — so this branch has to stop firing on its own or the
  // pass count hits React's limit and the whole page throws "Too many
  // re-renders" and unmounts to a blank screen. That is exactly what a reload
  // straight onto this route did: `folders` starts empty, so `.some()` was
  // always false and the branch re-armed itself every pass. With no folders
  // there is nothing to reconcile against, and re-selecting the value already
  // held is never worth a render.
  if (
    !pickedFromResult &&
    wordFolders.length > 0 &&
    selectedWordFolderId !== defaultWordFolderId &&
    !wordFolders.some((folder) => folder.id === selectedWordFolderId)
  ) {
    setSelectedWordFolderId(defaultWordFolderId)
  }

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

  const handleAddWord = async () => {
    if (!addSeed) return
    if (!selectedWordFolderId) {
      void alertDialog.warning({ title: t('wordSearch.pickFolder') })
      return
    }
    setIsSavingWord(true)
    try {
      await createWord({
        folderIds: [selectedWordFolderId],
        language: addSeed.language,
        word: addSeed.word,
        reading: addSeed.reading,
        partOfSpeech: addSeed.partOfSpeech,
        meaning: addSeed.meaning,
        example: addSeed.example,
        note: addSeed.note,
      })
      // 右侧索引里也要出现这个词（这里没走 useAppStore.createWord）。
      useWordIndex.getState().refresh()
      void alertDialog.success({ title: t('wordSearch.addedSuccess') })
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

  const hasQuery = q.trim().length > 0
  // 本地来源分块的显隐：设置开关 + 英语查词时本地词库帮不上忙（'en-zh' 只有
  // AI 行）。AI 小节不受这个开关影响，恒在。
  const showLocalBlock = localDictEnabled && targetLanguage !== 'en'

  return (
    <section className="page">
      <div className="section-header">
        <div>
          <h2>{t('wordSearch.title')}</h2>
          <p className="muted">{t('wordSearch.subtitle')}</p>
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
            <SourceSection
              title={t('wordSearch.dictTitle')}
              aside={
                showLocalBlock ? (
                  <span className="muted">
                    {t('wordSearch.matched', { count: localEntries.length })}
                  </span>
                ) : undefined
              }
            >
              <div className="grid gap-4">
                {showLocalBlock ? (
                  isSearchingLocal ? (
                    <div className="grid gap-2 py-1">
                      <Skeleton className="h-4 w-2/5 rounded-lg" />
                      <Skeleton className="h-3 w-4/5 rounded-lg" />
                      <Skeleton className="h-3 w-3/5 rounded-lg" />
                    </div>
                  ) : localEntries.length === 0 ? (
                    <p className="muted m-0">{t('wordSearch.dictEmpty')}</p>
                  ) : (
                    <DictEntryResults entries={localEntries} />
                  )
                ) : null}

                {/* AI 小节：固定在词典来源之后，是词典视图的一部分而不是独立模块。 */}
                <div
                  className={
                    showLocalBlock
                      ? 'grid gap-3 border-t border-border pt-3'
                      : 'grid gap-3'
                  }
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Chip size="sm" variant="soft" color="accent">
                      <Chip.Label>{t('wordSearch.sourceAi')}</Chip.Label>
                    </Chip>
                    {aiView ? (
                      <div className="flex items-center gap-1.5">
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
                    ) : null}
                  </div>

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

                  {aiView ? (
                    <div className="grid gap-3">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <strong className="text-[22px] text-foreground">{aiView.word}</strong>
                        <SpeakButton
                          text={aiView.word}
                          reading={aiView.reading}
                          lang={aiView.language}
                          size="md"
                        />
                        {aiView.reading ? (
                          <span className="muted text-[13px]">{aiView.reading}</span>
                        ) : null}
                        {aiView.partOfSpeech ? (
                          <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-bold text-accent">
                            {aiView.partOfSpeech}
                          </span>
                        ) : null}
                      </div>

                      {aiView.meaning ? (
                        <p className="m-0 text-[15px]/[1.7] whitespace-pre-wrap text-foreground">
                          {aiView.meaning}
                        </p>
                      ) : null}

                      {aiView.example ? (
                        <div className="grid gap-1 rounded-xl border border-border bg-foreground/2 px-3.5 py-3">
                          <span className="text-xs font-bold tracking-[0.06em] text-muted uppercase">
                            {t('wordSearch.example')}
                          </span>
                          <p className="m-0 leading-[1.7] whitespace-pre-wrap text-foreground">
                            {aiView.example}
                          </p>
                        </div>
                      ) : null}

                      {aiView.note ? (
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
                  ) : !isSearchingAi ? (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="muted m-0">{t('wordSearch.aiGenerateHint')}</p>
                      <Button
                        variant="primary"
                        size="sm"
                        type="button"
                        isPending={isSearchingAi}
                        onPress={() => void runAiLookup(q)}
                      >
                        <Sparkles className="size-3.5" aria-hidden />
                        {t('wordSearch.aiGenerate')}
                      </Button>
                    </div>
                  ) : null}
                </div>

                {/* 词头级「加入单词库」：整块词典（本地 + AI）共用一个入口。 */}
                {addSeed ? (
                  <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
                    <label className="session-inline min-w-[220px] flex-1">
                      <span className="muted">{t('wordSearch.saveTo')}</span>
                      <SelectField
                        value={selectedWordFolderId || undefined}
                        onChange={(v) => setSelectedWordFolderId(v ?? '')}
                        isDisabled={wordFolders.length === 0}
                        placeholder={
                          wordFolders.length === 0
                            ? t('wordSearch.noFolderOption')
                            : undefined
                        }
                        className="min-w-[180px]"
                        options={wordFolders
                          .filter((folder) => folder.language === effectiveLanguage)
                          .map((folder) => ({
                            value: folder.id,
                            label: `${folder.name}(${folder.language.toUpperCase()})`,
                          }))}
                      />
                    </label>
                    {wordFolders.length === 0 ? (
                      <Link className="button button--outline" to="/folders">
                        {t('wordSearch.createFolder')}
                      </Link>
                    ) : null}
                    <Button
                      type="button"
                      onPress={() => void handleAddWord()}
                      isDisabled={isSavingWord || wordFolders.length === 0}
                    >
                      {isSavingWord ? t('wordSearch.addingWord') : t('wordSearch.addWord')}
                    </Button>
                  </div>
                ) : null}
              </div>
            </SourceSection>
          ) : null}

          {hasQuery ? (
            <SourceSection
              title={t('wordSearch.myLibrary')}
              aside={
                <span className="muted">
                  {t('wordSearch.matched', { count: localMatches.length })}
                </span>
              }
            >
              {isSearchingLocal ? (
                <div className="grid gap-2 py-1">
                  <Skeleton className="h-4 w-2/5 rounded-lg" />
                  <Skeleton className="h-3 w-3/5 rounded-lg" />
                </div>
              ) : localMatches.length === 0 ? (
                <p className="muted">{t('wordSearch.emptyLocal')}</p>
              ) : (
                <div className="grid gap-2">
                  {localMatches.map((match) => (
                    <Link
                      key={match.id}
                      className="grid min-w-0 gap-1 rounded-[10px] border border-border bg-surface px-3 py-2.5 text-foreground no-underline transition-colors duration-150 hover:border-accent/30 hover:bg-accent/6"
                      to={`/folders/${match.folderIds[0] ?? ''}#word-${match.id}`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <strong>{match.word}</strong>
                        {match.reading ? (
                          <span className="muted text-[13px]">{match.reading}</span>
                        ) : null}
                        <span className="folder-language">
                          {match.folders?.[0]?.name ?? match.language.toUpperCase()}
                        </span>
                      </div>
                      {match.meaning ? (
                        <p className="muted m-0 text-[13px]">{match.meaning}</p>
                      ) : null}
                    </Link>
                  ))}
                </div>
              )}
            </SourceSection>
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
