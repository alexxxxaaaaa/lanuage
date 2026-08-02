import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Spinner, toast } from '@heroui/react'
import { confirm } from '../components/ui/dialog'
import { Link, useSearchParams } from 'react-router'
import { Star } from 'lucide-react'
import {
  clearQbankAttempts,
  getQbankQuestions,
  getQbankSet,
  setQbankFavorite,
  submitQbankAttempt,
  type QbankQuestion,
  type QbankScope,
  type QbankSetFilter,
  type QbankSetItem,
} from '../api/qbank'
import { getErrorMessage } from '../api/error'
import { QbankText } from '../components/QbankText'
import { useTab } from '../components/TabContext'
import { mondaiLabel, mondaiMeta, paperLabel } from './jlpt/constants'

// 正文按需取：当前题往后预取这么多道，够连着做十几题不卡顿，
// 又不会为「問題9 全年份」那种 270 题的集合一次拉 1 MB 正文。
const PREFETCH = 8

function parseFilter(params: URLSearchParams): QbankSetFilter {
  const num = (key: string) => {
    const v = Number(params.get(key))
    return Number.isInteger(v) && v > 0 ? v : undefined
  }
  const scope = params.get('scope')
  return {
    category: params.get('category') ?? undefined,
    mondaiNo: num('mondaiNo'),
    year: num('year'),
    month: num('month'),
    scope: scope === 'favorite' || scope === 'wrong' ? (scope as QbankScope) : 'all',
  }
}

function setTitleOf(filter: QbankSetFilter): string {
  if (filter.scope === 'favorite') return '收藏练习'
  if (filter.scope === 'wrong') return '错题练习'
  if (!filter.category || !filter.mondaiNo) return 'JLPT 精练'
  const meta = mondaiMeta(filter.category, filter.mondaiNo)
  const paper = filter.year && filter.month ? ` · ${paperLabel(filter.year, filter.month)}` : ''
  return `${mondaiLabel(filter.category, filter.mondaiNo)} ${meta.type}${paper}`
}

/** 即時応答（聴解4）的选项在卷面上本就不印，源数据存的是 "1"/"2"/"3" 占位符。 */
function hasPlaceholderOptions(options: string[]): boolean {
  return options.length > 0 && options.every((o, i) => o.trim() === String(i + 1))
}

// 答题卡里的统计胶囊。
const STAT = 'rounded-full px-2.5 py-0.5 text-xs'
const STAT_TONE = {
  correct: 'bg-success/16 text-green-700',
  wrong: 'bg-danger/16 text-red-700',
  none: 'bg-foreground/6 text-muted',
} as const

// 题号点阵。aspect-square + min-h-0 是为了压掉全局 button 的 44px 最小高度。
const DOT =
  'aspect-square min-h-0 cursor-pointer rounded-full border p-0 text-xs tabular-nums'
const DOT_TONE = {
  correct: 'border-success bg-success text-white',
  wrong: 'border-danger bg-danger text-white',
  none: 'border-border bg-foreground/5 text-muted',
} as const

// 选项按钮同样要覆盖全局 button：左对齐（不是 center）、正文字重（不是 600）、
// 不吃 44px 最小高度。
const OPTION =
  'flex w-full min-h-0 items-start justify-start gap-2.5 rounded-[10px] border px-3.5 py-2.5 text-left text-[15px]/[1.7] font-normal'
const OPTION_NUM =
  'mt-0.5 inline-flex size-[22px] shrink-0 items-center justify-center rounded-full border text-xs'
const OPTION_TAG = 'ml-auto shrink-0 self-center rounded-full px-2 py-0.5 text-[11px]'

// 纯文字按钮（清空答题卡 / 再做一次），同样要脱掉全局 button 的外形。
const LINK_BUTTON =
  'min-h-0 cursor-pointer border-none bg-transparent p-0 text-[13px] text-accent'

const EXPLAIN_LABEL = 'mt-0 mb-0.5 text-xs font-semibold whitespace-normal text-accent'
const EXPLAIN_BLOCK = 'multiline-text text-sm/[1.85] text-foreground'
const LOADING = 'grid place-items-center py-12'

