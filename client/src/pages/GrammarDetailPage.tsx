import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { fillGrammarByAi } from '../api/ai'
import { deleteGrammar, getGrammar, updateGrammar } from '../api/grammar'
import { getErrorMessage } from '../api/error'
import type { Grammar, UpdateGrammarPayload } from '../types'

export function GrammarDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [grammar, setGrammar] = useState<Grammar | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isAiFilling, setIsAiFilling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<UpdateGrammarPayload>({})

  const load = async () => {
    if (!id) return
    setIsLoading(true)
    setError(null)
    try {
      const g = await getGrammar(id)
      setGrammar(g)
      setForm({
        pattern: g.pattern,
        connection: g.connection,
        meaning: g.meaning,
        example: g.example,
        exampleZh: g.exampleZh,
        note: g.note,
        level: g.level,
      })
    } catch (err) {
      setError(getErrorMessage(err, '加载失败'))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const handleAiFill = async () => {
    const pattern = form.pattern?.trim()
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

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!id) return
    if (!form.pattern?.trim()) {
      setError('句型不能为空')
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      const updated = await updateGrammar(id, form)
      setGrammar(updated)
      setIsEditing(false)
    } catch (err) {
      setError(getErrorMessage(err, '保存失败'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!id) return
    if (!confirm(`确认删除句型「${grammar?.pattern}」?`)) return
    try {
      await deleteGrammar(id)
      navigate('/grammar')
    } catch (err) {
      setError(getErrorMessage(err, '删除失败'))
    }
  }

  if (isLoading) return <section className="page"><div className="card">加载中...</div></section>
  if (!grammar) {
    return (
      <section className="page">
        <div className="card">
          {error ?? '没找到该语法条目'}
          <p>
            <Link to="/grammar">返回列表</Link>
          </p>
        </div>
      </section>
    )
  }

  const examples = grammar.example.split('\n').filter((s) => s.trim())
  const translations = grammar.exampleZh.split('\n').filter((s) => s.trim())

  return (
    <section className="page">
      <div className="section-header">
        <div>
          <p className="eyebrow">
            <Link to="/grammar">语法</Link> / {grammar.level}
          </p>
          <h2 style={{ fontFamily: 'serif' }}>{grammar.pattern}</h2>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isEditing ? (
            <button type="button" onClick={() => { setIsEditing(false); void load() }}>
              取消
            </button>
          ) : (
            <>
              <button type="button" onClick={() => setIsEditing(true)}>编辑</button>
              <button type="button" onClick={() => void handleDelete()} style={{ color: '#c33' }}>
                删除
              </button>
            </>
          )}
        </div>
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      {isEditing ? (
        <form className="card word-form" onSubmit={(event) => void handleSave(event)}>
          <label>句型 *
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={form.pattern ?? ''}
                onChange={(e) => setForm((p) => ({ ...p, pattern: e.target.value }))}
                required
                style={{ flex: 1 }}
              />
              <button
                type="button"
                onClick={() => void handleAiFill()}
                disabled={isAiFilling || !form.pattern?.trim()}
                title="根据句型用 AI 重新生成其它字段"
              >
                {isAiFilling ? 'AI 填充中...' : 'AI 填充'}
              </button>
            </div>
          </label>
          <label>接续
            <textarea
              rows={2}
              value={form.connection ?? ''}
              onChange={(e) => setForm((p) => ({ ...p, connection: e.target.value }))}
            />
          </label>
          <label>意思
            <input
              value={form.meaning ?? ''}
              onChange={(e) => setForm((p) => ({ ...p, meaning: e.target.value }))}
            />
          </label>
          <label>例句(日文)
            <textarea
              rows={4}
              value={form.example ?? ''}
              onChange={(e) => setForm((p) => ({ ...p, example: e.target.value }))}
            />
          </label>
          <label>例句翻译(中文)
            <textarea
              rows={4}
              value={form.exampleZh ?? ''}
              onChange={(e) => setForm((p) => ({ ...p, exampleZh: e.target.value }))}
            />
          </label>
          <label>注意点
            <textarea
              rows={2}
              value={form.note ?? ''}
              onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))}
            />
          </label>
          <label>级别
            <select
              value={form.level ?? 'N1'}
              onChange={(e) => setForm((p) => ({ ...p, level: e.target.value }))}
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
              {isSubmitting ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      ) : (
        <>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>意思</h3>
            <p>{grammar.meaning || <span className="muted">(空)</span>}</p>
            <h3>接续</h3>
            <p style={{ whiteSpace: 'pre-line' }}>{grammar.connection || <span className="muted">(空)</span>}</p>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>例句</h3>
            {examples.length === 0 ? (
              <p className="muted">(空)</p>
            ) : (
              <ol style={{ paddingLeft: 20 }}>
                {examples.map((jp, i) => (
                  <li key={i} style={{ marginBottom: 10 }}>
                    <div>{jp}</div>
                    {translations[i] ? (
                      <div className="muted" style={{ fontSize: '0.9em' }}>{translations[i]}</div>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </div>

          {grammar.note ? (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>注意点</h3>
              <p style={{ whiteSpace: 'pre-line' }}>{grammar.note}</p>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}
