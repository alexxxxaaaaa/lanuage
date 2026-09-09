import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { JlptChips } from '../components/JlptChips'
import { SelectField } from '../components/ui/SelectField'
import { Pager } from '../components/ui/Pager'
import { Button, Input, TextArea } from '@heroui/react'
import { Search } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { fillGrammarByAi } from '../api/ai'
import { createGrammar, getGrammars, updateGrammar } from '../api/grammar'
import { getGrammarReviewCounts } from '../api/grammarReview'
import { getErrorMessage } from '../api/error'
import { useI18n } from '../i18n'
import type { CreateGrammarPayload, Grammar } from '../types'
import {
  asGrammarLevels,
  CUSTOM_LEVEL,
  GRAMMAR_LEVELS,
  toGrammarLevel,
  useGrammarLevelLabel,
  type GrammarLevel,
} from '../lib/grammarLevels'
import { scrollAppToTop } from '../lib/scroll'

const EMPTY_FORM: CreateGrammarPayload = {
  pattern: '',
  connection: '',
  meaning: '',
  example: '',
  exampleZh: '',
  note: '',
  // 手工建的句型多半不对应 JLPT 某一级，默认落在自建这一档，要归级再自己挑。
  level: CUSTOM_LEVEL,
}

// 按钮里的计数胶囊。在 secondary / ghost 上要换成深色底才看得清。
const BADGE =
  'ml-1.5 inline-flex h-5 min-w-[22px] items-center justify-center rounded-full px-[7px] text-xs leading-none font-semibold'

/** 列表卡片只露一句例句 —— example 字段是一行一句的纯文本。 */
function firstLine(text?: string) {
  return (text ?? '').split('\n').find((s) => s.trim()) ?? ''
}

// 级别筛选里「全部」这一项的键。级别本身是 N1-N5 / CUSTOM 这几个字符串，空串
// 在下拉框里不是个能选的键，所以另给一个哨兵值，落到 state 时再换回空串。
const ALL_LEVELS = '__all__'

// 一页 20 条。原来是 200 + 一个「显示更多」按钮，装进整本蓝宝书（800 多条）
// 之后那个模式就不成立了：一页铺不完，翻起来也没有位置感。
const PAGE_SIZE = 20

/**
 * 自测遮罩：模糊显示，点一下揭开。
 *
 * select-none 不是可选项 —— blur() 只是视觉滤镜，文字仍然在 DOM 里，不禁止
 * 选中的话鼠标一拖就把答案拖蓝看见了，等于没遮。
 */
function BlurredAnswer({
  children,
  onReveal,
  className,
}: {
  children: ReactNode
  onReveal: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      className={`cursor-pointer select-none border-none bg-transparent p-0 text-left font-[inherit] text-[length:inherit] leading-[inherit] blur-[5px] transition-[filter] duration-150 hover:blur-[3px] ${className ?? ''}`}
      onClick={onReveal}
      aria-label="显示"
    >
      {children}
    </button>
  )
}

