import { useEffect, useState } from 'react'
import { SelectField } from '../components/ui/SelectField'
import { Button, Input, TextArea } from '@heroui/react'
import { Link, useNavigate, useParams } from 'react-router'
import { fillGrammarByAi } from '../api/ai'
import { deleteGrammar, getGrammar, updateGrammar } from '../api/grammar'
import {
  listGrammarQuestionsFor,
  type GrammarQuestion,
} from '../api/grammarQuestions'
import { GrammarQuestionCard } from '../components/GrammarQuestionCard'
import { getErrorMessage } from '../api/error'
import type { Grammar, UpdateGrammarPayload } from '../types'

function toForm(g: Grammar): UpdateGrammarPayload {
  return {
    pattern: g.pattern,
    connection: g.connection,
    meaning: g.meaning,
    example: g.example,
    exampleZh: g.exampleZh,
    note: g.note,
    level: g.level,
  }
}

export function GrammarDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [grammar, setGrammar] = useState<Grammar | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isEditing, setIsEditing] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isAiFilling, setIsAiFilling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<UpdateGrammarPayload>({})
  const [questions, setQuestions] = useState<GrammarQuestion[]>([])
  const [isLoadingQuestions, setIsLoadingQuestions] = useState(true)

  useEffect(() => {
    if (!id) return
    let ignore = false
    async function load(grammarId: string) {
      setIsLoading(true)
      setError(null)
      try {
        const g = await getGrammar(grammarId)
        if (ignore) return
        setGrammar(g)
        setForm(toForm(g))
      } catch (err) {
        if (!ignore) setError(getErrorMessage(err, '加载失败'))
      } finally {
        if (!ignore) setIsLoading(false)
      }
    }
    void load(id)
    return () => {
      ignore = true
    }
  }, [id])

  useEffect(() => {
    if (!id) return
    let ignore = false
    async function loadQuestions(grammarId: string) {
      setIsLoadingQuestions(true)
      try {
        const rows = await listGrammarQuestionsFor(grammarId)
        if (!ignore) setQuestions(rows)
      } catch {
        if (!ignore) setQuestions([])
      } finally {
        if (!ignore) setIsLoadingQuestions(false)
      }
    }
    void loadQuestions(id)
    return () => {
      ignore = true
    }
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
      setForm(toForm(updated))
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
          <h2 style={{ fontFamily: 'serif' }}>
            {grammar.pattern}
            <span className="folder-language tag-inline">{grammar.level}</span>
          </h2>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {isEditing ? (
            <Button type="button" onPress={() => { setIsEditing(false); setForm(toForm(grammar)) }}>
              取消
            </Button>
          ) : (
            <>
              <Button type="button" onPress={() => setIsEditing(true)}>编辑</Button>
              <Button type="button" onPress={() => void handleDelete()} style={{ color: '#c33' }}>
                删除
              </Button>
            </>
          )}
        </div>
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      {isEditing ? (
        <form className="card word-form" onSubmit={(event) => void handleSave(event)}>
          <label>句型 *
            <div style={{ display: 'flex', gap: 8 }}>
              <Input
                value={form.pattern ?? ''}
                onChange={(e) => setForm((p) => ({ ...p, pattern: e.target.value }))}
                style={{ flex: 1 }}
              />
              <Button
                type="button"
                onPress={() => void handleAiFill()}
                isDisabled={isAiFilling || !form.pattern?.trim()}
                render={(props) => <button {...props} title="根据句型用 AI 重新生成其它字段" />}
              >
                {isAiFilling ? 'AI 填充中...' : 'AI 填充'}
              </Button>
            </div>
          </label>
          <label>接续
            <TextArea
              rows={2}
              value={form.connection ?? ''}
              onChange={(e) => setForm((p) => ({ ...p, connection: e.target.value }))}
            />
          </label>
          <label>意思
            <Input
              value={form.meaning ?? ''}
              onChange={(e) => setForm((p) => ({ ...p, meaning: e.target.value }))}
            />
          </label>
          <label>例句(日文)
            <TextArea
              rows={4}
              value={form.example ?? ''}
              onChange={(e) => setForm((p) => ({ ...p, example: e.target.value }))}
            />
          </label>
          <label>例句翻译(中文)
            <TextArea
              rows={4}
              value={form.exampleZh ?? ''}
              onChange={(e) => setForm((p) => ({ ...p, exampleZh: e.target.value }))}
            />
          </label>
          <label>注意点
            <TextArea
              rows={2}
              value={form.note ?? ''}
              onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))}
            />
          </label>
          <label>级别
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
              {isSubmitting ? '保存中...' : '保存'}
            </Button>
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

          <div className="card">
            <h3 style={{ marginTop: 0 }}>练习</h3>
            {isLoadingQuestions ? (
              <p className="muted">加载中…</p>
            ) : questions.length === 0 ? (
              <p className="muted">这条语法还没有题目</p>
            ) : (
              <div className="flex flex-col gap-3 border-t border-black/6 px-4.5 pt-1 pb-4.5">
                {questions.map((q) => (
                  <GrammarQuestionCard key={q.id} question={q} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
