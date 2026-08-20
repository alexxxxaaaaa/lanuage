import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, ButtonGroup, Card, Chip, ProgressCircle, Spinner, toast } from '@heroui/react'
import { confirm } from '../components/ui/dialog'
import { Link, useSearchParams } from 'react-router'
import { ChevronLeft, ChevronRight, Eye, EyeOff, FileText, Star } from 'lucide-react'
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
import { getTranscript, TranscriptMissingError, transcriptUrlOf } from '../api/transcript'
import { HyperTranscript, type Transcript } from '../components/HyperTranscript'
import { QbankText } from '../components/QbankText'
import { usePageActive, usePageTitle } from '../components/layout/pageContext'
import {
  hasPlaceholderOptions,
  isImageOnlyPassage,
  mondaiLabel,
  mondaiMeta,
  paperLabel,
} from './jlpt/constants'
import { AiExplainBlock, AiExplainButton } from './jlpt/AiExplain'
import { useAiExplain } from './jlpt/useAiExplain'
import { DisputeChip, DisputeNotice } from './jlpt/Dispute'
import { ExplainText } from './jlpt/ExplainText'
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
  const liveFilterKey = params.toString()
  if (isActive && filterKey !== liveFilterKey) setFilterKey(liveFilterKey)
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
  // AI 解析的生成状态。刻意不随换组清空 —— 缓存在服务端是全局的，
  // 同一道题的解析对谁、对哪一组都是同一份，留着还省一次请求。
  const ai = useAiExplain()
  const inFlight = useRef(new Set<string>())
  // 取正文失败的 id。放 state 不放 ref：预取 effect 要靠它跳过，
  // 渲染要靠它显示重试按钮，两边必须看到同一份。
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set())
  // 文字稿模式：只放音频和逐词同步的原文，题目和选项都收起来，用来精听。
  // 跟着人走而不是跟着题走 —— 在这个模式下翻页应该继续看下一题的文字稿。
  const [isTranscriptMode, setIsTranscriptMode] = useState(false)
  // 连着 url 一起存：翻页时不用先把它清空（那是 effect 里的同步 setState，
  // 会多跑一轮渲染），渲染时比对 url 就知道手上这份属不属于当前题。
  const [loaded, setLoaded] = useState<{
    url: string
    data: Transcript | null
    error: string | null
  } | null>(null)

  const title = setTitleOf(filter)
  usePageTitle('/jlpt/practice', title)

  // 换一组题：目录、正文缓存、进度全部重来。
  useEffect(() => {
    let cancelled = false
    async function loadSet() {
      setIsLoading(true)
      setItems([])
      setDetails({})
      setHidden(new Set())
      setFailed(new Set())
      setPeekId(null)
      inFlight.current.clear()
      try {
        const { items: rows } = await getQbankSet(filter)
        if (cancelled) return
        setItems(rows)
        // 收藏/错题是拿来重做的，先把旧答案盖上。
        if (filter.scope !== 'all') {
          setHidden(new Set(rows.filter((r) => r.status !== null).map((r) => r.id)))
        }
        // 从第一道没做过的题开始，做过一半的组能接着往下做。
        const firstUndone = rows.findIndex((r) => r.status === null)
        setIndex(firstUndone >= 0 ? firstUndone : 0)
      } catch (e) {
        if (!cancelled) toast.danger(getErrorMessage(e, '加载题目失败'))
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    void loadSet()
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

  // 这一题有没有文字稿可看。R2 上的对象名由 audioUrl 推出来，所以只认听力题。
  const transcriptUrl = question?.audioUrl ? transcriptUrlOf(question.audioUrl) : null

  // 进了文字稿模式才拉，翻页时跟着当前题换。
  const audioUrl = question?.audioUrl
  useEffect(() => {
    if (!isTranscriptMode || !transcriptUrl || !audioUrl) return

    const controller = new AbortController()
    getTranscript(audioUrl, controller.signal)
      .then((data) => setLoaded({ url: transcriptUrl, data, error: null }))
      .catch((e) => {
        if (controller.signal.aborted) return
        setLoaded({
          url: transcriptUrl,
          data: null,
          error:
            e instanceof TranscriptMissingError ? e.message : getErrorMessage(e, '文字稿加载失败'),
        })
      })

    return () => controller.abort()
  }, [isTranscriptMode, transcriptUrl, audioUrl])

  // 只认属于当前题的那一份，翻页后旧数据自动失效，不用手动清。
  const transcript = loaded?.url === transcriptUrl ? loaded.data : null
  const transcriptError = loaded?.url === transcriptUrl ? loaded.error : null

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
  // 这一轮生成的优先，否则用正文一起下发的那份全局缓存。
  const aiExplain = question ? (ai.generated[question.id] ?? question.aiExplain) : null
  const isAiPending = !!question && ai.pending.has(question.id)

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
  // 翻到没有文字稿的题（笔试题、音频缺失的听力题）时自动退回常规视图，
  // 模式本身不关 —— 再翻回有文字稿的题还是文字稿。
  const showTranscript = isTranscriptMode && !!transcriptUrl
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

  // 文字稿模式的整块内容：播放器 + 逐词同步原文。题目和选项都不出现 ——
  // 这个模式是拿来精听的，看得见选项就变成做题了。
  const transcriptPanel = (
    <Card className="gap-3" render={(props) => <article {...props} />}>
      <div className="flex items-center justify-between gap-2">
        <p className="m-0 text-xs font-semibold text-accent">文字稿</p>
        {question ? (
          <p className="muted m-0 text-xs">
            {paperLabel(question.year, question.month)} · {question.seq}
          </p>
        ) : null}
      </div>
      {transcriptError ? (
        <p className="muted m-0 text-sm">{transcriptError}</p>
      ) : !transcript ? (
        <div className={LOADING}>
          <Spinner />
        </div>
      ) : (
        <HyperTranscript audioSrc={question?.audioUrl ?? ''} transcript={transcript} />
      )}
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
              {showTranscript ? transcriptPanel : null}

              {!showTranscript && showPassage && question.passage ? (
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

              {/* 文字稿模式自带播放器，别在上面再挂一个抢着放同一段音频。 */}
              {!showTranscript && isListening ? (
                question.audioUrl ? (
                  <audio className="h-10 w-full" controls preload="none" src={question.audioUrl} />
                ) : (
                  <p className="muted mt-1.5 mb-0 text-xs">
                    这一题的音频源站缺失，可以先看下面的原文。
                  </p>
                )
              ) : null}

              {showTranscript ? null : (
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
                    <div className="grid gap-2.5 border-t border-separator pt-3.5">
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
                          <ExplainText text={question.stemZh} />
                        </div>
                      ) : null}
                      {question.explain ? (
                        <div className={EXPLAIN_BLOCK}>
                          <p className={EXPLAIN_LABEL}>{isListening ? '原文 / 译文' : '解析'}</p>
                          <ExplainText text={question.explain} />
                        </div>
                      ) : null}
                      <AiExplainBlock
                        altAnswer={question.altAnswer}
                        answer={question.answer}
                        explain={aiExplain}
                        isPending={isAiPending}
                        selected={question.selected}
                        onRegenerate={() => void ai.run(question.id, true)}
                      />
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
              )}

              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <ButtonGroup size="sm" variant="outline">
                  <Button onPress={() => void toggleFavorite()}>
                    <Star
                      className={question.favorite ? 'fill-current text-gold' : ''}
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
                  {/* 只有听力题才有文字稿，笔试题不给入口。 */}
                  {transcriptUrl ? (
                    <Button
                      className={showTranscript ? 'bg-accent-soft text-accent' : ''}
                      onPress={() => setIsTranscriptMode((v) => !v)}
                    >
                      <ButtonGroup.Separator />
                      <FileText aria-hidden />
                      {showTranscript ? '收起文字稿' : '文字稿'}
                    </Button>
                  ) : null}
                  {/* 听力题不生成：题干在音频里，文字侧只有設問，AI 看不到该看的。 */}
                  {canAiExplain ? (
                    <AiExplainButton
                      hasExplain={!!aiExplain}
                      isLocked={!showAnswer}
                      isPending={isAiPending}
                      withSeparator
                      onPress={() => void ai.run(question.id)}
                    />
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

              {/* 灰着的按钮不解释自己为什么灰。这行只在「能生成、但还没揭晓」时出现。 */}
              {canAiExplain && !showAnswer ? (
                <p className="muted m-0 -mt-1 text-xs">
                  AI 解析里有正确答案，作答或点「答案」之后才能生成。
                </p>
              ) : null}
            </>
          )}
        </div>

        {answerCard}
      </div>
    </section>
  )
}
