import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { getUnlearnedGrammars, initGrammarReview } from '../api/grammarReview'
import {
  listGrammarQuestionsFor,
  type GrammarQuestion,
} from '../api/grammarQuestions'
import { GrammarQuestionCard } from '../components/GrammarQuestionCard'
import { useTab } from '../components/TabContext'
import type { Grammar, ReviewRating } from '../types'

// Smaller batch than Word's 5 — grammar items are denser (pattern + connection
// + meaning + multiple examples), 3 per pass keeps the cognitive load sane.
const BATCH_SIZE = 3

type Phase = 'study' | 'rate' | 'session-done'

function chunkInto<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items]
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

export function LearnGrammarPage() {
  const { setTitle } = useTab()
  const [searchParams] = useSearchParams()
  // ?count=N caps the session to first N unlearned grammars (sorted by
  // createdAt asc, matching what GrammarPage's count selector chose).
  const countLimit = (() => {
    const raw = searchParams.get('count')
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  })()
  const [allGrammars, setAllGrammars] = useState<Grammar[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [batchIdx, setBatchIdx] = useState(0)
  const [phase, setPhase] = useState<Phase>('study')
  const [itemIdx, setItemIdx] = useState(0)
  const [ratedInBatch, setRatedInBatch] = useState<Record<string, ReviewRating>>({})
  const [sessionCount, setSessionCount] = useState(0)
  // 5 MCQs per grammar, cached per grammarId — fetched lazily as the user
  // reaches each new item and reused if we cycle back.
  const [questionsByGrammar, setQuestionsByGrammar] = useState<
    Record<string, GrammarQuestion[]>
  >({})

  useEffect(() => {
    setTitle('语法学习')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const run = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const result = await getUnlearnedGrammars()
        const items = Array.isArray(result.items) ? result.items : []
        setAllGrammars(countLimit === null ? items : items.slice(0, countLimit))
      } catch {
        setError('加载语法点失败')
      } finally {
        setIsLoading(false)
      }
    }
    void run()
  }, [])

  const batches = useMemo(() => chunkInto(allGrammars, BATCH_SIZE), [allGrammars])
  const currentBatch = batches[batchIdx] ?? []
  const currentItem = currentBatch[itemIdx]

  useEffect(() => {
    if (!currentItem) return
    if (questionsByGrammar[currentItem.id]) return
    listGrammarQuestionsFor(currentItem.id)
      .then((rows) =>
        setQuestionsByGrammar((prev) => ({ ...prev, [currentItem.id]: rows })),
      )
      .catch(() => {
        setQuestionsByGrammar((prev) => ({ ...prev, [currentItem.id]: [] }))
      })
  }, [currentItem, questionsByGrammar])

  const advance = () => {
    if (itemIdx < currentBatch.length - 1) {
      setItemIdx(itemIdx + 1)
      return
    }
    setItemIdx(0)
    setPhase('rate')
  }

  const handleRate = async (rating: ReviewRating) => {
    if (!currentItem || isSubmitting) return
    setIsSubmitting(true)
    try {
      await initGrammarReview({ grammarId: currentItem.id, rating })
      setRatedInBatch((prev) => ({ ...prev, [currentItem.id]: rating }))
      setSessionCount((prev) => prev + 1)

      if (itemIdx < currentBatch.length - 1) {
        setItemIdx(itemIdx + 1)
      } else if (batchIdx < batches.length - 1) {
        setBatchIdx(batchIdx + 1)
        setItemIdx(0)
        setPhase('study')
        setRatedInBatch({})
      } else {
        setPhase('session-done')
      }
    } catch {
      setError('提交评分失败,请重试')
    } finally {
      setIsSubmitting(false)
    }
  }

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

  if (allGrammars.length === 0) {
    return (
      <section className="page">
        <div className="card state-card">
          <h2>暂无新语法点</h2>
          <p className="muted">所有语法点都已经学习过,可以去复习页巩固一下。</p>
          <div className="actions">
            <Link className="primary-link" to="/grammar/review">
              去复习
            </Link>
            <Link className="secondary-link" to="/grammar">
              返回列表
            </Link>
          </div>
        </div>
      </section>
    )
  }

  if (phase === 'session-done') {
    return (
      <section className="page">
        <div className="card state-card">
          <div className="state-illustration">{sessionCount}</div>
          <h2>本次学习完成</h2>
          <p className="muted">共学习 {sessionCount} 个新语法点,可以去复习。</p>
          <div className="actions">
            <Link className="primary-link" to="/grammar/review">
              去复习
            </Link>
            <Link className="secondary-link" to="/grammar">
              返回列表
            </Link>
          </div>
        </div>
      </section>
    )
  }

  if (!currentItem) return null

  const overallTotal = allGrammars.length
  const overallProgress = Math.round((sessionCount / overallTotal) * 100)
  const phaseLabel = phase === 'study' ? '阅读理解' : '自评打分'

  return (
    <section className="page">
      <div className="card grammar-learn-card">
        <div className="learn-meta">
          <div>
            <p className="eyebrow">{phaseLabel}</p>
            <strong className="progress-text">
              批次 {batchIdx + 1} / {batches.length}
              <span className="muted">
                {' '}
                · 第 {itemIdx + 1} / {currentBatch.length}
              </span>
            </strong>
          </div>
          <span className="review-tag">
            已学 {sessionCount} / {overallTotal}
          </span>
        </div>

        <div
          className="progress-track"
          aria-label={`grammar learn progress ${overallProgress}%`}
        >
          <span
            className="progress-bar"
            style={{ width: `${overallProgress}%` }}
          />
        </div>

        <div className="grammar-study-card">
          <div className="grammar-study-pattern">{currentItem.pattern}</div>
          {currentItem.connection ? (
            <p className="grammar-study-line">
              <strong>接续:</strong> {currentItem.connection}
            </p>
          ) : null}
          {currentItem.meaning ? (
            <p className="grammar-study-line">
              <strong>含义:</strong> {currentItem.meaning}
            </p>
          ) : null}
          {currentItem.example ? (
            <div className="grammar-study-examples">
              <p className="eyebrow">例句</p>
              <p className="multiline-text">{currentItem.example}</p>
              {currentItem.exampleZh ? (
                <p className="muted multiline-text">{currentItem.exampleZh}</p>
              ) : null}
            </div>
          ) : null}
          {currentItem.note ? (
            <p className="muted multiline-text">
              <strong>备注:</strong> {currentItem.note}
            </p>
          ) : null}
          {ratedInBatch[currentItem.id] ? (
            <p className="muted" style={{ marginTop: 8 }}>
              已评为「{ratedInBatch[currentItem.id]}」
            </p>
          ) : null}

          {(() => {
            const questions = questionsByGrammar[currentItem.id]
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
                        const list = prev[currentItem.id]
                        if (!list) return prev
                        return {
                          ...prev,
                          [currentItem.id]: list.map((qq) =>
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
          })()}
        </div>

        {phase === 'study' ? (
          <div className="actions">
            <button
              type="button"
              className="primary-button"
              onClick={advance}
            >
              {itemIdx < currentBatch.length - 1 ? '下一个' : '开始打分'}
            </button>
          </div>
        ) : (
          <div className="actions rating-actions">
            <div className="rating-action">
              <button
                type="button"
                className="danger-button"
                disabled={isSubmitting}
                onClick={() => void handleRate('again')}
              >
                Again
              </button>
              <span className="rating-caption">完全没记住</span>
            </div>
            <div className="rating-action">
              <button
                type="button"
                className="secondary-button"
                disabled={isSubmitting}
                onClick={() => void handleRate('hard')}
              >
                Hard
              </button>
              <span className="rating-caption">记住但不确定</span>
            </div>
            <div className="rating-action">
              <button
                type="button"
                className="success-button"
                disabled={isSubmitting}
                onClick={() => void handleRate('easy')}
              >
                Easy
              </button>
              <span className="rating-caption">一看就懂</span>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
