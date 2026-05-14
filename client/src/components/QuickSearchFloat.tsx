import { SearchOutlined } from '@ant-design/icons'
import { FloatButton, Modal, Progress, message } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import { fillWordByAi, type AiFillWordResult } from '../api/ai'
import { getErrorMessage, isDuplicateWordError } from '../api/error'
import { getWords } from '../api/words'
import { useI18n } from '../i18n'
import { useAppStore } from '../store/useAppStore'
import { SpeakButton } from './SpeakButton'
import type { Word } from '../types'

const SEARCH_DEBOUNCE = 300

export function QuickSearchFloat() {
  const { t } = useI18n()
  const folders = useAppStore((state) => state.folders)
  const fetchFolders = useAppStore((state) => state.fetchFolders)
  const createWord = useAppStore((state) => state.createWord)
  const isSubmitting = useAppStore((state) => state.isSubmitting)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [localResults, setLocalResults] = useState<Word[] | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [aiResult, setAiResult] = useState<AiFillWordResult | null>(null)
  const [isAiSearching, setIsAiSearching] = useState(false)
  const [aiProgress, setAiProgress] = useState(0)
  const [targetFolderId, setTargetFolderId] = useState<string>('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const folderList = useMemo(
    () => (Array.isArray(folders) ? folders : []),
    [folders],
  )

  useEffect(() => {
    if (!open) return
    void fetchFolders()
  }, [open, fetchFolders])

  // Debounced local search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setAiResult(null)
    const term = query.trim()
    if (!term) {
      setLocalResults(null)
      setIsSearching(false)
      return
    }
    setIsSearching(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const rows = await getWords({ q: term })
        setLocalResults(rows ?? [])
      } catch (error) {
        message.error(getErrorMessage(error, t('quickSearch.searchFailed')))
      } finally {
        setIsSearching(false)
      }
    }, SEARCH_DEBOUNCE)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query])

  // Auto-pick a default target folder when AI result arrives
  useEffect(() => {
    if (!aiResult) return
    if (folderList.length === 0) return
    const sameLang = folderList.find((f) => f.language === aiResult.language)
    setTargetFolderId(sameLang?.id ?? folderList[0].id)
  }, [aiResult, folderList])

  const handleAiSearch = async () => {
    const term = query.trim()
    if (!term) return
    setIsAiSearching(true)
    setAiProgress(8)
    const progressTimer = window.setInterval(() => {
      setAiProgress((current) => {
        if (current >= 88) return current
        const delta = current < 50 ? 6 : current < 75 ? 3 : 1
        return Math.min(88, current + delta)
      })
    }, 400)
    try {
      const result = await fillWordByAi({ word: term })
      setAiResult(result)
    } catch (error) {
      message.error(getErrorMessage(error, t('quickSearch.aiFailed')))
    } finally {
      window.clearInterval(progressTimer)
      setAiProgress(100)
      window.setTimeout(() => setAiProgress(0), 400)
      setIsAiSearching(false)
    }
  }

  const handleAdd = async () => {
    if (!aiResult) return
    if (!targetFolderId) {
      message.warning(t('quickSearch.pickFolderFirst'))
      return
    }
    try {
      await createWord({
        folderId: targetFolderId,
        language: aiResult.language,
        word: aiResult.word,
        reading: aiResult.reading,
        meaning: aiResult.meaning,
        example: aiResult.example,
        note: aiResult.note,
        partOfSpeech: aiResult.partOfSpeech,
      })
      message.success(t('quickSearch.added'))
      setAiResult(null)
      setQuery('')
      setOpen(false)
    } catch (error) {
      if (isDuplicateWordError(error)) {
        message.warning(t('quickSearch.duplicate'))
        return
      }
      message.error(getErrorMessage(error, t('quickSearch.addFailed')))
    }
  }

  const close = () => {
    setOpen(false)
    setQuery('')
    setAiResult(null)
    setLocalResults(null)
  }

  const hasLocalHits = (localResults?.length ?? 0) > 0
  const noLocalHits = localResults !== null && localResults.length === 0
  const trimmed = query.trim()

  return (
    <>
      <FloatButton
        className="quick-search-float"
        type="primary"
        icon={<SearchOutlined />}
        tooltip={t('quickSearch.tooltip')}
        style={{ insetInlineEnd: 24, bottom: 24, zIndex: 1200 }}
        onClick={() => setOpen(true)}
      />
      <Modal
        title={t('quickSearch.title')}
        open={open}
        onCancel={close}
        footer={null}
        destroyOnClose
        width={520}
      >
        <div className="quick-search-body">
          <input
            type="search"
            className="quick-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('quickSearch.placeholder')}
            autoFocus
            autoComplete="off"
          />

          {!trimmed ? (
            <p className="muted quick-search-hint">{t('quickSearch.hint')}</p>
          ) : null}

          {trimmed && isSearching ? (
            <p className="muted quick-search-hint">{t('quickSearch.searching')}</p>
          ) : null}

          {hasLocalHits ? (
            <div className="quick-search-section">
              <p className="quick-search-section-title">
                {t('quickSearch.localTitle', { count: localResults!.length })}
              </p>
              <ul className="quick-search-list">
                {localResults!.slice(0, 8).map((w) => (
                  <li key={w.id} className="quick-search-item">
                    <div className="quick-search-item-head">
                      <strong>{w.word}</strong>
                      {w.reading ? <span className="muted">{w.reading}</span> : null}
                      <SpeakButton
                        text={w.word}
                        reading={w.reading}
                        lang={w.language}
                        size="sm"
                      />
                      <span className="quick-search-folder-tag">{w.folder?.name ?? ''}</span>
                    </div>
                    {w.meaning ? (
                      <p className="muted quick-search-meaning">{w.meaning}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {trimmed && !isSearching && noLocalHits && !aiResult ? (
            <div className="quick-search-section">
              <p className="muted quick-search-hint">
                {t('quickSearch.noLocal', { term: trimmed })}
              </p>
              <button
                type="button"
                className="primary-button quick-search-ai-btn"
                onClick={() => void handleAiSearch()}
                disabled={isAiSearching}
              >
                {isAiSearching ? t('quickSearch.aiSearching') : t('quickSearch.aiSearch')}
              </button>
              {isAiSearching || aiProgress > 0 ? (
                <Progress
                  percent={aiProgress}
                  size="small"
                  showInfo={false}
                  status={isAiSearching ? 'active' : 'success'}
                />
              ) : null}
            </div>
          ) : null}

          {aiResult ? (
            <div className="quick-search-section quick-search-ai-result">
              <p className="quick-search-section-title">{t('quickSearch.aiResult')}</p>
              <div className="quick-search-item-head">
                <strong>{aiResult.word}</strong>
                {aiResult.reading ? (
                  <span className="muted">{aiResult.reading}</span>
                ) : null}
                <SpeakButton
                  text={aiResult.word}
                  reading={aiResult.reading}
                  lang={aiResult.language}
                  size="sm"
                />
                {aiResult.partOfSpeech ? (
                  <span className="quick-search-folder-tag">
                    {aiResult.partOfSpeech}
                  </span>
                ) : null}
              </div>
              {aiResult.meaning ? (
                <p className="quick-search-meaning multiline-text">{aiResult.meaning}</p>
              ) : null}
              {aiResult.example ? (
                <p className="muted quick-search-example multiline-text">
                  {aiResult.example}
                </p>
              ) : null}
              {aiResult.note ? (
                <p className="muted quick-search-note">{aiResult.note}</p>
              ) : null}

              <div className="quick-search-add-row">
                <select
                  value={targetFolderId}
                  onChange={(e) => setTargetFolderId(e.target.value)}
                >
                  <option value="">{t('quickSearch.pickFolder')}</option>
                  {folderList
                    .filter((f) => f.language === aiResult.language)
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void handleAdd()}
                  disabled={isSubmitting || !targetFolderId}
                >
                  {isSubmitting ? t('quickSearch.adding') : t('quickSearch.add')}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </Modal>
    </>
  )
}
