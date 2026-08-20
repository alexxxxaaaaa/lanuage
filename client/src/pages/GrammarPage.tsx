import { useEffect, useMemo, useState } from 'react'
import { JlptChips } from '../components/JlptChips'
import { SelectField } from '../components/ui/SelectField'
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

// 一次铺多少张卡片。装进整本蓝宝书之后不筛选就是 800 多条，全渲染出来手机上
// 要卡一下；200 这个数选得比手工整理的条目量高，所以没导过书的账号看不出区别。
const PAGE_SIZE = 200

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
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

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

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return grammars.filter((g) => {
      if (level && toGrammarLevel(g.level) !== level) return false
      if (learnedFilter === 'learned' && !g.isLearned) return false
      if (learnedFilter === 'unlearned' && g.isLearned) return false
      if (!kw) return true
      return (
        g.pattern.toLowerCase().includes(kw) ||
        g.meaning.toLowerCase().includes(kw) ||
        g.example.toLowerCase().includes(kw) ||
        g.exampleZh.toLowerCase().includes(kw)
      )
    })
  }, [grammars, keyword, level, learnedFilter])

  const learnedCount = useMemo(
    () => grammars.filter((g) => g.isLearned).length,
    [grammars],
  )

  // 换了筛选条件就从头铺 —— 不然搜完一个词还留着上一次「显示更多」的进度。
  // 在渲染期间比对而不是塞进 effect：这是 React 说的「跟着输入调整 state」，
  // 重渲染发生在提交之前，屏幕上不会先闪一帧旧的条数。
  const filterKey = `${keyword}\0${level}\0${learnedFilter}`
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey)
  if (prevFilterKey !== filterKey) {
    setPrevFilterKey(filterKey)
    setVisibleCount(PAGE_SIZE)
  }

  const visible = filtered.slice(0, visibleCount)
  const rest = filtered.length - visible.length

  const toggleLearned = async (g: Grammar) => {
    try {
      await updateGrammar(g.id, { isLearned: !g.isLearned })
      await load()
    } catch (err) {
      setError(getErrorMessage(err, '更新失败'))
    }
  }

  // 筛选器只列真正有条目的级别。归一之后排序，'CUSTOM' 按字母序落在 N1 前面，
  // 和新建表单里的顺序一致。
  const levels = useMemo(() => {
    const s = new Set<GrammarLevel>()
    for (const g of grammars) s.add(toGrammarLevel(g.level))
    return Array.from(s).sort()
  }, [grammars])

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
            {counts.unlearned > 0 ? <span className={`${BADGE} bg-accent-foreground/25`}>{counts.unlearned}</span> : null}
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
            { value: ALL_LEVELS, label: t('grammar.levelAll') },
            ...levels.map((lv) => ({ value: lv, label: levelLabel(lv) })),
          ]}
        />
        <div className="flex flex-wrap gap-1.5">
          <Button
            type="button"
            size="sm"
            variant={learnedFilter === 'all' ? 'primary' : 'outline'}
            onPress={() => setLearnedFilter('all')}
          >
            {t('grammar.filterAll')} ({grammars.length})
          </Button>
          <Button
            type="button"
            size="sm"
            variant={learnedFilter === 'learned' ? 'primary' : 'outline'}
            onPress={() => setLearnedFilter('learned')}
          >
            {t('grammar.filterLearned')} ({learnedCount})
          </Button>
          <Button
            type="button"
            size="sm"
            variant={learnedFilter === 'unlearned' ? 'primary' : 'outline'}
            onPress={() => setLearnedFilter('unlearned')}
          >
            {t('grammar.filterUnlearned')} ({grammars.length - learnedCount})
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
                <span className="font-medium text-foreground">{g.meaning}</span>
              </p>
            ) : null}
            {/* 只露第一句。装进整本蓝宝书之后一条能带十几句例句，全铺出来的话
                列表要滚上几十屏才翻得完一个级别。要看全的去详情页。 */}
            {firstLine(g.example) ? (
              <div className="mt-2.5 flex flex-col gap-1 border-t border-separator pt-2.5 text-[13.5px]/[1.65]">
                <p className="multiline-text">{firstLine(g.example)}</p>
                {firstLine(g.exampleZh) ? (
                  <p className="muted multiline-text">{firstLine(g.exampleZh)}</p>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      {rest > 0 ? (
        <div className="mt-3 flex justify-center">
          <Button
            type="button"
            variant="outline"
            onPress={() => setVisibleCount((n) => n + PAGE_SIZE)}
          >
            {t('grammar.showMore', { rest })}
          </Button>
        </div>
      ) : null}
    </section>
  )
}