export function GrammarPage() {
  const navigate = useNavigate()
  const { t } = useI18n()
  const levelLabel = useGrammarLevelLabel()
  const [grammars, setGrammars] = useState<Grammar[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [isAiFilling, setIsAiFilling] = useState(false)
  const [form, setForm] = useState<CreateGrammarPayload>(EMPTY_FORM)
  const [keyword, setKeyword] = useState('')
  const [level, setLevel] = useState<GrammarLevel | ''>('')
  const [counts, setCounts] = useState<{ due: number; unlearned: number }>({
    due: 0,
    unlearned: 0,
  })
  const [learnCount, setLearnCount] = useState<number | null>(10)
  const [learnedFilter, setLearnedFilter] = useState<'all' | 'learned' | 'unlearned'>('all')
  const [page, setPage] = useState(1)

  // 自测：把「意思」和例句的中文翻译一起遮掉，看着句型、接续和日文例句先
  // 自己想。两处必须同遮同显 —— 只遮意思的话，底下那句译文照样把答案说了。
  // 默认全遮，每张卡片自己控制，这里记的是「哪几条被揭开了」。
  const [shownAnswerIds, setShownAnswerIds] = useState<Set<string>>(new Set())

  const toggleAnswer = (id: string) => {
    setShownAnswerIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const pinToTop = async (g: Grammar) => {
    try {
      await updateGrammar(g.id, { isPinned: true })
      await load()
      scrollAppToTop()
    } catch (err) {
      setError(getErrorMessage(err, '置顶失败'))
    }
  }

  const load = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const [list, c] = await Promise.all([
        getGrammars(),
        getGrammarReviewCounts().catch(() => ({ due: 0, unlearned: 0 })),
      ])
      setGrammars(list)
      setCounts(c)
    } catch (err) {
      setError(getErrorMessage(err, '加载语法列表失败'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  // 级别 + 关键词筛过一遍，但**不含**已学/未学 —— 那三个按钮上的数字要在
  // 这个范围里算，否则「已学 43」永远是全库的数，选了 N2 也不变，看不出
  // 这个级别到底学了多少。
  const scoped = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return grammars.filter((g) => {
      if (level && toGrammarLevel(g.level) !== level) return false
      if (!kw) return true
      return (
        g.pattern.toLowerCase().includes(kw) ||
        g.meaning.toLowerCase().includes(kw) ||
        g.example.toLowerCase().includes(kw) ||
        g.exampleZh.toLowerCase().includes(kw)
      )
    })
  }, [grammars, keyword, level])

  const filtered = useMemo(() => {
    if (learnedFilter === 'learned') return scoped.filter((g) => g.isLearned)
    if (learnedFilter === 'unlearned') return scoped.filter((g) => !g.isLearned)
    return scoped
  }, [scoped, learnedFilter])

  const scopedLearned = useMemo(
    () => scoped.filter((g) => g.isLearned).length,
    [scoped],
  )
  const scopedUnlearned = scoped.length - scopedLearned

  // 换了筛选条件就回到第 1 页 —— 不然筛完只剩 20 条，却还停在第 3 页看空白。
  // 在渲染期间比对而不是塞进 effect：这是 React 说的「跟着输入调整 state」，
  // 重渲染发生在提交之前，屏幕上不会先闪一帧旧内容。
  const filterKey = `${keyword}\0${level}\0${learnedFilter}`
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey)
  if (prevFilterKey !== filterKey) {
    setPrevFilterKey(filterKey)
    setPage(1)
  }

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  // 删条目之后总页数可能缩到当前页之前，夹一下免得停在空页上。
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const toggleLearned = async (g: Grammar) => {
    try {
      await updateGrammar(g.id, { isLearned: !g.isLearned })
      await load()
    } catch (err) {
      setError(getErrorMessage(err, '更新失败'))
    }
  }

  // 筛选器只列真正有条目的级别。归一之后排序，'CUSTOM' 按字母序落在 N1 前面，
  // 和新建表单里的顺序一致。顺带数出每一级的条数，下拉框里直接显示。
  const levelCounts = useMemo(() => {
    const m = new Map<GrammarLevel, number>()
    for (const g of grammars) {
      const lv = toGrammarLevel(g.level)
      m.set(lv, (m.get(lv) ?? 0) + 1)
    }
    return m
  }, [grammars])
  const levels = useMemo(
    () => Array.from(levelCounts.keys()).sort(),
    [levelCounts],
  )

  const handleAiFill = async () => {
    const pattern = form.pattern.trim()
    if (!pattern) {
      setError('请先填写句型再用 AI 填充')
      return
    }
    setIsAiFilling(true)
    setError(null)
    try {
      const result = await fillGrammarByAi(pattern)
      setForm((prev) => ({
        ...prev,
        pattern: result.pattern || prev.pattern,
        connection: result.connection,
        meaning: result.meaning,
        example: result.example,
        exampleZh: result.exampleZh,
        note: result.note,
      }))
    } catch (err) {
      setError(getErrorMessage(err, 'AI 填充失败'))
    } finally {
      setIsAiFilling(false)
    }
  }

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!form.pattern.trim()) {
      setError('句型不能为空')
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      await createGrammar(form)
      setForm(EMPTY_FORM)
      setIsCreating(false)
      await load()
    } catch (err) {
      setError(getErrorMessage(err, '创建失败'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="page">
      <div className="section-header">
        <div>
          <h2>{t('grammar.title')}</h2>
          <p className="muted">
            {t('grammar.summary', {
              total: grammars.length,
              due: counts.due,
              unlearned: counts.unlearned,
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="session-inline">
            <span className="muted">{t('grammar.learnCountLabel')}</span>
            <SelectField
              value={learnCount === null ? 'all' : String(learnCount)}
              onChange={(v) => setLearnCount(v === 'all' ? null : Number(v))}
              className="min-w-[100px]"
              options={[
                { value: '5', label: '5' },
                { value: '10', label: '10' },
                { value: '20', label: '20' },
                { value: '30', label: '30' },
                { value: 'all', label: t('grammar.learnCountAll') },
              ]}
            />
          </label>
          <Button
            type="button"
            onPress={() => {
              // 上面那个级别筛选器同时决定学习范围 —— 整本蓝宝书 800 多条，
              // 不挑级别的话一路学下去全是 N5 的助数词。没选级别就学全部，
              // 和加这个参数之前一样。
              const params = new URLSearchParams()
              if (learnCount !== null) params.set('count', String(learnCount))
              if (level) params.set('level', level)
              const qs = params.toString()
              navigate(qs ? `/grammar/learn?${qs}` : '/grammar/learn')
            }}
          >
            {t('grammar.learnNewBtn')}
            {/* 选了级别就显示该级别的未学数。原来一律显示服务端的全局
              * unlearned，选了 N2 仍然是「191」，看起来像级别没生效。 */}
            {(level ? scopedUnlearned : counts.unlearned) > 0 ? (
              <span className={`${BADGE} bg-accent-foreground/25`}>
                {level ? scopedUnlearned : counts.unlearned}
              </span>
            ) : null}
          </Button>
          <Button variant="outline"
            type="button"
            onPress={() => navigate('/grammar/review')}
          >
            {t('grammar.reviewBtn')}
            {counts.due > 0 ? <span className={`${BADGE} bg-foreground/10 text-inherit`}>{counts.due}</span> : null}
          </Button>
          <Button variant="outline" size="sm"
            type="button"
            onPress={() => navigate('/grammar/questions')}
          >
            题库
          </Button>
          <Button variant="outline" size="sm"
            type="button"
            onPress={() => setIsCreating((prev) => !prev)}
          >
            {isCreating ? t('grammar.collapseBtn') : t('grammar.newPatternBtn')}
          </Button>
        </div>
      </div>

      {/* `flex-row` is not redundant: HeroUI's own `.card` block sets
          `flex-direction: column`, and this bar shares that class name. Without
          it the row ran as a column, which turned `flex-[1_1_240px]` on the
          search box into a 240px *height* — and dropped the absolutely
          positioned magnifier, pinned to 50% of that box, below the field. */}
      <div className="card flex flex-row flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-[1_1_240px]">
          <Search className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <Input
            className="w-full pl-9"
            placeholder={t('grammar.searchPlaceholder')}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </div>
        {/* 「全部」得是列表里的头一项，不能只当 placeholder —— placeholder 只在
            没选过的时候露一次，选完某个级别就再也点不回去了。 */}
        <SelectField
          value={level || ALL_LEVELS}
          onChange={(v) => setLevel(v === ALL_LEVELS ? '' : v)}
          className="min-w-[120px]"
          options={[
            { value: ALL_LEVELS, label: `${t('grammar.levelAll')} (${grammars.length})` },
            // 每个级别后面带条数，不用切过去才知道这一级有多少。
            ...levels.map((lv) => ({
              value: lv,
              label: `${levelLabel(lv)} (${levelCounts.get(lv) ?? 0})`,
              textValue: levelLabel(lv),
            })),
          ]}
        />
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            size="sm"
            variant={learnedFilter === 'all' ? 'primary' : 'outline'}
            onPress={() => setLearnedFilter('all')}
          >
            {t('grammar.filterAll')} ({scoped.length})
          </Button>
          <Button
            type="button"
            size="sm"
            variant={learnedFilter === 'learned' ? 'primary' : 'outline'}
            onPress={() => setLearnedFilter('learned')}
          >
            {t('grammar.filterLearned')} ({scopedLearned})
          </Button>
          <Button
            type="button"
            size="sm"
            variant={learnedFilter === 'unlearned' ? 'primary' : 'outline'}
            onPress={() => setLearnedFilter('unlearned')}
          >
            {t('grammar.filterUnlearned')} ({scopedUnlearned})
          </Button>
        </div>
      </div>

      {isCreating ? (
        <form className="card word-form" onSubmit={(event) => void handleCreate(event)}>
          <label>
            句型 *
            <div style={{ display: 'flex', gap: 8 }}>
              <Input
                value={form.pattern}
                onChange={(event) => setForm((p) => ({ ...p, pattern: event.target.value }))}
                placeholder="〜にあたって"
                style={{ flex: 1 }}
              />
              <Button
                type="button"
                onPress={() => void handleAiFill()}
                isDisabled={isAiFilling || !form.pattern.trim()}
              >
                {isAiFilling ? 'AI 填充中...' : 'AI 填充'}
              </Button>
            </div>
          </label>
          <label>
            接续
            <Input
              value={form.connection ?? ''}
              onChange={(event) => setForm((p) => ({ ...p, connection: event.target.value }))}
              placeholder="名词 / 动词辞书形 + にあたって"
            />
          </label>
          <label>
            意思
            <Input
              value={form.meaning ?? ''}
              onChange={(event) => setForm((p) => ({ ...p, meaning: event.target.value }))}
              placeholder="在…之际、当…的时候"
            />
          </label>
          <label>
            例句(日文,多句用换行)
            <TextArea
              rows={3}
              value={form.example ?? ''}
              onChange={(event) => setForm((p) => ({ ...p, example: event.target.value }))}
            />
          </label>
          <label>
            例句翻译(中文)
            <TextArea
              rows={3}
              value={form.exampleZh ?? ''}
              onChange={(event) => setForm((p) => ({ ...p, exampleZh: event.target.value }))}
            />
          </label>
          <label>
            注意点
            <TextArea
              rows={2}
              value={form.note ?? ''}
              onChange={(event) => setForm((p) => ({ ...p, note: event.target.value }))}
            />
          </label>
          <label>
            级别
            <SelectField
              value={toGrammarLevel(form.level)}
              onChange={(v) => setForm((p) => ({ ...p, level: v }))}
              options={GRAMMAR_LEVELS.map((lv) => ({ value: lv, label: levelLabel(lv) }))}
            />
          </label>
          <div className="form-actions">
            <Button type="submit" isDisabled={isSubmitting}>
              {isSubmitting ? '提交中...' : '保存'}
            </Button>
          </div>
        </form>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}
      {isLoading ? <div className="card">加载中...</div> : null}

      {!isLoading && filtered.length === 0 ? (
        <div className="card state-card" style={{ textAlign: 'center' }}>
          <p className="muted">{t('grammar.emptyList')}</p>
        </div>
      ) : null}

      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {visible.map((g) => (
          <li key={g.id} className="rounded-[14px] bg-surface px-5 py-4.5 shadow-card transition-shadow duration-150 hover:shadow-overlay">
            <header className="mb-2.5 flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-wrap items-baseline gap-2.5">
                <Link to={`/grammar/${g.id}`} className="text-xl font-bold text-foreground no-underline [word-break:keep-all] hover:text-accent">
                  {g.pattern}
                </Link>
                <JlptChips levels={asGrammarLevels(g.level)} size="md" />
                {g.isLearned ? (
                  <span className="inline-flex items-center rounded-full bg-success-soft px-2 py-0.5 text-xs font-semibold text-success-soft-foreground">{t('grammar.learnedPill')}</span>
                ) : null}
              </div>
              <div className="flex shrink-0 gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className={`shrink-0 text-xs ${
                    g.isLearned
                      ? 'border-success/30 bg-success-soft text-success-soft-foreground'
                      : ''
                  }`}
                  onPress={() => void toggleLearned(g)}
                  render={(props) => (
                    <button
                      {...props}
                      title={
                        g.isLearned
                          ? t('grammar.learnedTitleOn')
                          : t('grammar.learnedTitleOff')
                      }
                    />
                  )}
                >
                  {g.isLearned ? t('grammar.unmarkLearned') : t('grammar.markLearned')}
                </Button>
                {/* 只有真有东西可遮的时候才出现这个按钮 */}
                {g.meaning || firstLine(g.exampleZh) ? (
                  <Button variant="outline" size="sm" className="shrink-0 rounded-full text-xs"
                    type="button"
                    onPress={() => toggleAnswer(g.id)}
                    render={(props) => (
                      <button
                        {...props}
                        title={
                          shownAnswerIds.has(g.id)
                            ? '遮住意思和例句翻译'
                            : '显示意思和例句翻译'
                        }
                      />
                    )}
                  >
                    {shownAnswerIds.has(g.id) ? '隐藏' : '显示'}
                  </Button>
                ) : null}
                <Button variant="outline" size="sm" className="shrink-0 rounded-full text-xs"
                  type="button"
                  onPress={() => void pinToTop(g)}
                  render={(props) => <button {...props} title={t('grammar.pinTitle')} />}
                >
                  {t('grammar.pin')}
                </Button>
              </div>
            </header>
            {g.connection ? (
              <p className="my-1.5 flex gap-2 text-sm/[1.6]">
                <span className="min-w-16 shrink-0 pt-0.5 text-xs text-muted">{t('grammar.labelConnection')}</span>
                <span className="multiline-text">{g.connection}</span>
              </p>
            ) : null}
            {g.meaning ? (
              <p className="my-1.5 flex gap-2 text-sm/[1.6]">
                <span className="min-w-16 shrink-0 pt-0.5 text-xs text-muted">{t('grammar.labelMeaning')}</span>
                {shownAnswerIds.has(g.id) ? (
                  <span className="font-medium text-foreground">{g.meaning}</span>
                ) : (
                  <BlurredAnswer
                    onReveal={() => toggleAnswer(g.id)}
                    className="font-medium text-foreground"
                  >
                    {g.meaning}
                  </BlurredAnswer>
                )}
              </p>
            ) : null}
            {/* 只露第一句。装进整本蓝宝书之后一条能带十几句例句，全铺出来的话
                列表要滚上几十屏才翻得完一个级别。要看全的去详情页。 */}
            {firstLine(g.example) ? (
              <div className="mt-2.5 flex flex-col gap-1 border-t border-separator pt-2.5 text-[13.5px]/[1.65]">
                <p className="multiline-text">{firstLine(g.example)}</p>
                {/* 日文例句照常显示，只遮译文 —— 遮了日文就没得自测了 */}
                {firstLine(g.exampleZh) ? (
                  shownAnswerIds.has(g.id) ? (
                    <p className="muted multiline-text">{firstLine(g.exampleZh)}</p>
                  ) : (
                    <BlurredAnswer
                      onReveal={() => toggleAnswer(g.id)}
                      className="muted multiline-text"
                    >
                      {firstLine(g.exampleZh)}
                    </BlurredAnswer>
                  )
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {filtered.length > 0 ? (
        <div className="mt-4">
          <Pager
            current={safePage}
            pageSize={PAGE_SIZE}
            total={filtered.length}
            onChange={(next) => {
              setPage(next)
              scrollAppToTop()
            }}
            summary={`共 ${filtered.length} 条`}
          />
        </div>
      ) : null}
    </section>
  )
}
