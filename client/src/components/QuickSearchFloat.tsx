import { SearchOutlined } from '@ant-design/icons'
import { FloatButton, Modal, message } from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import { fillWordByAi, type AiFillWordResult } from '../api/ai'
import { getErrorMessage, isDuplicateWordError } from '../api/error'
import { getWords } from '../api/words'
import { useAppStore } from '../store/useAppStore'
import { SpeakButton } from './SpeakButton'
import type { Word } from '../types'

const SEARCH_DEBOUNCE = 300

export function QuickSearchFloat() {
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
        message.error(getErrorMessage(error, '搜索失败'))
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
    try {
      const result = await fillWordByAi({ word: term })
      setAiResult(result)
    } catch (error) {
      message.error(getErrorMessage(error, 'AI 查词失败'))
    } finally {
      setIsAiSearching(false)
    }
  }

  const handleAdd = async () => {
    if (!aiResult) return
    if (!targetFolderId) {
      message.warning('请选择保存到的分类')
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
      message.success('已添加到词库')
      setAiResult(null)
      setQuery('')
      setOpen(false)
    } catch (error) {
      if (isDuplicateWordError(error)) {
        message.warning('该分类中已存在同名单词')
        return
      }
      message.error(getErrorMessage(error, '添加失败'))
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
        tooltip="快速查词"
        style={{ insetInlineEnd: 24, bottom: 24, zIndex: 1200 }}
        onClick={() => setOpen(true)}
      />
      <Modal
        title="快速查词"
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
            placeholder="输入要查的单词…"
            autoFocus
            autoComplete="off"
          />

          {!trimmed ? (
            <p className="muted quick-search-hint">先搜本地词库，没有再用 AI 查</p>
          ) : null}

          {trimmed && isSearching ? (
            <p className="muted quick-search-hint">搜索中…</p>
          ) : null}

          {hasLocalHits ? (
            <div className="quick-search-section">
              <p className="quick-search-section-title">本地词库 · {localResults!.length}</p>
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
              <p className="muted quick-search-hint">本地没有「{trimmed}」</p>
              <button
                type="button"
                className="primary-button quick-search-ai-btn"
                onClick={() => void handleAiSearch()}
                disabled={isAiSearching}
              >
                {isAiSearching ? 'AI 查询中…' : '🤖 用 AI 查词'}
              </button>
            </div>
          ) : null}

          {aiResult ? (
            <div className="quick-search-section quick-search-ai-result">
              <p className="quick-search-section-title">AI 结果</p>
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
                  <option value="">选择分类</option>
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
                  {isSubmitting ? '添加中…' : '+ 添加'}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </Modal>
    </>
  )
}
