import { useEffect, useMemo, useState } from 'react'
import { Modal, Progress, Spin } from 'antd'
import { Link, useSearchParams } from 'react-router-dom'
import { fillWordByAi } from '../api/ai'
import { getErrorMessage, isDuplicateWordError } from '../api/error'
import { createWord, getWords } from '../api/words'
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

export function WordSearchPage() {
  const { t } = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const q = searchParams.get('q') ?? ''
  const folders = useAppStore((state) => state.folders)
  const [keyword, setKeyword] = useState(q)
  const [targetLanguage, setTargetLanguage] = useState<'en' | 'jp'>('en')
  const [isSearchingAi, setIsSearchingAi] = useState(false)
  const [aiProgress, setAiProgress] = useState(0)
  const [isSavingWord, setIsSavingWord] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wordResult, setWordResult] = useState<DictResult | null>(null)
  const [localMatches, setLocalMatches] = useState<Word[]>([])
  const [isSearchingLocal, setIsSearchingLocal] = useState(false)
  const [autoAiFiredFor, setAutoAiFiredFor] = useState('')

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
        if (!cancelled) setLocalMatches(results ?? [])
      } catch {
        if (!cancelled) setLocalMatches([])
      } finally {
        if (!cancelled) setIsSearchingLocal(false)
      }
    })()
    return () => {
      cancelled = true
    }
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
    setSearchParams(text === q ? searchParams : { q: text })
  }

  const runAiLookup = async () => {
    const text = keyword.trim()
    if (!text) {
      setError(t('wordSearch.enterKeyword'))
      return
    }
    // If the input contains kana/kanji, treat as Japanese regardless of toggle —
    // forcing JP→EN translation here defeats the user's actual intent.
    const hasJapaneseChar = /[぀-ヿㇰ-ㇿ一-龯]/.test(text)
    const lookupLanguage: 'en' | 'jp' = hasJapaneseChar ? 'jp' : targetLanguage
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
      const word = await fillWordByAi({ word: text, language: lookupLanguage })
      setWordResult({ ...word, language: word.language ?? lookupLanguage })
    } catch (searchError) {
      setError(getErrorMessage(searchError, t('wordSearch.lookupFailed')))
    } finally {
      window.clearInterval(progressTimer)
      setAiProgress(100)
      window.setTimeout(() => setAiProgress(0), 400)
      setIsSearchingAi(false)
    }
  }

  // Auto-fire AI lookup once when a new query returns zero local matches.
  useEffect(() => {
    const trimmed = q.trim()
    if (!trimmed) return
    if (isSearchingLocal) return
    if (localMatches.length > 0) return
    if (autoAiFiredFor === trimmed) return
    setAutoAiFiredFor(trimmed)
    void runAiLookup()
    // runAiLookup is intentionally not in deps — we only fire once per new q
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, isSearchingLocal, localMatches.length, autoAiFiredFor])

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
          <input
            type="search"
            className="dict-search-input"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submitKeyword()
            }}
            placeholder={t('wordSearch.placeholder')}
          />
          <div className="lang-toggle">
            <button
              type="button"
              className={targetLanguage === 'en' ? 'is-active' : ''}
              onClick={() => setTargetLanguage('en')}
            >
              EN
            </button>
            <button
              type="button"
              className={targetLanguage === 'jp' ? 'is-active' : ''}
              onClick={() => setTargetLanguage('jp')}
            >
              JP
            </button>
          </div>
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
            onClick={() => void runAiLookup()}
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
                <select
                  value={selectedWordFolderId}
                  onChange={(event) => setSelectedWordFolderId(event.target.value)}
                  disabled={wordFolders.length === 0}
                >
                  {wordFolders.length === 0 ? (
                    <option value="">{t('wordSearch.noFolderOption')}</option>
                  ) : null}
                  {wordFolders
                    .filter((folder) => folder.language === effectiveLanguage)
                    .map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}（{folder.language.toUpperCase()}）
                      </option>
                    ))}
                </select>
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
