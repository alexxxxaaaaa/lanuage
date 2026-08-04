import { useEffect, useMemo, useState } from 'react'
import { Button, Input, Spinner } from '@heroui/react'
import { SegmentedControl } from '../components/ui/SegmentedControl'
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
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let ignore = false
    async function load() {
      setIsLoading(true)
      setError(null)
      try {
        const rows = await listGrammarQuestions(mode)
        if (!ignore) setQuestions(shuffled(rows))
      } catch (err) {
        if (!ignore) setError(getErrorMessage(err, '加载失败'))
      } finally {
        if (!ignore) setIsLoading(false)
      }
    }
    void load()
    return () => {
      ignore = true
    }
  }, [mode, reloadToken])

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
          <h2>语法选择题</h2>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <SegmentedControl
            fitContent
            aria-label="筛选题目"
            value={mode}
            onChange={(v) => setMode(v as Mode)}
            options={[
              { label: '全部题目', value: 'all' },
              { label: '错题本', value: 'wrong' },
            ]}
          />
          <Input
            placeholder="按句型/意思/题干筛选"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="max-w-[260px]"
          />
          <Button type="button" onPress={() => setReloadToken((token) => token + 1)}>
            重新洗牌
          </Button>
          <span className="muted" style={{ marginLeft: 'auto' }}>
            共 {filtered.length} 题
            {answeredCount > 0 ? ` · 已答 ${answeredCount}` : ''}
            {wrongCount > 0 ? ` · 错 ${wrongCount}` : ''}
          </span>
        </div>
      </div>

      {isLoading ? (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <Spinner />
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
        <div className="flex flex-col gap-3.5">
          {filtered.map((q, idx) => (
            <div className="flex flex-col gap-1.5" key={q.id}>
              <div className="flex flex-wrap items-baseline gap-2.5 px-1 text-[0.85rem]">
                <span className="font-semibold tabular-nums text-foreground">
                  Q{idx + 1}
                </span>
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
