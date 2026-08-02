import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, ButtonGroup, Card, Chip, ProgressCircle, Spinner, toast } from '@heroui/react'
import { confirm } from '../components/ui/dialog'
import { Link, useSearchParams } from 'react-router'
import { ChevronLeft, ChevronRight, Eye, EyeOff, Sparkles, Star } from 'lucide-react'
import {
  clearQbankAttempts,
  generateQbankAiExplain,
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
import { usePageActive, usePageTitle } from '../components/layout/pageContext'
import {
  hasPlaceholderOptions,
  isImageOnlyPassage,
  mondaiLabel,
  mondaiMeta,
  paperLabel,
} from './jlpt/constants'
import { DisputeChip, DisputeNotice } from './jlpt/Dispute'
import {
  EXPLAIN_BLOCK,
  EXPLAIN_LABEL,
  OPTION,
  OPTION_NUM,
  OPTION_ROLE_COLOR,
  OPTION_ROLE_LABEL,
  OPTION_TAG,
  OPTION_TONE,
  PASSAGE_BOX,
  optionRole,
} from './jlpt/styles'

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
  if (!filter.category || !filter.mondaiNo) return 'JLPT'
  const meta = mondaiMeta(filter.category, filter.mondaiNo)
  const paper = filter.year && filter.month ? ` · ${paperLabel(filter.year, filter.month)}` : ''
  return `${mondaiLabel(filter.category, filter.mondaiNo)} ${meta.type}${paper}`
}

// 题号点阵。HeroUI 的 .button 是固定 h-10/w-fit 的胶囊，这里要的是小圆点，
// 所以宽高一起写死（之前用 aspect-square 让浏览器自己算，网格行高算不出来，
// 圆圈就叠在一起了）。对错配色用 utility 覆盖 .button 的背景 —— utilities
// 层压得过 components 层，不用 !important。
const DOT = 'size-9 rounded-full p-0 text-xs tabular-nums md:size-8'
const DOT_TONE = {
  correct: 'bg-success text-success-foreground hover:bg-success-hover',
  wrong: 'bg-danger text-danger-foreground hover:bg-danger-hover',
  none: '',
} as const

const LOADING = 'grid place-items-center py-12'

