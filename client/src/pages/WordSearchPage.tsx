import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, ProgressBar, Spinner } from '@heroui/react'
import { SelectField } from '../components/ui/SelectField'
import { alertDialog } from '../components/ui/dialog'
import { Link, useSearchParams } from 'react-router'
import { fillWordByAi } from '../api/ai'
import { getErrorMessage, isDuplicateWordError } from '../api/error'
import { createWord, getWords } from '../api/words'
import { SearchSuggest, type SearchSuggestHandle } from '../components/SearchSuggest'
import { SpeakButton } from '../components/SpeakButton'
import { usePageActive } from '../components/layout/pageContext'
import { useI18n } from '../i18n'
import { useAppStore } from '../store/useAppStore'
import type { Word } from '../types'

type DictResult = {
  word: string
  language: 'en' | 'jp'
  reading: string
  partOfSpeech: string
  meaning: string
  example: string
  note: string
}

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
  const [wordResult, setWordResult] = useState<DictResult | null>(null)
  const [localMatches, setLocalMatches] = useState<Word[]>([])
  // A `?q=` already in the URL on mount means the effect below is about to run,
  // so start out in the searching state instead of flashing "no results".
  const [isSearchingLocal, setIsSearchingLocal] = useState(() => q.trim().length > 0)
  const [autoAiFiredFor, setAutoAiFiredFor] = useState('')

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
  const runAiLookup = async (rawText: string) => {
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
        // Legacy: kept so older code paths see a valid en/jp value.
        language: target,
      })
      if (token !== aiLookupTokenRef.current) return
      setWordResult({ ...word, language: word.language ?? target })
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
    setWordResult(null)
    setLocalMatches([])
    setIsSearchingLocal(q.trim().length > 0)
  }

  useEffect(() => {
    const trimmed = q.trim()
    if (!trimmed) return
    let cancelled = false
    void (async () => {
      try {
        const results = await getWords({ q: trimmed })
        if (cancelled) return
        const list = results ?? []
        setLocalMatches(list)
        // Fire AI auto-lookup only AFTER local search completes with zero
        // hits — keeping the two as separate useEffects had a race where the
        // AI fired before isSearchingLocal flipped to true on first render.
        if (list.length === 0 && autoAiFiredFor !== trimmed) {
          setAutoAiFiredFor(trimmed)
          // Pass `trimmed` (the URL q we just searched for) explicitly —
          // can't rely on the `keyword` state, see runAiLookup comment.
          void runAiLookup(trimmed)
        }
      } catch {
        if (!cancelled) setLocalMatches([])
      } finally {
        if (!cancelled) setIsSearchingLocal(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // runAiLookup / autoAiFiredFor are intentionally excluded — we re-fire on
    // q change only; same-q re-search is handled in submitKeyword.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  const wordFolders = useMemo(
    () => (Array.isArray(folders) ? folders : []),
    [folders],
  )
  // Once an AI result arrives the result's detected language takes priority
  // over the EN/JP toggle the user originally clicked.
  const effectiveLanguage: 'en' | 'jp' = wordResult?.language ?? targetLanguage
  const defaultWordFolderId =
    wordFolders.find((folder) => folder.language === effectiveLanguage)?.id ??
    wordFolders[0]?.id ??
    ''
  const [selectedWordFolderId, setSelectedWordFolderId] = useState('')

  // When a new AI result arrives, its detected language wins over the EN/JP
  // toggle, so JP results land in a JP word list even if the user left the
  // default EN toggle alone.
  const [folderPickedFor, setFolderPickedFor] = useState<DictResult | null>(null)
  let pickedFromResult = false
  if (wordResult && folderPickedFor !== wordResult) {
    setFolderPickedFor(wordResult)
    pickedFromResult = true
    const matching = wordFolders.find((f) => f.language === wordResult.language)
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
    if (text !== q) {
      // URL change will pick up via the auto-fire useEffect below, which
      // itself skips AI when the local library already has matches.
      setSearchParams({ q: text })
      return
    }
    // Same query as the URL — URL won't re-trigger the auto-fire effect, so
    // we handle the re-search manually here. Skip AI when the library
    // already has the word; no point burning tokens on something we have.
    if (localMatches.length > 0 || isSearchingLocal) return
    void runAiLookup(text)
  }

  // Auto-fire AI on q-change is folded into the local-search effect above (had
  // to combine them — running as two parallel useEffects raced on the initial
  // isSearchingLocal flip and burned AI calls even when the library had a
  // match), which is why runAiLookup is declared before it.

  const handleAddWord = async () => {
    if (!wordResult) return
    if (!selectedWordFolderId) {
      void alertDialog.warning({ title: t('wordSearch.pickFolder') })
      return
    }
    setIsSavingWord(true)
    try {
      await createWord({
        folderId: selectedWordFolderId,
        language: wordResult.language,
        word: wordResult.word,
        reading: wordResult.reading,
        partOfSpeech: wordResult.partOfSpeech,
        meaning: wordResult.meaning,
        example: wordResult.example,
        note: wordResult.note,
      })
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

  return (
    <section className="page">
      <div className="section-header">
        <div>
          <h2>{t('wordSearch.title')}</h2>
          <p className="muted">{t('wordSearch.subtitle')}</p>
        </div>
      </div>

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
        <article className="card">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="m-0 text-base">{t('wordSearch.myLibrary')}</h3>
            <span className="muted">{t('wordSearch.matched', { count: localMatches.length })}</span>
          </div>
          {isSearchingLocal ? (
            <div className="flex justify-center py-4">
              <Spinner size="sm" />
            </div>
          ) : localMatches.length === 0 ? (
            <p className="muted">{t('wordSearch.emptyLocal')}</p>
          ) : (
            <div className="grid gap-2">
              {localMatches.map((match) => (
                <Link
                  key={match.id}
                  className="no-underline"
                  to={`/folders/${match.folderId}#word-${match.id}`}
                >
                  <div className="grid gap-1 rounded-[10px] border border-border bg-surface px-3 py-2.5 text-foreground transition-colors duration-150 hover:border-accent/30 hover:bg-accent/6">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong>{match.word}</strong>
                      {match.reading ? (
                        <span className="muted text-[13px]">{match.reading}</span>
                      ) : null}
                      <span className="folder-language">
                        {match.folder?.name ?? match.language.toUpperCase()}
                      </span>
                    </div>
                    {match.meaning ? (
                      <p className="muted m-0 text-[13px]">{match.meaning}</p>
                    ) : null}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </article>
      ) : null}

      <article className="card">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="m-0 text-base">{t('wordSearch.aiTitle')}</h3>
          <Button variant="outline"
            type="button"
            onPress={() => void runAiLookup(activeTerm)}
            isDisabled={isSearchingAi || !activeTerm}
          >
            {isSearchingAi
              ? t('wordSearch.aiSearching')
              : wordResult
                ? t('wordSearch.aiReSearch')
                : t('wordSearch.aiAsk')}
          </Button>
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

        {isSearchingAi && !wordResult ? (
          <div className="flex justify-center py-4">
            <Spinner />
          </div>
        ) : null}

        {wordResult ? (
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <strong className="text-[22px] text-foreground">{wordResult.word}</strong>
              <SpeakButton text={wordResult.word} reading={wordResult.reading} lang={wordResult.language} size="md" />
              {wordResult.reading ? (
                <span className="muted text-[13px]">{wordResult.reading}</span>
              ) : null}
              {wordResult.partOfSpeech ? (
                <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-bold text-accent">{wordResult.partOfSpeech}</span>
              ) : null}
            </div>

            {wordResult.meaning ? (
              <p className="m-0 text-[15px]/[1.7] whitespace-pre-wrap text-foreground">{wordResult.meaning}</p>
            ) : null}

            {wordResult.example ? (
              <div className="grid gap-1 rounded-xl border border-border bg-foreground/2 px-3.5 py-3">
                <span className="text-xs font-bold tracking-[0.06em] text-muted uppercase">{t('wordSearch.example')}</span>
                <p className="m-0 leading-[1.7] whitespace-pre-wrap text-foreground">{wordResult.example}</p>
              </div>
            ) : null}

            {wordResult.note ? (
              <div className="grid gap-1 rounded-xl border border-border bg-foreground/2 px-3.5 py-3">
                <span className="text-xs font-bold tracking-[0.06em] text-muted uppercase">{t('wordSearch.note')}</span>
                <p className="m-0 leading-[1.7] whitespace-pre-wrap text-foreground">{wordResult.note}</p>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-2">
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
          </div>
        ) : !isSearchingAi ? (
          <p className="muted">
            {hasQuery ? t('wordSearch.aiHintWithQuery') : t('wordSearch.aiHintNoQuery')}
          </p>
        ) : null}
      </article>
    </section>
  )
}
