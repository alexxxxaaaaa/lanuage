import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Card, Chip, Spinner, toast } from '@heroui/react'
import { Link, useParams } from 'react-router'

import {
  collectExamWrongQuestions,
  getExamState,
  saveExamAnswers,
  setExamPaused,
  submitExamPhase,
  type ExamPassage,
  type ExamQuestion,
  type ExamState,
} from '../api/qbankExam'
import { getErrorMessage } from '../api/error'
import { useI18n } from '../i18n'
import { confirm } from '../components/ui/dialog'
import { SegmentedControl } from '../components/ui/SegmentedControl'
import {
  useOnPageReactivated,
  usePageActive,
  usePageTitle,
} from '../components/layout/pageContext'
import { getStoredToken } from '../store/authStore'
import { ExamAnswerSheet } from './jlpt/ExamAnswerSheet'
import { ExamListeningPlayer, type ListeningSegment } from './jlpt/ExamListeningPlayer'
import { ExamQuestionList } from './jlpt/ExamQuestionList'
import { ExamScoreCard } from './jlpt/ExamScoreCard'
import {
  formatClock,
  isAcceptedAnswer,
  paperLabel,
  questionDomId,
} from './jlpt/constants'

/**
 * 模拟考试：一套真题从头考到尾。
 *
 * 三个阶段一条道走到黑，阶段由服务端的时间戳决定，前端只是照着渲染：
 *   written   笔试（文字・語彙 / 文法 / 読解），110 分倒计时
 *   listening 听力，整段录音连着播
 *   done      成绩 + 全卷解析
 *
 * 前两块谁先谁后看 state.sectionOrder（开考时定格）。先听力时笔试的钟从听力
 * 交卷那一刻起算，这个起点由服务端算好放在 writtenStartedAt 里。
 *
 * 严格模式下倒计时归零、录音播完都会立刻自动交卷；自我评估模式两者都只提示，
 * 由用户自己按交卷。答案每次改动都会自动存回服务端，交卷后服务端拒绝再改。
 *
 * 笔试的钟可以暂停（110 分钟未必能一口气拿出来）。暂停状态存在服务端，所以
 * 关页面、换设备都停得住；暂停期间题目整个收起来，不然等于白送时间。
 */

// 作答改动后多久落库。太短会把整卷 JSON 打成连发请求，太长则关页面容易丢。
const AUTOSAVE_DEBOUNCE_MS = 1200
const LOADING = 'grid place-items-center py-12'

