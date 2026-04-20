import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAppStore } from '../store/useAppStore'

const LIMIT_OPTIONS: { value: number | null; label: string }[] = [
  { value: 5, label: '5 个' },
  { value: 10, label: '10 个' },
  { value: 20, label: '20 个' },
  { value: 50, label: '50 个' },
  { value: 100, label: '100 个' },
  { value: null, label: '全部' },
]

export function HomePage() {
  const navigate = useNavigate()
  const dueReviews = useAppStore((state) => state.dueReviews)
  const sessionLimit = useAppStore((state) => state.sessionLimit)
  const isLoadingReviews = useAppStore((state) => state.isLoadingReviews)
  const error = useAppStore((state) => state.error)
  const dueCount = Array.isArray(dueReviews) ? dueReviews.length : 0
  const plannedCount =
    sessionLimit === null ? dueCount : Math.min(dueCount, sessionLimit)

  useEffect(() => {
    useAppStore.getState().clearError()
    void useAppStore.getState().fetchTodayReviews()
  }, [])

  const handleStart = () => {
    useAppStore.getState().startReviewSession(sessionLimit)
    navigate('/review')
  }

  const handleLimitChange = (value: string) => {
    const next = value === 'all' ? null : Number(value)
    useAppStore.getState().setSessionLimit(next)
  }

  return (
    <section className="page">
      <div className="card hero-card">
        <p className="eyebrow">Today Review</p>
        <h2>今天需要复习的单词</h2>
        <p className="hero-count">{isLoadingReviews ? '...' : dueCount}</p>
        <p className="muted">
          打开今日复习列表，按照 Again / Hard / Easy 三种评分推进记忆节奏。
        </p>

        <div className="session-picker">
          <label className="session-picker-label" htmlFor="session-limit">
            本次背多少个
          </label>
          <select
            id="session-limit"
            value={sessionLimit === null ? 'all' : String(sessionLimit)}
            onChange={(event) => handleLimitChange(event.target.value)}
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
          <span className="muted session-picker-hint">
            本次会推 {isLoadingReviews ? '…' : plannedCount} 张
          </span>
        </div>

        <div className="hero-actions">
          <button
            type="button"
            className="primary-button"
            onClick={handleStart}
            disabled={isLoadingReviews || dueCount === 0}
          >
            开始背词
          </button>
          <Link className="secondary-link" to="/folders">
            查看分类
          </Link>
          <button
            type="button"
            className="secondary-button"
            disabled={isLoadingReviews}
            onClick={() => void useAppStore.getState().fetchTodayReviews()}
          >
            刷新数据
          </button>
        </div>

        {error ? <p className="error-text">{error}</p> : null}
      </div>
    </section>
  )
}
