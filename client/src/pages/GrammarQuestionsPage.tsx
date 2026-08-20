import { useEffect, useState } from 'react'
import { Button, Input, Spinner } from '@heroui/react'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import {
  listGrammarQuestions,
  type GrammarQuestion,
  type QuestionMode,
} from '../api/grammarQuestions'
import { getErrorMessage } from '../api/error'
import { GrammarQuestionCard } from '../components/GrammarQuestionCard'

type Mode = QuestionMode

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

const PAGE_SIZE = 50

export function GrammarQuestionsPage() {
  const [mode, setMode] = useState<Mode>('all')
  const [questions, setQuestions] = useState<GrammarQuestion[] | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  // 输入框里的字和真正发出去的关键词分开：不然每敲一个字都打一次接口。
  // 按回车或点「搜索」才提交。
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let ignore = false
    async function load() {
      setIsLoading(true)
      setError(null)
      try {
        const result = await listGrammarQuestions(
          mode,
          page,
          PAGE_SIZE,
          submittedQuery,
        )
        // 形状先兜一层：服务端旧版这个接口返回的是数组本身而不是
        // {items,total}，直接 .slice() 会把整页搞崩。新旧都能活。
        const items = Array.isArray(result)
          ? (result as GrammarQuestion[])
          : Array.isArray(result?.items)
            ? result.items
            : []
        const count = Array.isArray(result) ? result.length : (result?.total ?? 0)
        // 只打乱本页 —— 防背题序的作用还在，但不用把两千多道全拉回来。
        if (!ignore) {
          setQuestions(shuffled(items))
          setTotal(count)
        }
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
  }, [mode, page, submittedQuery, reloadToken])

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const goToPage = (next: number) => {
    setPage(Math.min(Math.max(1, next), pageCount))
    window.scrollTo({ top: 0, behavior: 'instant' })
  }

  const submitQuery = () => {
    setSubmittedQuery(query.trim())
    setPage(1)
  }

  const pageItems = questions ?? []
  // 这两个数只统计本页 —— 全库的已答/错题数要另开接口算，先不做。
  const wrongCount = pageItems.filter(
    (q) => q.attempt && !q.attempt.isCorrect,
  ).length
  const answeredCount = pageItems.filter((q) => q.attempt).length

  return (
    <section className="page">
      <div className="section-header">
        <div>
          <h2>语法选择题</h2>
        </div>
      </div>

      <div className="card mb-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* fitContent：各段按自己标签的宽度排，不再等宽（否则「错题本」被
            * 撑得空荡荡、「全部题目」又被挤到折行）。
            * shrink-0：fitContent 收到内容宽之后，还得挡住 flex 行的压缩。 */}
          <SegmentedControl
            fitContent
            aria-label="筛选题目"
            className="shrink-0"
            value={mode}
            onChange={(v) => {
              setMode(v as Mode)
              setPage(1)
            }}
            options={[
              { label: '全部题目', value: 'all' },
              { label: '已做', value: 'done' },
              { label: '未做', value: 'undone' },
              { label: '错题本', value: 'wrong' },
            ]}
          />
          <Input
            placeholder="搜句型/考点/题干，回车"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitQuery()
            }}
            className="min-w-[150px] flex-1 basis-[200px] sm:max-w-[260px]"
          />
          <Button variant="outline" type="button" className="shrink-0"
            onPress={submitQuery}
          >
            搜索
          </Button>
          <Button
            variant="outline"
            type="button"
            className="shrink-0"
            onPress={() => setReloadToken((token) => token + 1)}
          >
            重新洗牌
          </Button>
          {/* 数字用 tabular-nums，答题时逐题跳数不会左右抖 */}
          <span className="muted ml-auto tabular-nums">
            共 {total} 题 · 第 {page}/{pageCount} 页
            {answeredCount > 0 ? ` · 本页已答 ${answeredCount}` : ''}
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
      ) : pageItems.length === 0 ? (
        <div className="card">
          <p className="muted">
            {submittedQuery
              ? `没有匹配「${submittedQuery}」的题目`
              : mode === 'wrong'
                ? '没有错题——先去答几题吧。'
                : mode === 'done'
                  ? '还没答过题'
                  : mode === 'undone'
                    ? '全都答过了'
                    : '暂无题目'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3.5">
          {pageItems.map((q, idx) => (
            <div className="flex flex-col gap-1.5" key={q.id}>
              <div className="flex flex-wrap items-baseline gap-2.5 px-1 text-[0.85rem]">
                {/* 编号带上页偏移，第 2 页从 Q51 起，不是又从 Q1 数 */}
                <span className="font-semibold tabular-nums text-foreground">
                  Q{(page - 1) * PAGE_SIZE + idx + 1}
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

      {!isLoading && !error && pageCount > 1 ? (
        <div className="card mt-4">
          <div className="flex flex-wrap items-center justify-center gap-2 text-[0.9rem]">
            <Button variant="outline" size="sm" type="button"
              isDisabled={page <= 1}
              onPress={() => goToPage(1)}
            >
              第一页
            </Button>
            <Button variant="outline" size="sm" type="button"
              isDisabled={page <= 1}
              onPress={() => goToPage(page - 1)}
            >
              上一页
            </Button>
            <span className="tabular-nums px-1">
              {page} / {pageCount}
            </span>
            <Button variant="outline" size="sm" type="button"
              isDisabled={page >= pageCount}
              onPress={() => goToPage(page + 1)}
            >
              下一页
            </Button>
            <Button variant="outline" size="sm" type="button"
              isDisabled={page >= pageCount}
              onPress={() => goToPage(pageCount)}
            >
              最后一页
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
