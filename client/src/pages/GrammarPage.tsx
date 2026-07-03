import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { fillGrammarByAi } from '../api/ai'
import { createGrammar, getGrammars, updateGrammar } from '../api/grammar'
import { getGrammarReviewCounts } from '../api/grammarReview'
import { getErrorMessage } from '../api/error'
import { useI18n } from '../i18n'
import type { CreateGrammarPayload, Grammar } from '../types'

const EMPTY_FORM: CreateGrammarPayload = {
  pattern: '',
  connection: '',
  meaning: '',
  example: '',
  exampleZh: '',
  note: '',
  level: 'N1',
}

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
      window.scrollTo({ top: 0, behavior: 'smooth' })
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
          <p className="eyebrow">{t('grammar.eyebrow')}</p>
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
            <select
              value={learnCount === null ? 'all' : String(learnCount)}
              onChange={(e) => {
                const v = e.target.value
                setLearnCount(v === 'all' ? null : Number(v))
              }}
            >
              <option value="5">5</option>
              <option value="10">10</option>
              <option value="20">20</option>
              <option value="30">30</option>
              <option value="all">{t('grammar.learnCountAll')}</option>
            </select>
          </label>
          <button
            type="button"
            className="primary-button"
            onClick={() =>
              navigate(
                learnCount === null
                  ? '/grammar/learn'
                  : `/grammar/learn?count=${learnCount}`,
              )
            }
          >
            {t('grammar.learnNewBtn')}
            {counts.unlearned > 0 ? <span className="btn-badge">{counts.unlearned}</span> : null}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => navigate('/grammar/review')}
          >
            {t('grammar.reviewBtn')}
            {counts.due > 0 ? <span className="btn-badge">{counts.due}</span> : null}
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => setIsCreating((prev) => !prev)}
          >
            {isCreating ? t('grammar.collapseBtn') : t('grammar.newPatternBtn')}
          </button>
        </div>
      </div>

      <div className="card" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="search"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder={t('grammar.searchPlaceholder')}
          style={{ flex: '1 1 240px' }}
        />
        <select value={level} onChange={(event) => setLevel(event.target.value)}>
          <option value="">{t('grammar.levelAll')}</option>
          {levels.map((lv) => (
            <option key={lv} value={lv}>
              {lv}
            </option>
          ))}
        </select>
        <div className="grammar-learned-filter">
          <button
            type="button"
            className={learnedFilter === 'all' ? 'primary-button' : 'ghost-button'}
            onClick={() => setLearnedFilter('all')}
          >
            {t('grammar.filterAll')} ({grammars.length})
          </button>
          <button
            type="button"
            className={learnedFilter === 'learned' ? 'primary-button' : 'ghost-button'}
            onClick={() => setLearnedFilter('learned')}
          >
            {t('grammar.filterLearned')} ({learnedCount})
          </button>
          <button
            type="button"
            className={learnedFilter === 'unlearned' ? 'primary-button' : 'ghost-button'}
            onClick={() => setLearnedFilter('unlearned')}
          >
            {t('grammar.filterUnlearned')} ({grammars.length - learnedCount})
          </button>
        </div>
      </div>

      {isCreating ? (
        <form className="card word-form" onSubmit={(event) => void handleCreate(event)}>
          <label>
            句型 *
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={form.pattern}
                onChange={(event) => setForm((p) => ({ ...p, pattern: event.target.value }))}
                placeholder="〜にあたって"
                required
                style={{ flex: 1 }}
              />
              <button
                type="button"
                onClick={() => void handleAiFill()}
                disabled={isAiFilling || !form.pattern.trim()}
                title="根据句型用 AI 补全其它字段"
              >
                {isAiFilling ? 'AI 填充中...' : 'AI 填充'}
              </button>
            </div>
          </label>
          <label>
            接续
            <input
              value={form.connection ?? ''}
              onChange={(event) => setForm((p) => ({ ...p, connection: event.target.value }))}
              placeholder="名词 / 动词辞书形 + にあたって"
            />
          </label>
          <label>
            意思
            <input
              value={form.meaning ?? ''}
              onChange={(event) => setForm((p) => ({ ...p, meaning: event.target.value }))}
              placeholder="在…之际、当…的时候"
            />
          </label>
          <label>
            例句(日文,多句用换行)
            <textarea
              rows={3}
              value={form.example ?? ''}
              onChange={(event) => setForm((p) => ({ ...p, example: event.target.value }))}
            />
          </label>
          <label>
            例句翻译(中文)
            <textarea
              rows={3}
              value={form.exampleZh ?? ''}
              onChange={(event) => setForm((p) => ({ ...p, exampleZh: event.target.value }))}
            />
          </label>
          <label>
            注意点
            <textarea
              rows={2}
              value={form.note ?? ''}
              onChange={(event) => setForm((p) => ({ ...p, note: event.target.value }))}
            />
          </label>
          <label>
            级别
            <select
              value={form.level ?? 'N1'}
              onChange={(event) => setForm((p) => ({ ...p, level: event.target.value }))}
            >
              <option value="N1">N1</option>
              <option value="N2">N2</option>
              <option value="N3">N3</option>
              <option value="N4">N4</option>
              <option value="N5">N5</option>
            </select>
          </label>
          <div className="form-actions">
            <button type="submit" className="primary-button" disabled={isSubmitting}>
              {isSubmitting ? '提交中...' : '保存'}
            </button>
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

      <ul className="grammar-list">
        {filtered.map((g) => (
          <li key={g.id} className="grammar-card">
            <header className="grammar-card-head">
              <div className="grammar-card-title-row">
                <Link to={`/grammar/${g.id}`} className="grammar-card-pattern">
                  {g.pattern}
                </Link>
                <span className="grammar-card-level">{g.level}</span>
                {g.isLearned ? (
                  <span className="grammar-card-learned">{t('grammar.learnedPill')}</span>
                ) : null}
              </div>
              <div className="grammar-card-actions">
                <button
                  type="button"
                  className={`ghost-button grammar-card-pin ${g.isLearned ? 'is-learned' : ''}`}
                  onClick={() => void toggleLearned(g)}
                  title={
                    g.isLearned
                      ? t('grammar.learnedTitleOn')
                      : t('grammar.learnedTitleOff')
                  }
                >
                  {g.isLearned ? t('grammar.unmarkLearned') : t('grammar.markLearned')}
                </button>
                <button
                  type="button"
                  className="ghost-button grammar-card-pin"
                  onClick={() => void pinToTop(g)}
                  title={t('grammar.pinTitle')}
                >
                  {t('grammar.pin')}
                </button>
              </div>
            </header>
            {g.connection ? (
              <p className="grammar-card-line">
                <span className="grammar-card-label">{t('grammar.labelConnection')}</span>
                <span className="multiline-text">{g.connection}</span>
              </p>
            ) : null}
            {g.meaning ? (
              <p className="grammar-card-line">
                <span className="grammar-card-label">{t('grammar.labelMeaning')}</span>
                <span className="grammar-card-meaning">{g.meaning}</span>
              </p>
            ) : null}
            {g.example ? (
              <div className="grammar-card-example">
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
