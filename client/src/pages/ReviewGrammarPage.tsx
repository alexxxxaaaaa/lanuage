import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import {
  getTodayGrammarReviews,
  submitGrammarReviewResult,
} from '../api/grammarReview'
import {
  listGrammarQuestionsFor,
  type GrammarQuestion,
} from '../api/grammarQuestions'
import { GrammarQuestionCard } from '../components/GrammarQuestionCard'
import { useTab } from '../components/TabContext'
import type { GrammarReviewItem, ReviewRating } from '../types'

export function ReviewGrammarPage() {
  const { setTitle } = useTab()
  const [queue, setQueue] = useState<GrammarReviewItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isFlipped, setIsFlipped] = useState(false)
  const [done, setDone] = useState(0)
  const [initialTotal, setInitialTotal] = useState(0)
  // Questions attached to each grammar, cached per grammarId. Loaded lazily
  // when a grammar becomes current; if a review-again cycles it back later,
  // we reuse the cached list (including any attempts the user just made).
  const [questionsByGrammar, setQuestionsByGrammar] = useState<
    Record<string, GrammarQuestion[]>
  >({})

  useEffect(() => {
    setTitle('语法复习')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const run = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const result = await getTodayGrammarReviews()
        const items = Array.isArray(result.items) ? result.items : []
        setQueue(items)
        setInitialTotal(items.length)
      } catch {
        setError('加载复习列表失败')
      } finally {
        setIsLoading(false)
      }
    }
    void run()
  }, [])

  const current = queue[0]

  useEffect(() => {
    if (!current) return
    const gid = current.grammarId
    if (questionsByGrammar[gid]) return
    listGrammarQuestionsFor(gid)
      .then((rows) =>
        setQuestionsByGrammar((prev) => ({ ...prev, [gid]: rows })),
      )
      .catch(() => {
        setQuestionsByGrammar((prev) => ({ ...prev, [gid]: [] }))
      })
  }, [current, questionsByGrammar])

  const handleRate = useCallback(
    async (rating: ReviewRating) => {
      if (!current || isSubmitting) return
      setIsSubmitting(true)
      try {
        await submitGrammarReviewResult({
          grammarId: current.grammarId,
          rating,
        })
        // again 评分 → 当日重练:把这一条挪到队列尾部,不算 done
        if (rating === 'again') {
          setQueue((prev) =>
            prev.length > 1 ? [...prev.slice(1), prev[0]] : prev,
          )
        } else {
          setQueue((prev) => prev.slice(1))
          setDone((prev) => prev + 1)
        }
        setIsFlipped(false)
      } catch {
        setError('提交评分失败,请重试')
      } finally {
        setIsSubmitting(false)
      }
    },
    [current, isSubmitting],
  )

  // Space → flip;Enter on flipped → easy(快速通过)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName ?? ''
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        (target?.isContentEditable ?? false)
      ) {
        return
      }
      if (e.key === ' ') {
        e.preventDefault()
        if (current) setIsFlipped((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [current])

  if (isLoading) {
    return (
      <section className="page">
        <div className="card state-card">
          <h2>加载中...</h2>
        </div>
      </section>
    )
  }

  if (error) {
    return (
      <section className="page">
        <div className="card state-card">
          <p className="error-text">{error}</p>
        </div>
      </section>
    )
  }

  if (!current) {
    return (
      <section className="page">
        <div className="card state-card">
          <div className="state-illustration">100%</div>
          <h2>{done > 0 ? '今日复习完成' : '今日无到期'}</h2>
          <p className="muted">
            {done > 0
              ? `复习了 ${done} 个语法点,明天再见。`
              : '所有语法点都还没到期,可以去学新语法或休息一下。'}
          </p>
          <div className="actions">
            <Link className="primary-link" to="/grammar/learn">
              学习新语法
            </Link>
            <Link className="secondary-link" to="/grammar">
              返回列表
            </Link>
          </div>
        </div>
      </section>
    )
  }

  const grammar = current.grammar
  const progressPercent =
    initialTotal === 0 ? 0 : Math.round((done / initialTotal) * 100)

  return (
    <section className="page">
      <div className="card review-card">
        <div className="review-meta">
          <div className="review-progress-copy">
            <p className="eyebrow">语法复习</p>
            <strong className="progress-text">
              {done + 1} / {initialTotal}
              <span className="muted"> · 队列剩 {queue.length}</span>
            </strong>
          </div>
          <span className="review-tag">{grammar.level}</span>
        </div>

        <div
          className="progress-track"
          aria-label={`grammar review progress ${progressPercent}%`}
        >
          <span
            className="progress-bar"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        <button
          type="button"
          className={`flip-card ${isFlipped ? 'is-flipped' : ''}`}
          onClick={() => setIsFlipped((prev) => !prev)}
          aria-label="翻转语法卡片"
        >
          <span className="flip-card-face flip-card-front">
            <span className="card-label">正面 · 空格翻卡</span>
            <strong className="grammar-flip-pattern">{grammar.pattern}</strong>
          </span>
          <span className="flip-card-face flip-card-back">
            <span className="card-label">背面</span>
            {grammar.connection ? (
              <small className="multiline-text">
                <strong>接续:</strong> {grammar.connection}
              </small>
            ) : null}
            {grammar.meaning ? (
              <strong className="multiline-text">{grammar.meaning}</strong>
            ) : null}
            {grammar.example ? (
              <small className="multiline-text">{grammar.example}</small>
            ) : null}
            {grammar.exampleZh ? (
              <small className="muted multiline-text">{grammar.exampleZh}</small>
            ) : null}
            {grammar.note ? (
              <small className="muted multiline-text">
                <strong>备注:</strong> {grammar.note}
              </small>
            ) : null}
          </span>
        </button>

        {isFlipped ? (() => {
          const questions = questionsByGrammar[current.grammarId]
          if (!questions) return <p className="muted">练习加载中...</p>
          if (questions.length === 0) return null
          return (
            <div className="grammar-learn-questions">
              <p className="eyebrow">练习</p>
              {questions.map((q) => (
                <GrammarQuestionCard
                  key={q.id}
                  question={q}
                  onAnswered={({ isCorrect, selectedIndex }) => {
                    setQuestionsByGrammar((prev) => {
                      const list = prev[current.grammarId]
                      if (!list) return prev
                      return {
                        ...prev,
                        [current.grammarId]: list.map((qq) =>
                          qq.id !== q.id
                            ? qq
                            : {
                                ...qq,
                                attempt: { selectedIndex, isCorrect },
                              },
                        ),
                      }
                    })
                  }}
                />
              ))}
            </div>
          )
        })() : null}

        <div className="actions rating-actions">
          <div className="rating-action">
            <button
              type="button"
              className="danger-button"
              disabled={isSubmitting || !isFlipped}
              onClick={() => void handleRate('again')}
            >
              Again
            </button>
            <span className="rating-caption">没记住,稍后再来</span>
          </div>
          <div className="rating-action">
            <button
              type="button"
              className="secondary-button"
              disabled={isSubmitting || !isFlipped}
              onClick={() => void handleRate('hard')}
            >
              Hard
            </button>
            <span className="rating-caption">想了一会儿才想起</span>
          </div>
          <div className="rating-action">
            <button
              type="button"
              className="success-button"
              disabled={isSubmitting || !isFlipped}
              onClick={() => void handleRate('easy')}
            >
              Easy
            </button>
            <span className="rating-caption">一眼就反应过来</span>
          </div>
        </div>

        {!isFlipped ? (
          <p className="muted" style={{ textAlign: 'center', marginTop: 8 }}>
            先想一想含义和接续,然后按空格翻牌看答案
          </p>
        ) : null}
      </div>
    </section>
  )
}
