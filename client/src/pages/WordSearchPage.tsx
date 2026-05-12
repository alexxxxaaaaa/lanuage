import { useEffect, useMemo, useState } from 'react'
import { Modal, Spin } from 'antd'
import { Link, useSearchParams } from 'react-router-dom'
import { fillWordByAi } from '../api/ai'
import { getErrorMessage, isDuplicateWordError } from '../api/error'
import { createWord, getWords } from '../api/words'
import { SpeakButton } from '../components/SpeakButton'
import { useAppStore } from '../store/useAppStore'
import type { Word } from '../types'

type DictResult = {
  word: string
  reading: string
  partOfSpeech: string
  meaning: string
  example: string
  note: string
}

export function WordSearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const q = searchParams.get('q') ?? ''
  const folders = useAppStore((state) => state.folders)
  const [keyword, setKeyword] = useState(q)
  const [targetLanguage, setTargetLanguage] = useState<'en' | 'jp'>('en')
  const [isSearchingAi, setIsSearchingAi] = useState(false)
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
    () =>
      (Array.isArray(folders) ? folders : []).filter(
        (folder) => folder.language === targetLanguage,
      ),
    [folders, targetLanguage],
  )
  const defaultWordFolderId = wordFolders[0]?.id ?? ''
  const [selectedWordFolderId, setSelectedWordFolderId] = useState('')

  useEffect(() => {
    setSelectedWordFolderId((current) =>
      wordFolders.some((folder) => folder.id === current) ? current : defaultWordFolderId,
    )
  }, [wordFolders, defaultWordFolderId])

  const submitKeyword = () => {
    const text = keyword.trim()
    if (!text) {
      setError('请输入要搜索的词')
      return
    }
    setError(null)
    setSearchParams(text === q ? searchParams : { q: text })
  }

  const runAiLookup = async () => {
    const text = keyword.trim()
    if (!text) {
      setError('请输入要搜索的词')
      return
    }
    setIsSearchingAi(true)
    setError(null)
    try {
      const word = await fillWordByAi({ word: text, language: targetLanguage })
      setWordResult(word)
    } catch (searchError) {
      setError(getErrorMessage(searchError, '词典搜索失败，请稍后重试'))
    } finally {
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
      Modal.warning({ title: '请先创建并选择对应语言的单词分类' })
      return
    }
    setIsSavingWord(true)
    try {
      await createWord({
        folderId: selectedWordFolderId,
        language: targetLanguage,
        word: wordResult.word,
        reading: wordResult.reading,
        partOfSpeech: wordResult.partOfSpeech,
        meaning: wordResult.meaning,
        example: wordResult.example,
        note: wordResult.note,
      })
      Modal.success({ title: '已添加到单词' })
    } catch (saveError) {
      if (isDuplicateWordError(saveError)) {
        Modal.warning({ title: '该分类中已存在同名单词' })
      } else {
        Modal.error({ title: '添加失败', content: getErrorMessage(saveError, '请稍后重试') })
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
          <h2>词典搜索</h2>
          <p className="muted">先在你已添加的单词库里查找，再用 AI 词典补充新词。</p>
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
            placeholder="输入中文 / 英语 / 日语，例如：礼貌地拒绝"
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
            搜索
          </button>
        </div>
        {error ? <p className="error-text dict-search-error">{error}</p> : null}
      </div>

      {hasQuery ? (
        <article className="card">
          <div className="dict-section-header">
            <h3>我的单词库</h3>
            <span className="muted">{localMatches.length} 个匹配</span>
          </div>
          {isSearchingLocal ? (
            <div className="dict-loading">
              <Spin size="small" />
            </div>
          ) : localMatches.length === 0 ? (
            <p className="muted">单词库里暂无相关结果。可以试试 AI 词典查询。</p>
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
          <h3>AI 词典</h3>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void runAiLookup()}
            disabled={isSearchingAi || !keyword.trim()}
          >
            {isSearchingAi ? '查询中...' : wordResult ? '重新查询' : '让 AI 查一下'}
          </button>
        </div>

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
                <span className="dict-block-label">例句</span>
                <p>{wordResult.example}</p>
              </div>
            ) : null}

            {wordResult.note ? (
              <div className="dict-example-block">
                <span className="dict-block-label">笔记</span>
                <p>{wordResult.note}</p>
              </div>
            ) : null}

            <div className="dict-save-row">
              <label className="session-inline">
                <span className="muted">保存到</span>
                <select
                  value={selectedWordFolderId}
                  onChange={(event) => setSelectedWordFolderId(event.target.value)}
                  disabled={wordFolders.length === 0}
                >
                  {wordFolders.length === 0 ? (
                    <option value="">暂无可用分类</option>
                  ) : null}
                  {wordFolders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
                </select>
              </label>
              {wordFolders.length === 0 ? (
                <Link className="secondary-link" to="/folders">
                  去创建分类
                </Link>
              ) : null}
              <button
                type="button"
                className="primary-button"
                onClick={() => void handleAddWord()}
                disabled={isSavingWord || wordFolders.length === 0}
              >
                {isSavingWord ? '添加中...' : '添加到单词'}
              </button>
            </div>
          </div>
        ) : !isSearchingAi && !hasAiSection ? (
          <p className="muted">
            {hasQuery
              ? '点击右上角让 AI 给出释义、读音、例句和笔记。'
              : '先在上方输入要查的词，或直接让 AI 给出释义。'}
          </p>
        ) : null}
      </article>
    </section>
  )
}
