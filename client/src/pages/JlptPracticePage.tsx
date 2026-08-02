import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { Modal, Spin, message } from 'antd'
import { StarFilled, StarOutlined } from '@ant-design/icons'
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
      .catch((e) => message.error(getErrorMessage(e, '加载题目失败')))
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
        message.error(getErrorMessage(e, '加载题目失败'))
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
        message.error(getErrorMessage(e, '提交失败'))
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
      message.success(next ? '已收藏' : '已取消收藏')
    } catch (e) {
      message.error(getErrorMessage(e, '操作失败'))
    }
  }

  const clearCard = () => {
    Modal.confirm({
      title: '清空答题卡？',
      content: `会删掉这一组里 ${stats.answered} 道题的作答记录，题目本身不变。`,
      okText: '清空',
      cancelText: '取消',
      onOk: async () => {
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
          message.error(getErrorMessage(e, '清空失败'))
        }
      },
    })
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
        <div className="jlpt-loading">
          <Spin />
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
          <Link className="primary-link" to="/jlpt">
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
    <aside className="jlpt-answer-card">
      <div className="jlpt-answer-head">
        <h3>答题卡</h3>
        <button type="button" className="jlpt-link-button" onClick={clearCard}>
          清空
        </button>
      </div>
      <div className="jlpt-answer-stats">
        <span className="jlpt-stat is-correct">正确 {stats.correct}</span>
        <span className="jlpt-stat is-wrong">错误 {stats.wrong}</span>
        <span className="jlpt-stat">未做 {stats.untouched}</span>
      </div>
      <p className="jlpt-answer-score">
        <strong>
          {stats.correct}/{stats.answered}
        </strong>
        <span className="muted"> 正确率 {stats.rate}%</span>
      </p>
      <button
        type="button"
        className="jlpt-grid-toggle"
        onClick={() => setIsGridOpen((v) => !v)}
        aria-expanded={isGridOpen}
      >
        {isGridOpen ? '收起题号' : `展开题号（${items.length}）`}
      </button>
      <div className={'jlpt-answer-grid' + (isGridOpen ? '' : ' is-collapsed')}>
        {items.map((item, i) => (
          <button
            type="button"
            key={item.id}
            className={
              'jlpt-answer-dot' +
              (item.status ? ` is-${item.status}` : '') +
              (i === index ? ' is-current' : '')
            }
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
    <section className="page jlpt-take">
      <header className="jlpt-take-header">
        <div>
          <p className="eyebrow">
            <Link to="/jlpt">← JLPT 精练</Link>
          </p>
          <h2>{title}</h2>
          {meta?.instruction ? <p className="jlpt-take-instruction">{meta.instruction}</p> : null}
        </div>
        <div className="jlpt-take-position">
          第 {index + 1} / {items.length} 题
        </div>
      </header>

      <div className="jlpt-take-body">
        <div className="jlpt-take-main">
          {!question ? (
            current && failed.has(current.id) ? (
              <div className="card state-card">
                <p className="muted">这道题的正文没能加载出来。</p>
                <button
                  type="button"
                  onClick={() =>
                    setFailed((prev) => {
                      const next = new Set(prev)
                      next.delete(current.id)
                      return next
                    })
                  }
                >
                  重试
                </button>
              </div>
            ) : (
              <div className="jlpt-loading">
                <Spin />
              </div>
            )
          ) : (
            <>
              {showPassage && question.passage ? (
                <div className="jlpt-passage">
                  <p className="jlpt-passage-label">
                    {isListening ? '聴解原文' : question.passage.type || '本文'}
                  </p>
                  <QbankText className="jlpt-passage-body" text={question.passage.content} />
                </div>
              ) : null}

              {isListening ? (
                question.audioUrl ? (
                  <div className="jlpt-audio">
                    <audio controls preload="none" src={question.audioUrl} />
                  </div>
                ) : (
                  <p className="muted jlpt-audio-note">
                    这一题的音频源站缺失，可以先看下面的原文。
                  </p>
                )
              ) : null}

              <article className="jlpt-question">
                <div className="jlpt-question-head">
                  <span className="jlpt-question-index">{index + 1}.</span>
                  <div className="jlpt-question-stem">
                    <p className="jlpt-question-source">
                      {paperLabel(question.year, question.month)} · {question.seq}
                    </p>
                    <QbankText text={question.stemJp} />
                  </div>
                  <button
                    type="button"
                    className={'jlpt-fav-button' + (question.favorite ? ' is-on' : '')}
                    onClick={() => void toggleFavorite()}
                    title={question.favorite ? '取消收藏' : '收藏这道题'}
                  >
                    {question.favorite ? <StarFilled /> : <StarOutlined />}
                  </button>
                </div>

                <ol className="jlpt-options">
                  {question.options.map((option, i) => {
                    const num = i + 1
                    const isAnswer = num === question.answer
                    const isPicked = question.selected === num
                    const cls = [
                      'jlpt-option',
                      revealed ? 'is-revealed' : 'is-clickable',
                      revealed && isAnswer ? 'is-answer' : '',
                      revealed && isPicked && !isAnswer ? 'is-wrong' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')
                    return (
                      <li key={i}>
                        <button
                          type="button"
                          className={cls}
                          disabled={revealed}
                          onClick={() => void pick(num)}
                        >
                          <span className="jlpt-option-num">{num}</span>
                          {hasPlaceholderOptions(question.options) ? (
                            <span className="muted">（选项由音频念出）</span>
                          ) : (
                            <QbankText className="jlpt-option-text" text={option} />
                          )}
                          {revealed && isAnswer ? (
                            <span className="jlpt-option-tag is-answer">正确答案</span>
                          ) : null}
                          {revealed && isPicked && !isAnswer ? (
                            <span className="jlpt-option-tag is-wrong">你的选择</span>
                          ) : null}
                        </button>
                      </li>
                    )
                  })}
                </ol>

                {revealed ? (
                  <div className="jlpt-explain">
                    <p className={'jlpt-verdict is-' + question.status}>
                      {question.status === 'correct' ? '✓ 答对了' : '✗ 答错了'}
                      <button type="button" className="jlpt-link-button" onClick={retry}>
                        再做一次
                      </button>
                    </p>
                    {question.stemZh ? (
                      <div className="jlpt-explain-block">
                        <p className="jlpt-explain-label">{isListening ? '設問' : '译文'}</p>
                        <QbankText text={question.stemZh} />
                      </div>
                    ) : null}
                    {question.explain ? (
                      <div className="jlpt-explain-block">
                        <p className="jlpt-explain-label">{isListening ? '原文 / 译文' : '解析'}</p>
                        <QbankText text={question.explain} />
                      </div>
                    ) : null}
                    {question.dispute ? (
                      <p className="jlpt-dispute">⚠ {question.dispute}</p>
                    ) : null}
                  </div>
                ) : null}
              </article>

              <div className="jlpt-nav">
                <button
                  type="button"
                  className="ghost-button"
                  disabled={index === 0}
                  onClick={() => setIndex((i) => Math.max(0, i - 1))}
                >
                  上一题
                </button>
                <button
                  type="button"
                  className="primary-button"
                  disabled={index >= items.length - 1}
                  onClick={() => setIndex((i) => Math.min(items.length - 1, i + 1))}
                >
                  下一题
                </button>
              </div>
            </>
          )}
        </div>

        {answerCard}
      </div>
    </section>
  )
}
