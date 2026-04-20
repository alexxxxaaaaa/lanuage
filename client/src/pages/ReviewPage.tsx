import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { SpeakButton } from '../components/SpeakButton'
import { VoicePicker } from '../components/VoicePicker'
import { useAppStore } from '../store/useAppStore'
import { speak, stopSpeaking } from '../utils/speech'

const LIMIT_OPTIONS: { value: number | null; label: string }[] = [
  { value: 5, label: '5' },
  { value: 10, label: '10' },
  { value: 20, label: '20' },
  { value: 50, label: '50' },
  { value: 100, label: '100' },
  { value: null, label: '全部' },
]

export function ReviewPage() {
  const todayReviews = useAppStore((state) => state.todayReviews)
  const dueReviews = useAppStore((state) => state.dueReviews)
  const totalReviewCount = useAppStore((state) => state.totalReviewCount)
  const sessionLimit = useAppStore((state) => state.sessionLimit)
  const currentIndex = useAppStore((state) => state.currentIndex)
  const isCardFlipped = useAppStore((state) => state.isCardFlipped)
  const isLoadingReviews = useAppStore((state) => state.isLoadingReviews)
  const isSubmitting = useAppStore((state) => state.isSubmitting)
  const error = useAppStore((state) => state.error)

  useEffect(() => {
    useAppStore.getState().clearError()
    void useAppStore.getState().fetchTodayReviews()
    useAppStore.getState().resetReviewSession()
  }, [])

  const reviews = Array.isArray(todayReviews) ? todayReviews : []
  const currentReview = reviews[currentIndex]
  const currentWord = currentReview?.word
  const completedCount = Math.max(0, totalReviewCount - reviews.length)
  const displayCurrent = totalReviewCount === 0 ? 0 : completedCount + 1
  const progressPercent =
    totalReviewCount === 0 ? 0 : (completedCount / totalReviewCount) * 100

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target

      if (
        target instanceof HTMLElement &&
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      ) {
        return
      }

      if (event.code === 'Space' && currentWord) {
        event.preventDefault()
        useAppStore.getState().toggleCard()
      }

      if ((event.key === 'p' || event.key === 'P') && currentWord) {
        event.preventDefault()
        const text = isCardFlipped ? currentWord.example : currentWord.word
        speak(text, currentWord.language)
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      stopSpeaking()
    }
  }, [currentWord, isCardFlipped])

  if (isLoadingReviews) {
    return (
      <section className="page">
        <div className="card review-card state-card">
          <div className="state-illustration">...</div>
          <h2>正在加载今日复习...</h2>
          <p className="muted">系统正在准备今天需要复习的单词。</p>
          <div className="actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => void useAppStore.getState().fetchTodayReviews()}
            >
              重试
            </button>
          </div>
        </div>
      </section>
    )
  }

  if (!currentReview || !currentWord) {
    const remainingPool = Array.isArray(dueReviews) ? dueReviews.length : 0
    const hasMore = remainingPool > 0

    return (
      <section className="page">
        <div className="card review-card state-card">
          <div className="state-illustration">100%</div>
          <h2>
            {hasMore ? '本次批次完成！' : '今天已经复习完啦'}
          </h2>
          <p className="muted">
            {hasMore
              ? `到期池里还剩 ${remainingPool} 个单词，需要再来一组吗？`
              : '当前没有到期单词，可以先去添加单词或查看分类。'}
          </p>
          <div className="actions">
            {hasMore ? (
              <>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() =>
                    useAppStore.getState().startReviewSession(sessionLimit)
                  }
                >
                  再来一组（{sessionLimit === null
                    ? remainingPool
                    : Math.min(sessionLimit, remainingPool)}
                  ）
                </button>
                <Link className="secondary-link" to="/">
                  回首页
                </Link>
              </>
            ) : (
              <>
                <Link className="primary-link" to="/words/new">
                  添加单词
                </Link>
                <Link className="secondary-link" to="/folders">
                  查看分类
                </Link>
              </>
            )}
          </div>
        </div>
      </section>
    )
  }

  return (
    <section className="page">
      <div className="card review-card">
        <div className="review-meta">
          <div className="review-progress-copy">
            <p className="eyebrow">Review Session</p>
            <strong className="progress-text">
              {displayCurrent} / {totalReviewCount}
            </strong>
          </div>
          <div className="review-meta-right">
            <label className="session-inline">
              <span className="muted">批次</span>
              <select
                value={sessionLimit === null ? 'all' : String(sessionLimit)}
                onChange={(event) => {
                  const next =
                    event.target.value === 'all' ? null : Number(event.target.value)
                  useAppStore.getState().setSessionLimit(next)
                  useAppStore.getState().startReviewSession(next)
                }}
              >
                {LIMIT_OPTIONS.map((option) => (
                  <option
                    key={option.value === null ? 'all' : option.value}
                    value={option.value === null ? 'all' : String(option.value)}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <span className="review-tag">{currentWord.folder.name}</span>
          </div>
        </div>

        <VoicePicker
          lang={currentWord.language}
          sampleText={currentWord.word}
        />

        <div
          className="progress-track"
          aria-label={`review progress ${completedCount} of ${totalReviewCount}`}
        >
          <span className="progress-bar" style={{ width: `${progressPercent}%` }} />
        </div>

        <button
          type="button"
          className={`flip-card ${isCardFlipped ? 'is-flipped' : ''}`}
          onClick={() => useAppStore.getState().toggleCard()}
          aria-label="翻转单词卡片"
        >
          <span className="flip-card-face flip-card-front">
            <span className="card-label">正面 · 空格翻卡 · P 朗读</span>
            <span className="flip-word-row">
              <strong>{currentWord.word}</strong>
              <SpeakButton
                text={currentWord.word}
                lang={currentWord.language}
                size="md"
                label="朗读单词"
              />
            </span>
            <small>{currentWord.reading}</small>
          </span>
          <span className="flip-card-face flip-card-back">
            <span className="card-label">背面 · P 朗读例句</span>
            <strong>{currentWord.meaning}</strong>
            <span className="flip-example-row">
              <small>{currentWord.example}</small>
              <SpeakButton
                text={currentWord.example}
                lang={currentWord.language}
                label="朗读例句"
              />
            </span>
            <small>{currentWord.note}</small>
          </span>
        </button>

        <div className="actions">
          <button
            type="button"
            className="danger-button"
            disabled={isSubmitting}
            onClick={() => void useAppStore.getState().submitReview('again')}
          >
            Again
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={isSubmitting}
            onClick={() => void useAppStore.getState().submitReview('hard')}
          >
            Hard
          </button>
          <button
            type="button"
            className="success-button"
            disabled={isSubmitting}
            onClick={() => void useAppStore.getState().submitReview('easy')}
          >
            Easy
          </button>
        </div>

        {error ? <p className="error-text">{error}</p> : null}
      </div>
    </section>
  )
}
