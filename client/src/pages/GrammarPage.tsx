import { useEffect, useMemo, useState } from 'react'
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
import { scrollAppToTop } from '../lib/scroll'

const EMPTY_FORM: CreateGrammarPayload = {
  pattern: '',
  connection: '',
  meaning: '',
  example: '',
  exampleZh: '',
  note: '',
  level: 'N1',
}

// 按钮里的计数胶囊。在 secondary / ghost 上要换成深色底才看得清。
const BADGE =
  'ml-1.5 inline-flex h-5 min-w-[22px] items-center justify-center rounded-full px-[7px] text-xs leading-none font-semibold'

export function GrammarPage() {
  const navigate = useNavigate()
  const { t } = useI18n()
  const [grammars, setGrammars] = useState<Grammar[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [isAiFilling, setIsAiFilling] = useState(false)
  const [form, setForm] = useState<CreateGrammarPayload>(EMPTY_FORM)
  const [keyword, setKeyword] = useState('')
  const [level, setLevel] = useState<string>('')
  const [counts, setCounts] = useState<{ due: number; unlearned: number }>({
    due: 0,
    unlearned: 0,
  })
  const [learnCount, setLearnCount] = useState<number | null>(10)
  const [learnedFilter, setLearnedFilter] = useState<'all' | 'learned' | 'unlearned'>('all')

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
      if (level && g.level !== level) return false
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

  const toggleLearned = async (g: Grammar) => {
    try {
      await updateGrammar(g.id, { isLearned: !g.isLearned })
      await load()
    } catch (err) {
      setError(getErrorMessage(err, '更新失败'))
    }
  }

  const levels = useMemo(() => {
    const s = new Set<string>()
    for (const g of grammars) if (g.level) s.add(g.level)
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
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <label className="session-inline" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
            onPress={() =>
              navigate(
                learnCount === null
                  ? '/grammar/learn'
                  : `/grammar/learn?count=${learnCount}`,
              )
            }
          >
            {t('grammar.learnNewBtn')}
            {counts.unlearned > 0 ? <span className={`${BADGE} bg-white/25`}>{counts.unlearned}</span> : null}
          </Button>
          <Button variant="outline"
            type="button"
            onPress={() => navigate('/grammar/review')}
          >
            {t('grammar.reviewBtn')}
            {counts.due > 0 ? <span className={`${BADGE} bg-black/8 text-inherit`}>{counts.due}</span> : null}
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

      <div className="card" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="relative flex-[1_1_240px]">
          <Search className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <Input
            className="w-full pl-9"
            placeholder={t('grammar.searchPlaceholder')}
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </div>
        <SelectField
          value={level || undefined}
          onChange={(v) => setLevel(v ?? '')}
          placeholder={t('grammar.levelAll')}
              className="min-w-[120px]"
          options={levels.map((lv) => ({ value: lv, label: lv }))}
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
              value={form.level ?? 'N1'}
              onChange={(v) => setForm((p) => ({ ...p, level: v }))}
              options={['N1', 'N2', 'N3', 'N4', 'N5'].map((lv) => ({
                value: lv,
                label: lv,
              }))}
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
        {filtered.map((g) => (
          <li key={g.id} className="rounded-[14px] border border-border bg-white px-5 py-4.5 transition-[border-color,box-shadow] duration-150 hover:border-accent/35 hover:shadow-[0_6px_18px_rgba(15,23,42,0.06)]">
            <header className="mb-2.5 flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-wrap items-baseline gap-2.5">
                <Link to={`/grammar/${g.id}`} className="text-xl font-bold text-foreground no-underline [word-break:keep-all] hover:text-accent">
                  {g.pattern}
                </Link>
                <span className="inline-flex items-center rounded-full bg-accent/10 px-2 py-0.5 text-xs font-semibold tracking-[0.04em] text-blue-700">{g.level}</span>
                {g.isLearned ? (
                  <span className="inline-flex items-center rounded-full bg-emerald-500/12 px-2 py-0.5 text-xs font-semibold text-emerald-800">{t('grammar.learnedPill')}</span>
                ) : null}
              </div>
              <div className="flex shrink-0 gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className={`shrink-0 text-xs ${
                    g.isLearned
                      ? 'border-emerald-500/30 bg-emerald-500/8 text-emerald-800'
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
                <span className="min-w-16 shrink-0 pt-0.5 text-xs text-black/45">{t('grammar.labelConnection')}</span>
                <span className="multiline-text">{g.connection}</span>
              </p>
            ) : null}
            {g.meaning ? (
              <p className="my-1.5 flex gap-2 text-sm/[1.6]">
                <span className="min-w-16 shrink-0 pt-0.5 text-xs text-black/45">{t('grammar.labelMeaning')}</span>
                <span className="font-medium text-foreground">{g.meaning}</span>
              </p>
            ) : null}
            {g.example ? (
              <div className="mt-2.5 flex flex-col gap-1 border-t border-dashed border-black/8 pt-2.5 text-[13.5px]/[1.65]">
                <p className="multiline-text">{g.example}</p>
                {g.exampleZh ? (
                  <p className="muted multiline-text">{g.exampleZh}</p>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}