export function JlptPracticePage() {
  const [params] = useSearchParams()
  const { isActive, setTitle } = useTab()

  // 这个页面是 singleton tab：换一组题练习时，tab 路径变、组件不重建。
  // 但后台 tab 读到的 useSearchParams 是浏览器地址栏（别的 tab 的），
  // 所以只在自己是前台 tab 时才认这份参数。
  const [filterKey, setFilterKey] = useState(() => params.toString())
  useEffect(() => {
    if (isActive) setFilterKey(params.toString())
  }, [isActive, params])
  const filter = useMemo(() => parseFilter(new URLSearchParams(filterKey)), [filterKey])

  const [items, setItems] = useState<QbankSetItem[]>([])
  const [details, setDetails] = useState<Record<string, QbankQuestion>>({})
  const [index, setIndex] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isGridOpen, setIsGridOpen] = useState(false)
  // 暂时藏起答案的题：收藏/错题练习进来就是要重做的，一进去别直接把答案摊开；
  // 「再做一次」也是往这里塞。作答后自动移出。
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const inFlight = useRef(new Set<string>())
  // 取正文失败的 id。放 state 不放 ref：预取 effect 要靠它跳过，
  // 渲染要靠它显示重试按钮，两边必须看到同一份。
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set())

  const title = setTitleOf(filter)
  useEffect(() => setTitle(title), [title, setTitle])

  // 换一组题：目录、正文缓存、进度全部重来。
  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setItems([])
    setDetails({})
    setHidden(new Set())
    setFailed(new Set())
    inFlight.current.clear()
    getQbankSet(filter)
      .then(({ items: rows }) => {
        if (cancelled) return
        setItems(rows)
        // 收藏/错题是拿来重做的，先把旧答案盖上。
        if (filter.scope !== 'all') {
          setHidden(new Set(rows.filter((r) => r.status !== null).map((r) => r.id)))
        }
        // 从第一道没做过的题开始，做过一半的组能接着往下做。
        const firstUndone = rows.findIndex((r) => r.status === null)
        setIndex(firstUndone >= 0 ? firstUndone : 0)
      })
      .catch((e) => toast.danger(getErrorMessage(e, '加载题目失败')))
      .finally(() => !cancelled && setIsLoading(false))
    return () => {
      cancelled = true
    }
  }, [filter])

  // 保证 [index-1, index+PREFETCH) 的正文都在缓存里。
  useEffect(() => {
    if (items.length === 0) return
    const nearby = items.slice(Math.max(0, index - 1), index + PREFETCH)
    const missing = nearby
      .map((i) => i.id)
      .filter((id) => !details[id] && !inFlight.current.has(id) && !failed.has(id))
    if (missing.length === 0) return
    for (const id of missing) inFlight.current.add(id)
    getQbankQuestions(missing)
      .then((rows) => {
        const returned = new Set(rows.map((r) => r.id))
        const gone = missing.filter((id) => !returned.has(id))
        if (gone.length) setFailed((prev) => new Set([...prev, ...gone]))
        setDetails((prev) => {
          const next = { ...prev }
          for (const row of rows) next[row.id] = row
          return next
        })
      })
      .catch((e) => {
        setFailed((prev) => new Set([...prev, ...missing]))
        toast.danger(getErrorMessage(e, '加载题目失败'))
      })
      .finally(() => {
        for (const id of missing) inFlight.current.delete(id)
      })
  }, [items, index, details, failed])

  const current = items[index]
  const question = current ? details[current.id] : undefined

  const stats = useMemo(() => {
    let correct = 0
    let wrong = 0
    for (const i of items) {
      if (i.status === 'correct') correct += 1
      else if (i.status === 'wrong') wrong += 1
    }
    const answered = correct + wrong
    return {
      correct,
      wrong,
      answered,
      untouched: items.length - answered,
      rate: answered > 0 ? Math.round((correct / answered) * 100) : 0,
    }
  }, [items])

  // 「已作答」= 有记录且没被盖住。盖住的（收藏/错题重做、点了再做一次）
  // 仍然可以选，选完覆盖旧记录。
  const revealed = !!question && question.status !== null && !hidden.has(question.id)

  const pick = useCallback(
    async (selected: number) => {
      if (!current || !question) return
      if (question.status !== null && !hidden.has(question.id)) return
      try {
        const { isCorrect } = await submitQbankAttempt(current.id, selected)
        const status = isCorrect ? 'correct' : 'wrong'
        setDetails((prev) => ({ ...prev, [current.id]: { ...question, status, selected } }))
        setItems((prev) => prev.map((it) => (it.id === current.id ? { ...it, status } : it)))
        setHidden((prev) => {
          if (!prev.has(current.id)) return prev
          const next = new Set(prev)
          next.delete(current.id)
          return next
        })
      } catch (e) {
        toast.danger(getErrorMessage(e, '提交失败'))
      }
    },
    [current, question, hidden],
  )

  const retry = () => {
    if (!current) return
    setHidden((prev) => new Set(prev).add(current.id))
  }

  const toggleFavorite = async () => {
    if (!current || !question) return
    const next = !question.favorite
    try {
      await setQbankFavorite(current.id, next)
      setDetails((prev) => ({ ...prev, [current.id]: { ...question, favorite: next } }))
      setItems((prev) => prev.map((it) => (it.id === current.id ? { ...it, favorite: next } : it)))
      toast.success(next ? '已收藏' : '已取消收藏')
    } catch (e) {
      toast.danger(getErrorMessage(e, '操作失败'))
    }
  }

  const clearCard = async () => {
    const ok = await confirm({
      title: '清空答题卡？',
      content: `会删掉这一组里 ${stats.answered} 道题的作答记录，题目本身不变。`,
      okText: '清空',
      cancelText: '取消',
      status: 'warning',
    })
    if (!ok) return
    try {
      await clearQbankAttempts(filter)
      setItems((prev) => prev.map((it) => ({ ...it, status: null })))
      setDetails((prev) => {
        const next: Record<string, QbankQuestion> = {}
        for (const [id, q] of Object.entries(prev)) {
          next[id] = { ...q, status: null, selected: null }
        }
        return next
      })
      setHidden(new Set())
      setIndex(0)
    } catch (e) {
      toast.danger(getErrorMessage(e, '清空失败'))
    }
  }

  // 键盘：1–4 选项，←/→ 翻题。只在前台 tab 生效，后台 tab 仍然挂载着。
  const optionCount = question?.options.length ?? 0
  useEffect(() => {
    if (!isActive) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target
      if (target instanceof HTMLElement && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, items.length - 1))
      else if (e.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0))
      // 即時応答只有 3 个选项，别让「4」发出一个必然被拒的请求
      else if (/^[1-4]$/.test(e.key) && Number(e.key) <= optionCount) void pick(Number(e.key))
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isActive, items.length, optionCount, pick])

  if (isLoading) {
    return (
      <section className="page">
        <div className={LOADING}>
          <Spinner />
        </div>
      </section>
    )
  }

  if (items.length === 0) {
    return (
      <section className="page">
        <div className="card state-card">
          <h3>这一组没有题目</h3>
          <p className="muted">
            {filter.scope === 'favorite'
              ? '还没有收藏任何题。'
              : filter.scope === 'wrong'
                ? '没有错题，说明都做对了。'
                : '筛选条件没有命中题目。'}
          </p>
          <Link className="button button--primary" to="/jlpt">
            返回题库
          </Link>
        </div>
      </section>
    )
  }

  const isListening = question?.category === 'listening'
  // 听力题的「原文」既可能在 explain（纳豆卷），也可能在 passage（2025 两套），
  // 两者都是答案的一部分，作答前不能露。
  const showPassage = question?.passage && (!isListening || revealed)
  const meta = current ? mondaiMeta(current.category, current.mondaiNo) : null

  const answerCard = (
    // ≤900px 时右栏塌到题目上方并吸顶，做题时始终看得到得分。
    <aside className="sticky top-4 z-[5] grid gap-2.5 rounded-2xl border border-border bg-surface p-4 shadow-card max-[900px]:top-2 max-[900px]:order-first">
      <div className="flex items-center justify-between">
        <h3 className="m-0 text-[15px]">答题卡</h3>
        <Button type="button" className={LINK_BUTTON} onPress={clearCard}>
          清空
        </Button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <span className={`${STAT} ${STAT_TONE.correct}`}>正确 {stats.correct}</span>
        <span className={`${STAT} ${STAT_TONE.wrong}`}>错误 {stats.wrong}</span>
        <span className={`${STAT} ${STAT_TONE.none}`}>未做 {stats.untouched}</span>
      </div>
      <p className="m-0 text-xl tabular-nums text-foreground">
        <strong>
          {stats.correct}/{stats.answered}
        </strong>
        <span className="muted text-[13px]"> 正确率 {stats.rate}%</span>
      </p>
      <button
        type="button"
        className="hidden min-h-[34px] rounded-full border border-border bg-transparent text-[13px] text-foreground max-[900px]:block"
        onClick={() => setIsGridOpen((v) => !v)}
        aria-expanded={isGridOpen}
      >
        {isGridOpen ? '收起题号' : `展开题号（${items.length}）`}
      </button>
      <div
        className={`grid max-h-[42vh] grid-cols-5 gap-1.5 overflow-y-auto max-[900px]:max-h-[32vh] max-[900px]:grid-cols-8 ${
          isGridOpen ? '' : 'max-[900px]:hidden'
        }`}
      >
        {items.map((item, i) => (
          <button
            type="button"
            key={item.id}
            className={`${DOT} ${DOT_TONE[item.status ?? 'none']} ${
              i === index ? 'outline-2 outline-offset-1 outline-accent' : ''
            }`}
            title={`${paperLabel(item.year, item.month)} ${item.seq}`}
            onClick={() => setIndex(i)}
          >
            {i + 1}
          </button>
        ))}
      </div>
    </aside>
  )

  return (
    <section className="page">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">
            <Link to="/jlpt">← JLPT 精练</Link>
          </p>
          <h2>{title}</h2>
          {meta?.instruction ? (
            <p className="muted mt-1.5 mb-0 text-[13px]/[1.6]">{meta.instruction}</p>
          ) : null}
        </div>
        <div className="muted shrink-0 text-[13px] tabular-nums">
          第 {index + 1} / {items.length} 题
        </div>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)_250px] items-start gap-5 max-[900px]:grid-cols-1">
        <div className="grid min-w-0 gap-3.5">
          {!question ? (
            current && failed.has(current.id) ? (
              <div className="card state-card">
                <p className="muted">这道题的正文没能加载出来。</p>
                <Button
                  type="button"
                  onPress={() =>
                    setFailed((prev) => {
                      const next = new Set(prev)
                      next.delete(current.id)
                      return next
                    })
                  }
                >
                  重试
                </Button>
              </div>
            ) : (
              <div className={LOADING}>
                <Spinner />
              </div>
            )
          ) : (
            <>
              {showPassage && question.passage ? (
                <div className="max-h-[46vh] overflow-y-auto rounded-[14px] border-l-[3px] border-accent/40 bg-foreground/3 px-4.5 py-3.5 max-[900px]:max-h-[38vh]">
                  <p className="mt-0 mb-1.5 text-xs font-semibold text-accent">
                    {isListening ? '聴解原文' : question.passage.type || '本文'}
                  </p>
                  <QbankText
                    className="multiline-text text-[15px]/[1.9] text-foreground"
                    text={question.passage.content}
                  />
                </div>
              ) : null}

              {isListening ? (
                question.audioUrl ? (
                  <div>
                    <audio className="h-10 w-full" controls preload="none" src={question.audioUrl} />
                  </div>
                ) : (
                  <p className="muted mt-1.5 mb-0 text-xs">
                    这一题的音频源站缺失，可以先看下面的原文。
                  </p>
                )
              ) : null}

              <article className="rounded-2xl border border-border bg-surface px-5 py-4.5 shadow-card">
                <div className="flex items-start gap-2.5">
                  <span className="shrink-0 leading-[1.7] font-bold text-foreground">
                    {index + 1}.
                  </span>
                  <div className="multiline-text min-w-0 flex-1 text-base/[1.8] text-foreground">
                    <p className="muted mt-0 mb-1 text-xs whitespace-normal">
                      {paperLabel(question.year, question.month)} · {question.seq}
                    </p>
                    <QbankText text={question.stemJp} />
                  </div>
                  <button
                    type="button"
                    className={`min-h-0 shrink-0 cursor-pointer border-none bg-transparent px-1 text-lg ${
                      question.favorite ? 'text-amber-500' : 'text-foreground/25'
                    }`}
                    onClick={() => void toggleFavorite()}
                    title={question.favorite ? '取消收藏' : '收藏这道题'}
                  >
                    <Star fill={question.favorite ? 'currentColor' : 'none'} />
                  </button>
                </div>

                <ol className="m-0 mt-3.5 grid list-none gap-2 p-0">
                  {question.options.map((option, i) => {
                    const num = i + 1
                    const isAnswer = revealed && num === question.answer
                    const isWrong = revealed && question.selected === num && !isAnswer
                    return (
                      <li key={i}>
                        <Button
                          type="button"
                          className={`${OPTION} ${
                            isAnswer
                              ? 'border-success bg-success/12'
                              : isWrong
                                ? 'border-danger bg-danger/10'
                                : `border-border bg-surface text-foreground ${
                                    revealed
                                      ? 'cursor-default'
                                      : 'hover:border-accent hover:bg-accent/6'
                                  }`
                          }`}
                          isDisabled={revealed}
                          onPress={() => void pick(num)}
                        >
                          <span
                            className={`${OPTION_NUM} ${
                              isAnswer
                                ? 'border-success bg-success text-white'
                                : isWrong
                                  ? 'border-danger bg-danger text-white'
                                  : 'border-border'
                            }`}
                          >
                            {num}
                          </span>
                          {hasPlaceholderOptions(question.options) ? (
                            <span className="muted">（选项由音频念出）</span>
                          ) : (
                            <QbankText
                              className="min-w-0 flex-1 [overflow-wrap:anywhere]"
                              text={option}
                            />
                          )}
                          {isAnswer ? (
                            <span className={`${OPTION_TAG} bg-success/20 text-green-700`}>
                              正确答案
                            </span>
                          ) : null}
                          {isWrong ? (
                            <span className={`${OPTION_TAG} bg-danger/16 text-red-700`}>
                              你的选择
                            </span>
                          ) : null}
                        </Button>
                      </li>
                    )
                  })}
                </ol>

                {revealed ? (
                  <div className="mt-4 grid gap-2.5 border-t border-dashed border-border pt-3.5">
                    <p
                      className={`m-0 flex items-center gap-3 font-bold ${
                        question.status === 'correct' ? 'text-green-700' : 'text-red-700'
                      }`}
                    >
                      {question.status === 'correct' ? '✓ 答对了' : '✗ 答错了'}
                      <Button type="button" className={LINK_BUTTON} onPress={retry}>
                        再做一次
                      </Button>
                    </p>
                    {question.stemZh ? (
                      <div className={EXPLAIN_BLOCK}>
                        <p className={EXPLAIN_LABEL}>{isListening ? '設問' : '译文'}</p>
                        <QbankText text={question.stemZh} />
                      </div>
                    ) : null}
                    {question.explain ? (
                      <div className={EXPLAIN_BLOCK}>
                        <p className={EXPLAIN_LABEL}>{isListening ? '原文 / 译文' : '解析'}</p>
                        <QbankText text={question.explain} />
                      </div>
                    ) : null}
                    {question.dispute ? (
                      <p className="m-0 text-xs text-amber-700">⚠ {question.dispute}</p>
                    ) : null}
                  </div>
                ) : null}
              </article>

              <div className="flex justify-end gap-2.5">
                <Button variant="outline" size="sm"
                  type="button"
                  isDisabled={index === 0}
                  onPress={() => setIndex((i) => Math.max(0, i - 1))}
                >
                  上一题
                </Button>
                <Button
                  type="button"
                  isDisabled={index >= items.length - 1}
                  onPress={() => setIndex((i) => Math.min(items.length - 1, i + 1))}
                >
                  下一题
                </Button>
              </div>
            </>
          )}
        </div>

        {answerCard}
      </div>
    </section>
  )
}
