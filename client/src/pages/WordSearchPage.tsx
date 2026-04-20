import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { SpeakButton } from '../components/SpeakButton'
import { useAppStore } from '../store/useAppStore'

export function WordSearchPage() {
  const [searchParams] = useSearchParams()
  const q = searchParams.get('q') ?? ''
  const searchedWords = useAppStore((state) => state.searchedWords)
  const searchKeyword = useAppStore((state) => state.searchKeyword)
  const isLoadingReviews = useAppStore((state) => state.isLoadingReviews)
  const error = useAppStore((state) => state.error)
  const [keyword, setKeyword] = useState(searchKeyword)

  const words = useMemo(
    () => (Array.isArray(searchedWords) ? searchedWords : []),
    [searchedWords],
  )

  useEffect(() => {
    useAppStore.getState().clearError()
    return () => {
      useAppStore.getState().clearWordSearch()
    }
  }, [])

  useEffect(() => {
    setKeyword(q)
    void useAppStore.getState().searchWords(q)
  }, [q])

  const handleSearch = async (event: React.FormEvent) => {
    event.preventDefault()
    await useAppStore.getState().searchWords(keyword)
  }

  return (
    <section className="page">
      <div className="card">
        <p className="eyebrow">Word Search</p>
        <h2>搜索已保存单词</h2>
        <form className="word-search-form" onSubmit={(event) => void handleSearch(event)}>
          <input
            type="text"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="输入单词 / 读音 / 释义关键词（留空=全部）"
          />
          <button type="submit" className="primary-button" disabled={isLoadingReviews}>
            {isLoadingReviews ? '搜索中...' : '搜索'}
          </button>
        </form>
        {error ? <p className="error-text">{error}</p> : null}
      </div>

      {!isLoadingReviews ? (
        <div className="card">
          <p className="muted">
            {searchKeyword ? (
              <>
                关键词：<strong>{searchKeyword}</strong>，共找到 {words.length} 个结果
              </>
            ) : (
              <>当前显示全部单词，共 {words.length} 个结果</>
            )}
          </p>
        </div>
      ) : null}

      {words.length > 0 ? (
        <div className="word-list word-list-folder">
          {words.map((word) => (
            <article key={word.id} className="card word-card word-card-folder">
              <div className="word-card-header">
                <div className="word-card-title">
                  <strong className="word-title">{word.word}</strong>
                  <SpeakButton text={word.word} lang={word.language} size="md" label="朗读单词" />
                  <span className="muted word-reading">{word.reading}</span>
                </div>
                {word.folderId ? (
                  <Link className="secondary-link" to={`/folders/${word.folderId}`}>
                    查看分类
                  </Link>
                ) : null}
              </div>
              {word.meaning ? <p className="word-meaning">{word.meaning}</p> : null}
              {word.example ? (
                <div className="word-example-block">
                  <div className="word-example-body">
                    <span className="word-example-label">例句</span>
                    <p className="word-example-text">{word.example}</p>
                  </div>
                  <SpeakButton text={word.example} lang={word.language} label="朗读例句" />
                </div>
              ) : null}
              {word.note ? <p className="muted word-note-text">笔记：{word.note}</p> : null}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  )
}