export function JlptPracticePage() {
  const [params] = useSearchParams()
  const isActive = usePageActive()

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
  // 「答案」按钮直接摊开答案的那道题，同时只记一道。偷看不写作答记录：
  // 答题卡里这题仍然算未做，选项也还能点，选了就照常判对错。
  const [peekId, setPeekId] = useState<string | null>(null)
  // 正在生成 AI 解析的题。按 id 记而不是只记一道：生成时还能翻页，
  // 先回来的那个不该把另一道的 loading 一起清掉。
  const [aiPending, setAiPending] = useState<ReadonlySet<string>>(new Set())
  const inFlight = useRef(new Set<string>())
  // 取正文失败的 id。放 state 不放 ref：预取 effect 要靠它跳过，
  // 渲染要靠它显示重试按钮，两边必须看到同一份。
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set())

  const title = setTitleOf(filter)
  usePageTitle('/jlpt/practice', title)

  // 换一组题：目录、正文缓存、进度全部重来。
  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    setItems([])
    setDetails({})
    setHidden(new Set())
    setFailed(new Set())
    setPeekId(null)
    setAiPending(new Set())
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
  const isPeeking = !!question && peekId === question.id
  const showAnswer = revealed || isPeeking
  const isAiPending = !!question && aiPending.has(question.id)

  const pick = useCallback(
    async (selected: number) => {
      if (!current || !question) return
      if (question.status !== null && !hidden.has(question.id)) return
      try {
        const { isCorrect } = await submitQbankAttempt(current.id, selected)
        const status = isCorrect ? 'correct' : 'wrong'
        setDetails((prev) => ({ ...prev, [current.id]: { ...question, status, selected } }))
        setItems((prev) => prev.map((it) => (it.id === current.id ? { ...it, status } : it)))
        setPeekId(null)
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

  /** refresh 会重算并覆盖所有人看到的那一份，所以只挂在「重新生成」上。 */
  const runAiExplain = async (refresh = false) => {
    if (!current) return
    const id = current.id
    setAiPending((prev) => new Set(prev).add(id))
    try {
      const aiExplain = await generateQbankAiExplain(id, refresh)
      setDetails((prev) => {
        const row = prev[id]
        return row ? { ...prev, [id]: { ...row, aiExplain } } : prev
      })
    } catch (e) {
      toast.danger(getErrorMessage(e, '生成 AI 解析失败'))
    } finally {
      setAiPending((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
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
      setPeekId(null)
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
  // 听力（题干在音频里）和情報検索（材料是整张图）AI 都看不到该看的东西，不给入口。
  const canAiExplain =
    !!question && !isListening && !isImageOnlyPassage(question.passage?.content ?? '')
  // 听力题的「原文」既可能在 explain（纳豆卷），也可能在 passage（2025 两套），
  // 两者都是答案的一部分，作答前不能露。
  const showPassage = question?.passage && (!isListening || showAnswer)
  const meta = current ? mondaiMeta(current.category, current.mondaiNo) : null

  const answerCard = (
    // ≤900px 时右栏塌到题目上方并吸顶，做题时始终看得到得分。
    <Card
      className="sticky top-4 z-[5] gap-2.5 p-4 max-[900px]:top-2 max-[900px]:order-first"
      render={(props) => <aside {...props} />}
    >
      <Card.Header className="flex-row items-center justify-between gap-2">
        <Card.Title className="text-[15px]">答题卡</Card.Title>
        <Button size="sm" variant="ghost" onPress={clearCard}>
          清空
        </Button>
      </Card.Header>
      <Card.Content className="gap-2.5">
        <div className="flex flex-wrap gap-1.5">
          <Chip color="success" variant="soft">
            正确 {stats.correct}
          </Chip>
          <Chip color="danger" variant="soft">
            错误 {stats.wrong}
          </Chip>
          <Chip>未做 {stats.untouched}</Chip>
        </div>
        <div className="flex items-center gap-3">
          {/* 圆环是做题进度（已答/总数），旁边的数字是对错。 */}
          <ProgressCircle
            aria-label="作答进度"
            maxValue={items.length}
            size="lg"
            value={stats.answered}
          >
            <ProgressCircle.Track>
              <ProgressCircle.TrackCircle />
              <ProgressCircle.FillCircle />
            </ProgressCircle.Track>
          </ProgressCircle>
          <div>
            <p className="m-0 text-lg font-bold tabular-nums text-foreground">
              {stats.correct}/{stats.answered}
            </p>
            <p className="muted m-0 text-xs tabular-nums">
              正确率 {stats.rate}% · 共 {items.length} 题
            </p>
          </div>
        </div>
        <Button
          className="hidden max-[900px]:flex"
          size="sm"
          variant="outline"
          aria-expanded={isGridOpen}
          onPress={() => setIsGridOpen((v) => !v)}
        >
          {isGridOpen ? '收起题号' : `展开题号（${items.length}）`}
        </Button>
        {/* auto-fill 让题号跟着栏宽排，窄屏塌成整行时自动多排几列。 */}
        <div
          className={`grid max-h-[42vh] grid-cols-[repeat(auto-fill,minmax(2.25rem,1fr))] justify-items-center gap-1.5 overflow-y-auto max-[900px]:max-h-[32vh] ${
            isGridOpen ? '' : 'max-[900px]:hidden'
          }`}
        >
          {items.map((item, i) => (
            <Button
              key={item.id}
              size="sm"
              variant="tertiary"
              className={`${DOT} ${DOT_TONE[item.status ?? 'none']} ${
                i === index ? 'outline-2 outline-offset-1 outline-accent' : ''
              }`}
              render={(props) => (
                <button {...props} title={`${paperLabel(item.year, item.month)} ${item.seq}`} />
              )}
              onPress={() => setIndex(i)}
            >
              {i + 1}
            </Button>
          ))}
        </div>
      </Card.Content>
    </Card>
  )

  return (
    <section className="page">
      <header className="flex items-start justify-between gap-4">
        <div>
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
                <div className={`${PASSAGE_BOX} max-h-[46vh] overflow-y-auto max-[900px]:max-h-[38vh]`}>
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
                  <audio className="h-10 w-full" controls preload="none" src={question.audioUrl} />
                ) : (
                  <p className="muted mt-1.5 mb-0 text-xs">
                    这一题的音频源站缺失，可以先看下面的原文。
                  </p>
                )
              ) : null}

              <Card render={(props) => <article {...props} />}>
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
                  {/* 作答前就挂出来：这题的答案本身有争议，值得先知道。 */}
                  {question.altAnswer > 0 ? <DisputeChip /> : null}
                </div>

                <ol className="m-0 grid list-none gap-2 p-0">
                  {question.options.map((option, i) => {
                    const num = i + 1
                    const role = showAnswer
                      ? optionRole(num, {
                          answer: question.answer,
                          altAnswer: question.altAnswer,
                          selected: question.selected,
                        })
                      : null
                    return (
                      <li key={i}>
                        <Button
                          variant="outline"
                          className={`${OPTION} ${role ? OPTION_TONE[role] : OPTION_TONE.idle}`}
                          isDisabled={revealed}
                          onPress={() => void pick(num)}
                        >
                          <span className={OPTION_NUM}>{num}</span>
                          {hasPlaceholderOptions(question.options) ? (
                            <span className="muted">（选项由音频念出）</span>
                          ) : (
                            <QbankText
                              className="min-w-0 flex-1 [overflow-wrap:anywhere]"
                              text={option}
                            />
                          )}
                          {role ? (
                            <Chip
                              className={OPTION_TAG}
                              color={OPTION_ROLE_COLOR[role]}
                              variant="soft"
                            >
                              {OPTION_ROLE_LABEL[role]}
                            </Chip>
                          ) : null}
                        </Button>
                      </li>
                    )
                  })}
                </ol>

                {showAnswer ? (
                  <div className="grid gap-2.5 border-t border-dashed border-border pt-3.5">
                    {revealed ? (
                      <div className="flex items-center gap-3">
                        <Chip
                          color={question.status === 'correct' ? 'success' : 'danger'}
                          variant="soft"
                        >
                          {question.status === 'correct' ? '✓ 答对了' : '✗ 答错了'}
                        </Chip>
                        <Button size="sm" variant="ghost" onPress={retry}>
                          再做一次
                        </Button>
                      </div>
                    ) : (
                      <Chip color="warning" variant="soft">
                        已显示答案 · 不计入成绩
                      </Chip>
                    )}
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
                    {question.aiExplain || isAiPending ? (
                      <div className={EXPLAIN_BLOCK}>
                        <div className="mb-0.5 flex items-center gap-2">
                          <p className={`${EXPLAIN_LABEL} mb-0`}>AI 解析</p>
                          {question.aiExplain && !isAiPending ? (
                            <Button
                              className="h-auto px-1.5 py-0 text-xs font-normal"
                              size="sm"
                              variant="ghost"
                              onPress={() => void runAiExplain(true)}
                            >
                              重新生成
                            </Button>
                          ) : null}
                        </div>
                        {isAiPending ? (
                          <p className="muted m-0 flex items-center gap-2 text-sm">
                            <Spinner size="sm" />
                            正在生成…
                          </p>
                        ) : (
                          <>
                            {question.aiExplain?.summary ? (
                              <p className="m-0">{question.aiExplain.summary}</p>
                            ) : null}
                            <ol className="m-0 mt-1 grid list-none gap-1 p-0">
                              {question.aiExplain?.options.map((text, i) =>
                                text ? (
                                  <li key={i} className="flex gap-2">
                                    <span className={OPTION_NUM}>{i + 1}</span>
                                    <span className="min-w-0 flex-1">{text}</span>
                                  </li>
                                ) : null,
                              )}
                            </ol>
                          </>
                        )}
                      </div>
                    ) : null}
                    {question.altAnswer > 0 ? (
                      <DisputeNotice
                        answer={question.answer}
                        altAnswer={question.altAnswer}
                        note={question.disputeNote}
                      />
                    ) : null}
                  </div>
                ) : null}
              </Card>

              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <ButtonGroup size="sm" variant="outline">
                  <Button onPress={() => void toggleFavorite()}>
                    <Star
                      className={question.favorite ? 'fill-current text-amber-500' : ''}
                      aria-hidden
                    />
                    {question.favorite ? '已收藏' : '收藏'}
                  </Button>
                  <Button
                    isDisabled={revealed}
                    onPress={() => setPeekId(isPeeking ? null : question.id)}
                  >
                    <ButtonGroup.Separator />
                    {isPeeking ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                    {isPeeking ? '收起答案' : '答案'}
                  </Button>
                  {/* 听力题不生成：题干在音频里，文字侧只有設問，AI 看不到该看的。 */}
                  {canAiExplain ? (
                    <Button
                      // 没揭晓就生成等于剧透，所以跟着解析区一起解锁；
                      // 已经有解析了就停用，重算走下面那块里的「重新生成」。
                      isDisabled={!showAnswer || isAiPending || !!question.aiExplain}
                      onPress={() => void runAiExplain()}
                    >
                      <ButtonGroup.Separator />
                      <Sparkles aria-hidden />
                      {isAiPending ? '生成中…' : 'AI 解析'}
                    </Button>
                  ) : null}
                </ButtonGroup>
                <ButtonGroup size="sm" variant="outline">
                  <Button isDisabled={index === 0} onPress={() => setIndex((i) => i - 1)}>
                    <ChevronLeft aria-hidden />
                    上一题
                  </Button>
                  <Button
                    isDisabled={index >= items.length - 1}
                    onPress={() => setIndex((i) => i + 1)}
                  >
                    <ButtonGroup.Separator />
                    下一题
                    <ChevronRight aria-hidden />
                  </Button>
                </ButtonGroup>
              </div>
            </>
          )}
        </div>

        {answerCard}
      </div>
    </section>
  )
}
