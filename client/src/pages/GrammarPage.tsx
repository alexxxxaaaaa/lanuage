import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { fillGrammarByAi } from '../api/ai'
import { createGrammar, getGrammars } from '../api/grammar'
import { getErrorMessage } from '../api/error'
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
  const [grammars, setGrammars] = useState<Grammar[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [isAiFilling, setIsAiFilling] = useState(false)
  const [form, setForm] = useState<CreateGrammarPayload>(EMPTY_FORM)
  const [keyword, setKeyword] = useState('')
  const [level, setLevel] = useState<string>('')

  const load = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const list = await getGrammars()
      setGrammars(list)
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
      if (!kw) return true
      return (
        g.pattern.toLowerCase().includes(kw) ||
        g.meaning.toLowerCase().includes(kw) ||
        g.example.toLowerCase().includes(kw) ||
        g.exampleZh.toLowerCase().includes(kw)
      )
    })
  }, [grammars, keyword, level])

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
          <p className="eyebrow">Grammar</p>
          <h2>语法</h2>
          <p className="muted">N1 句型表 · 当前 {grammars.length} 条</p>
        </div>
        <button
          type="button"
          className="primary-button"
          onClick={() => setIsCreating((prev) => !prev)}
        >
          {isCreating ? '收起' : '新建句型'}
        </button>
      </div>

      <div className="card" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <input
          type="search"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          placeholder="按句型 / 意思 / 例句搜索"
          style={{ flex: '1 1 240px' }}
        />
        <select value={level} onChange={(event) => setLevel(event.target.value)}>
          <option value="">全部级别</option>
          {levels.map((lv) => (
            <option key={lv} value={lv}>
              {lv}
            </option>
          ))}
        </select>
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

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="grammar-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f6f6f6', textAlign: 'left' }}>
              <th style={{ padding: '8px 12px', width: 60 }}>#</th>
              <th style={{ padding: '8px 12px', width: 200 }}>语法</th>
              <th style={{ padding: '8px 12px', width: 200 }}>接续</th>
              <th style={{ padding: '8px 12px' }}>意思</th>
              <th style={{ padding: '8px 12px', width: 80 }}>级别</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((g, idx) => (
              <tr key={g.id} style={{ borderTop: '1px solid #eee' }}>
                <td style={{ padding: '8px 12px', color: '#999' }}>{idx + 1}</td>
                <td style={{ padding: '8px 12px', fontWeight: 600 }}>
                  <Link to={`/grammar/${g.id}`}>{g.pattern}</Link>
                </td>
                <td style={{ padding: '8px 12px', color: '#666', whiteSpace: 'pre-line' }}>
                  {g.connection}
                </td>
                <td style={{ padding: '8px 12px' }}>{g.meaning}</td>
                <td style={{ padding: '8px 12px', color: '#999' }}>{g.level}</td>
              </tr>
            ))}
            {!isLoading && filtered.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: '24px', textAlign: 'center', color: '#999' }}>
                  没有匹配的语法条目
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  )
}
