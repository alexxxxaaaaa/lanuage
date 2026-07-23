import { useEffect, useMemo, useState } from 'react'
import { Segmented, Spin, Input } from 'antd'
import { Link } from 'react-router-dom'
import {
  listGrammarQuestions,
  type GrammarQuestion,
} from '../api/grammarQuestions'
import { getErrorMessage } from '../api/error'
import { GrammarQuestionCard } from '../components/GrammarQuestionCard'

type Mode = 'all' | 'wrong'

// Fisher–Yates. Called once per fetch — subsequent re-renders reuse the
// same shuffled order so cards don't jump around when the user answers.
function shuffled<T>(items: readonly T[]): T[] {
  const arr = items.slice()
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export function GrammarQuestionsPage() {
  const [mode, setMode] = useState<Mode>('all')
  const [questions, setQuestions] = useState<GrammarQuestion[] | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const load = async (nextMode: Mode) => {
    setIsLoading(true)
    setError(null)
    try {
      const rows = await listGrammarQuestions(nextMode)
      setQuestions(shuffled(rows))
    } catch (err) {
      setError(getErrorMessage(err, '加载失败'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void load(mode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  const filtered = useMemo(() => {
    if (!questions) return []
    const q = query.trim().toLowerCase()
    if (!q) return questions
    return questions.filter(
      (item) =>
        item.grammarPattern.toLowerCase().includes(q) ||
        (item.grammarMeaning ?? '').toLowerCase().includes(q) ||
        item.prompt.toLowerCase().includes(q),
    )
  }, [questions, query])

  const wrongCount = filtered.filter(
    (q) => q.attempt && !q.attempt.isCorrect,
  ).length
  const answeredCount = filtered.filter((q) => q.attempt).length

  return (
    <section className="page">
      <div className="section-header">
        <div>
          <p className="eyebrow">
            <Link to="/grammar">语法</Link> / 题库
          </p>
          <h2>语法选择题</h2>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <Segmented
            value={mode}
            onChange={(v) => setMode(v as Mode)}
            options={[
              { label: '全部题目', value: 'all' },
              { label: '错题本', value: 'wrong' },
            ]}
          />
          <Input
            allowClear
            placeholder="按句型/意思/题干筛选"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ maxWidth: 260 }}
          />
          <button type="button" onClick={() => void load(mode)}>
            重新洗牌
          </button>
          <span className="muted" style={{ marginLeft: 'auto' }}>
            共 {filtered.length} 题
            {answeredCount > 0 ? ` · 已答 ${answeredCount}` : ''}
            {wrongCount > 0 ? ` · 错 ${wrongCount}` : ''}
          </span>
        </div>
      </div>

      {isLoading ? (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <Spin />
        </div>
      ) : error ? (
        <p className="error-text">{error}</p>
      ) : filtered.length === 0 ? (
        <div className="card">
          <p className="muted">
            {mode === 'wrong' ? '没有错题——先去答几题吧。' : '暂无题目'}
          </p>
        </div>
      ) : (
        <div className="grammar-question-flat-list">
          {filtered.map((q, idx) => (
            <div className="grammar-question-flat-item" key={q.id}>
              <div className="grammar-question-flat-meta">
                <span className="grammar-question-flat-index">
                  Q{idx + 1}
                </span>
                <Link
                  to={`/grammar/${q.grammarId}`}
                  className="grammar-question-flat-pattern"
                  style={{ fontFamily: 'serif' }}
                >
                  {q.grammarPattern}
                </Link>
                {q.grammarMeaning ? (
                  <span className="muted grammar-question-flat-meaning">
                    {q.grammarMeaning}
                  </span>
                ) : null}
              </div>
              <GrammarQuestionCard
                question={q}
                onAnswered={({ isCorrect, selectedIndex }) => {
                  setQuestions((prev) =>
                    prev
                      ? prev.map((qq) =>
                          qq.id !== q.id
                            ? qq
                            : { ...qq, attempt: { selectedIndex, isCorrect } },
                        )
                      : prev,
                  )
                }}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
