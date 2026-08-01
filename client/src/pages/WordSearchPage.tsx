import { useEffect, useMemo, useRef, useState } from 'react'
import { Modal, Progress, Select, Spin } from 'antd'
import { Link, useSearchParams } from 'react-router'
import { fillWordByAi } from '../api/ai'
import { getErrorMessage, isDuplicateWordError } from '../api/error'
import { createWord, getWords } from '../api/words'
import { SearchSuggest } from '../components/SearchSuggest'
import { SpeakButton } from '../components/SpeakButton'
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
  const [keyword, setKeyword] = useState(q)
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
  const [isSearchingLocal, setIsSearchingLocal] = useState(false)
  const [autoAiFiredFor, setAutoAiFiredFor] = useState('')

  // Persist last chosen target language so the next zh search defaults to it.
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(CHINESE_TARGET_KEY, chineseTarget)
  }, [chineseTarget])

  // Detected source language from chars, plus the active source after override.
  const detectedSource = useMemo(() => detectFromChars(keyword), [keyword])
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

  useEffect(() => {
    setKeyword(q)
    setWordResult(null)
  }, [q])

  useEffect(() => {
    const trimmed = q.trim()
    if (!trimmed) {
      setLocalMatches([])
      setIsSearchingLocal(false)
      return
    }
    let cancelled = false
    setIsSearchingLocal(true)
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

  useEffect(() => {
    setSelectedWordFolderId((current) =>
      wordFolders.some((folder) => folder.id === current) ? current : defaultWordFolderId,
    )
  }, [wordFolders, defaultWordFolderId])

  // When a new AI result arrives with a detected language that differs from
  // the current selection, switch to a matching folder so JP results land in
  // a JP folder even if the user kept the default EN toggle.
  useEffect(() => {
    if (!wordResult) return
    const matching = wordFolders.find((f) => f.language === wordResult.language)
    if (matching) {
      setSelectedWordFolderId(matching.id)
    }
  }, [wordResult, wordFolders])

  const submitKeyword = () => {
    const text = keyword.trim()
    if (!text) {
      setError(t('wordSearch.enterKeyword'))
      return
    }
    setError(null)
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

  // Takes the search text explicitly. Reading from `keyword` state via closure
  // was buggy: when this is called from the q-change useEffect, setKeyword(q)
  // and runAiLookup() fire in the same render cycle — the setState hasn't
  // committed yet, so `keyword` is still the previous render's value (often
  // empty on fresh mount), and the AI call ends up firing for the wrong text.
  const runAiLookup = async (rawText?: string) => {
    const text = (rawText ?? keyword).trim()
    if (!text) {
      setError(t('wordSearch.enterKeyword'))
      return
    }
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
        sourceLanguage: effectiveSource,
        targetLanguage,
        // Legacy: kept so older code paths see a valid en/jp value.
        language: targetLanguage,
      })
      if (token !== aiLookupTokenRef.current) return
      setWordResult({ ...word, language: word.language ?? targetLanguage })
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

  // Auto-fire AI on q-change is now folded into the local-search effect above
  // (had to combine them — running as two parallel useEffects raced on the
  // initial isSearchingLocal flip and burned AI calls even when the library
  // had a match).

  const handleAddWord = async () => {
    if (!wordResult) return
    if (!selectedWordFolderId) {
      Modal.warning({ title: t('wordSearch.pickFolder') })
      return
    }
    setIsSavingWord(true)
    try {
      await createWord({
        folderId: selectedWordFolderId,
        language: wordResult.language ?? targetLanguage,
        word: wordResult.word,
        reading: wordResult.reading,
        partOfSpeech: wordResult.partOfSpeech,
        meaning: wordResult.meaning,
        example: wordResult.example,
        note: wordResult.note,
      })
      Modal.success({ title: t('wordSearch.addedSuccess') })
    } catch (saveError) {
      if (isDuplicateWordError(saveError)) {
        Modal.warning({ title: t('wordSearch.duplicate') })
      } else {
        Modal.error({
          title: t('wordSearch.addFailed'),
          content: getErrorMessage(saveError, t('wordSearch.tryLater')),
        })
      }
    } finally {
      setIsSavingWord(false)
    }
  }

  const hasQuery = q.trim().length > 0
  const hasAiSection = isSearchingAi || wordResult

  return (
    <section className="page">
      <div className="section-header">
        <div>
          <p className="eyebrow">Search</p>
          <h2>{t('wordSearch.title')}</h2>
          <p className="muted">{t('wordSearch.subtitle')}</p>
        </div>
      </div>

      <div className="card dict-search-card">
        <div className="dict-search-row">
          <SearchSuggest
            value={keyword}
            onChange={setKeyword}
            onSubmit={(text) => {
              setKeyword(text)
              if (text !== q) {
                setSearchParams({ q: text })
              } else if (localMatches.length === 0 && !isSearchingLocal) {
                // Same q, no local hit — fire AI manually.
                void runAiLookup(text)
              }
            }}
            placeholder={t('wordSearch.placeholder')}
            inputClassName="dict-search-input"
            className="dict-search-suggest"
          />
          <label className="lang-picker" title="覆盖自动检测的输入语言">
            <span className="muted">输入</span>
            <Select
              value={sourceOverride}
              onChange={(v) => setSourceOverride(v)}
              style={{ minWidth: 140 }}
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
              <Select
                value={chineseTarget}
                onChange={(v) => setChineseTarget(v)}
                style={{ minWidth: 90 }}
                options={[
                  { value: 'jp', label: '日语' },
                  { value: 'en', label: '英语' },
                ]}
              />
            </label>
          ) : null}
          <button type="button" className="primary-button" onClick={submitKeyword}>
            {t('wordSearch.search')}
          </button>
        </div>
        {error ? <p className="error-text dict-search-error">{error}</p> : null}
      </div>

      {hasQuery ? (
        <article className="card">
          <div className="dict-section-header">
            <h3>{t('wordSearch.myLibrary')}</h3>
            <span className="muted">{t('wordSearch.matched', { count: localMatches.length })}</span>
          </div>
          {isSearchingLocal ? (
            <div className="dict-loading">
              <Spin size="small" />
            </div>
          ) : localMatches.length === 0 ? (
            <p className="muted">{t('wordSearch.emptyLocal')}</p>
          ) : (
            <div className="dict-match-list">
              {localMatches.map((match) => (
                <Link
                  key={match.id}
                  className="local-match-link"
                  to={`/folders/${match.folderId}#word-${match.id}`}
                >
                  <div className="local-match-row">
                    <div className="local-match-head">
                      <strong>{match.word}</strong>
                      {match.reading ? (
                        <span className="muted dict-reading">{match.reading}</span>
                      ) : null}
                      <span className="folder-language">
                        {match.folder?.name ?? match.language.toUpperCase()}
                      </span>
                    </div>
                    {match.meaning ? (
                      <p className="muted local-match-meaning">{match.meaning}</p>
                    ) : null}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </article>
      ) : null}

      <article className="card">
        <div className="dict-section-header">
          <h3>{t('wordSearch.aiTitle')}</h3>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void runAiLookup(keyword)}
            disabled={isSearchingAi || !keyword.trim()}
          >
            {isSearchingAi
              ? t('wordSearch.aiSearching')
              : wordResult
                ? t('wordSearch.aiReSearch')
                : t('wordSearch.aiAsk')}
          </button>
        </div>

        {isSearchingAi || aiProgress > 0 ? (
          <Progress
            percent={aiProgress}
            size="small"
            showInfo={false}
            status={isSearchingAi ? 'active' : 'success'}
          />
        ) : null}

        {isSearchingAi && !wordResult ? (
          <div className="dict-loading">
            <Spin />
          </div>
        ) : null}

        {wordResult ? (
          <div className="dict-result">
            <div className="dict-word-row">
              <strong className="dict-word">{wordResult.word}</strong>
              <SpeakButton text={wordResult.word} reading={wordResult.reading} lang={targetLanguage} size="md" />
              {wordResult.reading ? (
                <span className="muted dict-reading">{wordResult.reading}</span>
              ) : null}
              {wordResult.partOfSpeech ? (
                <span className="dict-pos-pill">{wordResult.partOfSpeech}</span>
              ) : null}
            </div>

            {wordResult.meaning ? (
              <p className="dict-meaning">{wordResult.meaning}</p>
            ) : null}

            {wordResult.example ? (
              <div className="dict-example-block">
                <span className="dict-block-label">{t('wordSearch.example')}</span>
                <p>{wordResult.example}</p>
              </div>
            ) : null}

            {wordResult.note ? (
              <div className="dict-example-block">
                <span className="dict-block-label">{t('wordSearch.note')}</span>
                <p>{wordResult.note}</p>
              </div>
            ) : null}

            <div className="dict-save-row">
              <label className="session-inline">
                <span className="muted">{t('wordSearch.saveTo')}</span>
                <Select
                  value={selectedWordFolderId || undefined}
                  onChange={(v) => setSelectedWordFolderId(v ?? '')}
                  disabled={wordFolders.length === 0}
                  placeholder={
                    wordFolders.length === 0
                      ? t('wordSearch.noFolderOption')
                      : undefined
                  }
                  style={{ minWidth: 180 }}
                  options={wordFolders
                    .filter((folder) => folder.language === effectiveLanguage)
                    .map((folder) => ({
                      value: folder.id,
                      label: `${folder.name}(${folder.language.toUpperCase()})`,
                    }))}
                />
              </label>
              {wordFolders.length === 0 ? (
                <Link className="secondary-link" to="/folders">
                  {t('wordSearch.createFolder')}
                </Link>
              ) : null}
              <button
                type="button"
                className="primary-button"
                onClick={() => void handleAddWord()}
                disabled={isSavingWord || wordFolders.length === 0}
              >
                {isSavingWord ? t('wordSearch.addingWord') : t('wordSearch.addWord')}
              </button>
            </div>
          </div>
        ) : !isSearchingAi && !hasAiSection ? (
          <p className="muted">
            {hasQuery ? t('wordSearch.aiHintWithQuery') : t('wordSearch.aiHintNoQuery')}
          </p>
        ) : null}
      </article>
    </section>
  )
}