export function JlptExamPage() {
  const { year: yearParam, month: monthParam } = useParams<{ year: string; month: string }>()
  const year = Number(yearParam)
  const month = Number(monthParam)
  const isActive = usePageActive()

  const isValidPaper = Number.isInteger(year) && month >= 1 && month <= 12
  const [state, setState] = useState<ExamState | null>(null)
  const [answers, setAnswers] = useState<Record<string, number>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  // 已落库的那份答案，用来判断有没有新的改动要存。
  const savedRef = useRef('{}')
  // 关页面时的补救保存要读最新答案，但它挂在 window 上、拿不到当次渲染的闭包。
  const answersRef = useRef(answers)
  useEffect(() => {
    answersRef.current = answers
  }, [answers])

  usePageTitle(`/jlpt/exams/${year}/${month}`, `${paperLabel(year, month)} 模拟考试`)

  const applyState = useCallback((next: ExamState) => {
    setState(next)
    setAnswers(next.answers)
    savedRef.current = JSON.stringify(next.answers)
  }, [])

  // 一套卷一个页面实例（路由里带着年月），所以这个副作用一辈子只跑一次。
  useEffect(() => {
    if (!isValidPaper) return
    let cancelled = false
    getExamState(year, month)
      .then((next) => !cancelled && applyState(next))
      .catch((e) => !cancelled && setError(getErrorMessage(e, '加载考试失败')))
      .finally(() => !cancelled && setIsLoading(false))
    return () => {
      cancelled = true
    }
  }, [year, month, isValidPaper, applyState])

  // 这个页面是 keep-alive 的：在列表页重置过、或者在另一个标签页交了卷之后，
  // 挂在后台的这份会是旧的。回到前台时对一下服务端，换了一场才整份替换 ——
  // 同一场就别动，免得把还没落库的作答冲掉。
  useOnPageReactivated(() => {
    if (!state) return
    getExamState(year, month)
      .then((next) => {
        if (next.phase !== state.phase || next.startedAt !== state.startedAt) applyState(next)
      })
      .catch((e) => setError(getErrorMessage(e, '这场考试已经不在了')))
  })

  // 自动保存。只有存成功才更新 savedRef，失败就留着脏标记等下一次改动重发。
  const phase = state?.phase
  useEffect(() => {
    if (!phase || phase === 'done') return
    const serialized = JSON.stringify(answers)
    if (serialized === savedRef.current) return
    const timer = window.setTimeout(() => {
      saveExamAnswers(year, month, answers)
        .then(() => {
          savedRef.current = serialized
        })
        .catch(() => {
          // 交卷前还会 flush 一次，这里静默重试即可，不打扰考试。
        })
    }, AUTOSAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [answers, phase, year, month])

  // 关标签页时把没来得及存的答案补一发。axios 不支持 keepalive，用 fetch。
  useEffect(() => {
    const handler = () => {
      const serialized = JSON.stringify(answersRef.current)
      if (serialized === savedRef.current) return
      const token = getStoredToken()
      void fetch(`${import.meta.env.VITE_API_BASE_URL ?? ''}/api/qbank/exams/${year}/${month}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ answers: answersRef.current }),
        keepalive: true,
      }).catch(() => {
        // 页面正在关闭，没有补救余地。
      })
    }
    window.addEventListener('pagehide', handler)
    return () => window.removeEventListener('pagehide', handler)
  }, [year, month])

  const pick = useCallback((questionId: string, selected: number) => {
    setAnswers((prev) => ({ ...prev, [questionId]: selected }))
  }, [])

  const [isPausing, setIsPausing] = useState(false)
  const pause = useCallback(
    async (paused: boolean) => {
      setIsPausing(true)
      try {
        // 暂停前先把手上的改动落库：接下来可能直接关页面，debounce 等不到。
        const serialized = JSON.stringify(answersRef.current)
        if (paused && serialized !== savedRef.current) {
          await saveExamAnswers(year, month, answersRef.current)
          savedRef.current = serialized
        }
        applyState(await setExamPaused(year, month, paused))
      } catch (e) {
        toast.danger(getErrorMessage(e, paused ? '暂停失败' : '继续失败'))
      } finally {
        setIsPausing(false)
      }
    },
    [year, month, applyState],
  )

  const submit = useCallback(
    async (target: 'written' | 'listening') => {
      setIsSubmitting(true)
      try {
        // 先把最后的改动落库，再交卷 —— 交卷后服务端就不收答案了。
        const serialized = JSON.stringify(answersRef.current)
        if (serialized !== savedRef.current) {
          await saveExamAnswers(year, month, answersRef.current)
          savedRef.current = serialized
        }
        // 下一步是什么，以服务端返回的新阶段为准 —— 先考哪一块是开考时定格的，
        // 前端不必自己再推一遍。
        const next = await submitExamPhase(year, month, target)
        applyState(next)
        toast.success(
          next.phase === 'done'
            ? '已交卷，来看看成绩'
            : next.phase === 'listening'
              ? '笔试已交卷，进入听力'
              : '听力已交卷。笔试的表还没起，按「继续答题」再开始',
        )
      } catch (e) {
        toast.danger(getErrorMessage(e, '交卷失败'))
      } finally {
        setIsSubmitting(false)
      }
    },
    [year, month, applyState],
  )

  if (isLoading && isValidPaper) {
    return (
      <section className="page">
        <div className={LOADING}>
          <Spinner />
        </div>
      </section>
    )
  }

  if (error || !state) {
    return (
      <section className="page">
        <div className="card state-card">
          <h3>打不开这场考试</h3>
          <p className="muted">
            {error ?? (isValidPaper ? '这套卷子还没开考。' : '这个地址不是一套卷子。')}
          </p>
          <Link className="button button--primary" to="/jlpt">
            回 JLPT
          </Link>
        </div>
      </section>
    )
  }

  const shared = { state, answers, isSubmitting, onPick: pick, onSubmit: submit }
  if (state.phase === 'written')
    return <WrittenPhase {...shared} isPausing={isPausing} onPause={pause} />
  if (state.phase === 'listening') return <ListeningPhase {...shared} isPageActive={isActive} />
  return <ResultPhase state={state} answers={answers} />
}

// ===== 公共零件 =====

type PhaseProps = {
  state: ExamState
  answers: Record<string, number>
  isSubmitting: boolean
  onPick: (questionId: string, selected: number) => void
  onSubmit: (phase: 'written' | 'listening') => Promise<void>
}

/** 卷内题号：笔试和听力各自从 1 数起，与真题答题纸一致。 */
function useQuestionNumbers(questions: ExamQuestion[]): Map<string, number> {
  return useMemo(() => {
    const map = new Map<string, number>()
    let written = 0
    let listening = 0
    for (const q of questions) {
      map.set(q.id, q.category === 'listening' ? ++listening : ++written)
    }
    return map
  }, [questions])
}

function usePassageMap(passages: ExamPassage[]): Map<string, ExamPassage> {
  return useMemo(() => new Map(passages.map((p) => [p.id, p])), [passages])
}

function ExamHeader({
  state,
  subtitle,
  extra,
}: {
  state: ExamState
  subtitle: string
  extra?: string
}) {
  const { t } = useI18n()
  return (
    <header className="section-header">
      <div>
        <h2>{paperLabel(state.year, state.month)} 模拟考试</h2>
        <p className="muted mt-1 mb-0 text-[13px]">
          {subtitle}
          {extra ? ` · ${extra}` : ''} · {t(`jlpt.examMode.${state.mode}`)}
          {t('jlpt.examModeSuffix')}
          {/* 先听力是非默认顺序，标出来才知道这场的钟是怎么算的。 */}
          {state.sectionOrder === 'listening' ? ` · ${t('jlpt.examSectionOrder.listening')}` : ''}
        </p>
      </div>
      <Link className="button button--outline button--sm shrink-0" to="/jlpt">
        返回列表
      </Link>
    </header>
  )
}

const LAYOUT = 'grid grid-cols-[minmax(0,1fr)_260px] items-start gap-5 max-[900px]:grid-cols-1'

// ===== 笔试 =====

function WrittenPhase({
  state,
  answers,
  isSubmitting,
  isPausing,
  onPick,
  onPause,
  onSubmit,
}: PhaseProps & { isPausing: boolean; onPause: (paused: boolean) => Promise<void> }) {
  const numbers = useQuestionNumbers(state.questions)
  const passages = usePassageMap(state.passages)
  const [now, setNow] = useState(() => Date.now())
  const autoSubmittedRef = useRef(false)

  // 剩余时间全部由服务端的时间戳算：暂停时「现在」取 pausedAt，时钟就定在那一刻，
  // 刷新页面、过几天再打开，算出来都是同一个数。
  const pausedAt = state.pausedAt ? new Date(state.pausedAt).getTime() : null
  const isPaused = pausedAt !== null
  const elapsed = (pausedAt ?? now) - new Date(state.writtenStartedAt).getTime() - state.pausedMs
  const remaining = state.writtenMinutes * 60_000 - elapsed
  const isOvertime = remaining <= 0
  // 先听力时，笔试是从暂停态起步的（服务端在听力交卷那一刻就按下了暂停），
  // 表一秒没走过。这种「还没开始」和中途暂停该说不一样的话。
  const isFresh = isPaused && elapsed <= 0

  useEffect(() => {
    // 暂停时钟不走，这一秒一次的重渲染就没必要了。
    if (isPaused) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [isPaused])

  // 严格模式：时间一到直接交卷，不问。暂停中不触发 —— 哪怕暂停前就已经超时了，
  // 也等按「继续」再说，否则一打开页面就被交卷。
  useEffect(() => {
    if (state.mode !== 'strict' || isPaused || !isOvertime || autoSubmittedRef.current) return
    autoSubmittedRef.current = true
    toast.warning('时间到，已自动交卷')
    void onSubmit('written')
  }, [state.mode, isPaused, isOvertime, onSubmit])

  // 先听力的话，笔试就是最后一块，交完直接出分。
  const isLastSection = state.sectionOrder === 'listening'
  const submitLabel = isLastSection ? '交卷看成绩' : '交卷并开始听力'

  const handleSubmit = async () => {
    const unanswered = state.questions.length - Object.keys(answers).length
    const ok = await confirm({
      title: isLastSection ? '交卷？' : '交卷并开始听力？',
      content:
        (unanswered > 0 ? `还有 ${unanswered} 题没作答。` : '') +
        (isLastSection ? '交卷后即出成绩，答案不能再改。' : '交卷后笔试部分不能再修改，接着进入听力。'),
      okText: '交卷',
      cancelText: '继续答题',
      status: unanswered > 0 ? 'warning' : 'accent',
    })
    if (ok) await onSubmit('written')
  }

  return (
    <section className="page">
      <ExamHeader
        state={state}
        subtitle="言語知識（文字・語彙・文法）・読解"
        extra={`共 ${state.questions.length} 题 · 限时 ${state.writtenMinutes} 分`}
      />
      <div className={LAYOUT}>
        {/* 暂停时整块题目收起来。留在屏幕上的话，「暂停」就成了不限时读题，
            这个钟也就没有意义了。 */}
        {isPaused ? (
          <Card className="min-w-0 items-center gap-3 py-16 text-center">
            <p className="m-0 text-[15px] font-semibold text-foreground">
              {isFresh ? '笔试还没开始' : '计时已暂停'}
            </p>
            <p className="muted m-0 max-w-[32ch] text-[13px]">
              {isFresh
                ? '听力已经交了。准备好了再按下面的按钮，110 分钟从那一刻才开始算。'
                : '题目先收起来了。离开多久都不算在考试时间里，回来按「继续答题」接着走。'}
            </p>
            <Button isPending={isPausing} onPress={() => void onPause(false)}>
              {isFresh ? '开始笔试' : '继续答题'}
            </Button>
          </Card>
        ) : (
          <ExamQuestionList
            answers={answers}
            numbers={numbers}
            passages={passages}
            questions={state.questions}
            onPick={onPick}
          />
        )}
        <ExamAnswerSheet
          answers={answers}
          numbers={numbers}
          questions={state.questions}
          action={
            <Button isPending={isSubmitting} onPress={() => void handleSubmit()}>
              {submitLabel}
            </Button>
          }
        >
          <div
            className={`rounded-[10px] py-2 text-center font-mono text-[26px] font-semibold tabular-nums ${
              isPaused
                ? 'bg-foreground/8 text-muted'
                : isOvertime
                  ? 'bg-danger/12 text-danger'
                  : remaining < 10 * 60_000
                    ? 'bg-warning/12 text-warning-soft-foreground'
                    : 'bg-accent/10 text-accent'
            }`}
          >
            {isOvertime ? `+${formatClock(remaining)}` : formatClock(remaining)}
          </div>
          <Button
            isPending={isPausing}
            size="sm"
            variant={isPaused ? 'primary' : 'outline'}
            onPress={() => void onPause(!isPaused)}
          >
            {isPaused ? (isFresh ? '开始笔试' : '继续答题') : '暂停计时'}
          </Button>
          {isPaused ? (
            <p className="muted m-0 text-center text-xs">
              {isFresh ? '表还没起' : '已暂停，钟停在这里'}
            </p>
          ) : isOvertime ? (
            <p className="m-0 text-center text-xs text-danger">已超时（自我评估模式不强制交卷）</p>
          ) : null}
        </ExamAnswerSheet>
      </div>
    </section>
  )
}

// ===== 听力 =====

function ListeningPhase({
  state,
  answers,
  isSubmitting,
  onPick,
  onSubmit,
  isPageActive,
}: PhaseProps & { isPageActive: boolean }) {
  const numbers = useQuestionNumbers(state.questions)
  const passages = usePassageMap(state.passages)
  const [activeIds, setActiveIds] = useState<ReadonlySet<string>>(new Set())
  const autoSubmittedRef = useRef(false)
  // 换段回调必须是稳定引用，否则播放器每次渲染都会重跑换段副作用；
  // 它要读的「当前是不是前台页」因此只能走 ref。
  const isPageActiveRef = useRef(isPageActive)
  useEffect(() => {
    isPageActiveRef.current = isPageActive
  }, [isPageActive])

  /** 一段录音可能被两道题共用（聴解5 的双問题），连着的相同地址算一段。 */
  const segments = useMemo<ListeningSegment[]>(() => {
    const out: ListeningSegment[] = []
    for (const q of state.questions) {
      if (!q.audioUrl) continue
      const last = out[out.length - 1]
      if (last && last.url === q.audioUrl) last.questionIds.push(q.id)
      else out.push({ url: q.audioUrl, questionIds: [q.id] })
    }
    return out
  }, [state.questions])

  const handleActiveChange = useCallback((questionIds: string[]) => {
    setActiveIds(new Set(questionIds))
    if (!isPageActiveRef.current) return
    document
      .getElementById(questionDomId(questionIds[0]))
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [])

  // 只在播放器的事件处理里被调用，不进任何副作用的依赖，可以随渲染变。
  // 先听力的话，听力交完后面还有笔试。
  const isLastSection = state.sectionOrder === 'written'
  const submitLabel = isLastSection ? '交卷看成绩' : '交卷并开始笔试'

  const handleFinished = useCallback(() => {
    if (state.mode !== 'strict') {
      toast.warning('录音已播完，做完题就可以交卷')
      return
    }
    if (autoSubmittedRef.current) return
    autoSubmittedRef.current = true
    toast.warning('录音播完，已自动交卷')
    void onSubmit('listening')
  }, [state.mode, onSubmit])

  const handleSubmit = async () => {
    const unanswered = state.questions.length - Object.keys(answers).length
    const ok = await confirm({
      title: isLastSection ? '交卷？' : '交卷并开始笔试？',
      content:
        (unanswered > 0 ? `还有 ${unanswered} 题没作答。` : '') +
        (isLastSection
          ? '交卷后即出成绩，答案不能再改。'
          : '交卷后听力部分不能再修改，接着进入笔试，110 分钟从那时开始算。'),
      okText: '交卷',
      cancelText: '再想想',
      status: unanswered > 0 ? 'warning' : 'accent',
    })
    if (ok) await onSubmit('listening')
  }

  return (
    <section className="page">
      <ExamHeader
        state={state}
        subtitle="聴解"
        extra={`共 ${state.questions.length} 题 · 官方 ${state.listeningMinutes} 分`}
      />

      <div className={LAYOUT}>
        {/* 播放器归到左栏，和听力精练页一个版式。它原先是网格上方的整宽吸顶条，
            和右栏同样吸顶的答题卡抢同一段视口顶部——一滚就压在答题卡上。装进
            左栏之后两者各占一列，吸顶范围也被各自的列框住，永远不会重叠。

            这层必须是 flex 不能是 grid：grid 子项的包含块是它自己那一行，
            sticky 会被锁死在原地；flex 子项的包含块是整个容器，才吸得住。 */}
        <div className="flex min-w-0 flex-col gap-5">
          <Card className="sticky top-4 z-[5] p-4 max-[900px]:top-2">
            <ExamListeningPlayer
              canSeek={state.mode === 'self'}
              segments={segments}
              onActiveChange={handleActiveChange}
              onFinished={handleFinished}
            />
          </Card>
          <ExamQuestionList
            activeIds={activeIds}
            answers={answers}
            numbers={numbers}
            passages={passages}
            questions={state.questions}
            onPick={onPick}
          />
        </div>
        <ExamAnswerSheet
          activeIds={activeIds}
          answers={answers}
          numbers={numbers}
          questions={state.questions}
          action={
            <Button isPending={isSubmitting} onPress={() => void handleSubmit()}>
              {submitLabel}
            </Button>
          }
        />
      </div>
    </section>
  )
}

// ===== 成绩 / 解析 =====

function ResultPhase({ state, answers }: { state: ExamState; answers: Record<string, number> }) {
  const numbers = useQuestionNumbers(state.questions)
  const passages = usePassageMap(state.passages)
  const [filter, setFilter] = useState<'all' | 'wrong'>('all')
  const [isCollecting, setIsCollecting] = useState(false)
  const [collected, setCollected] = useState(false)

  // 分歧题两个答案都算对，口径与服务端判分一致。
  const wrong = useMemo(
    () => state.questions.filter((q) => !isAcceptedAnswer(q, answers[q.id])),
    [state.questions, answers],
  )
  const shown = filter === 'wrong' ? wrong : state.questions

  const collect = async () => {
    setIsCollecting(true)
    try {
      const { collected: n } = await collectExamWrongQuestions(state.year, state.month)
      setCollected(true)
      toast.success(`已把 ${n} 道错题加入错题本`)
    } catch (e) {
      toast.danger(getErrorMessage(e, '收错题失败'))
    } finally {
      setIsCollecting(false)
    }
  }

  return (
    <section className="page">
      <ExamHeader state={state} subtitle="成绩与解析" />

      {state.score ? (
        <ExamScoreCard
          isCollecting={isCollecting}
          listeningStartedAt={state.listeningStartedAt}
          listeningSubmittedAt={state.listeningSubmittedAt}
          pausedMs={state.pausedMs}
          score={state.score}
          wrongCount={collected ? 0 : wrong.filter((q) => answers[q.id] !== undefined).length}
          writtenStartedAt={state.writtenStartedAt}
          writtenSubmittedAt={state.writtenSubmittedAt}
          onCollectWrong={() => void collect()}
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl<'all' | 'wrong'>
          aria-label="筛选题目"
          options={[
            { value: 'all', label: `全部 ${state.questions.length}` },
            { value: 'wrong', label: `错题 / 未答 ${wrong.length}` },
          ]}
          value={filter}
          onChange={setFilter}
        />
        {collected ? (
          <Chip color="success" variant="soft">
            错题已收进错题本
          </Chip>
        ) : null}
      </div>

      {shown.length === 0 ? (
        <div className="card state-card">
          <p className="muted">这一场全对，没有错题。</p>
        </div>
      ) : (
        <ExamQuestionList
          answers={answers}
          isReview
          numbers={numbers}
          passages={passages}
          questions={shown}
        />
      )}
    </section>
  )
}
