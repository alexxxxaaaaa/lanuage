import { useEffect, useMemo, useState } from 'react'
import { SelectField } from '../components/ui/SelectField'
import { Button, Input } from '@heroui/react'
import { Link } from 'react-router'
import { createNote, getNotes } from '../api/notes'
import { RichTextEditor } from '../components/RichTextEditor'
import type { Note } from '../types'

export function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [courseFilter, setCourseFilter] = useState<string>('')
  const [reloadToken, setReloadToken] = useState(0)
  const [form, setForm] = useState({
    title: '',
    content: '',
    course: '新概念英语',
    lesson: '',
  })

  const courseOptions = useMemo(() => {
    const set = new Set<string>()
    for (const note of notes) {
      const c = (note.course ?? '').trim()
      if (c) set.add(c)
    }
    return Array.from(set).sort()
  }, [notes])

  const filteredNotes = useMemo(() => {
    if (!courseFilter) return notes
    return notes.filter((note) => (note.course ?? '').trim() === courseFilter)
  }, [notes, courseFilter])

  useEffect(() => {
    let ignore = false
    async function loadNotes() {
      setIsLoading(true)
      setError(null)
      try {
        const rows = await getNotes()
        if (!ignore) setNotes(Array.isArray(rows) ? rows : [])
      } catch {
        if (!ignore) setError('加载笔记失败')
      } finally {
        if (!ignore) setIsLoading(false)
      }
    }
    void loadNotes()
    return () => {
      ignore = true
    }
  }, [reloadToken])

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault()
    const plain = form.content.replace(/<[^>]+>/g, '').trim()
    if (!plain) {
      setError('笔记内容不能为空')
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      await createNote(form)
      setForm((prev) => ({ ...prev, title: '', content: '', lesson: '' }))
      setIsCreating(false)
      setReloadToken((token) => token + 1)
    } catch {
      setError('创建笔记失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="page">
      <div className="section-header">
        <div>
          <h2>课程笔记</h2>
        </div>
        <div className="compact-actions">
          <Button
            type="button"
            onPress={() => {
              setIsCreating((prev) => !prev)
              setForm({ title: '', content: '', course: '新概念英语', lesson: '' })
            }}
          >
            {isCreating ? '收起添加' : '添加笔记'}
          </Button>
        </div>
      </div>

      {isCreating ? (
        <form className="card word-form" onSubmit={(event) => void handleCreate(event)}>
          <label>
            标题
            <Input
              value={form.title}
              onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
            />
          </label>
          <label>
            课程
            <Input
              value={form.course}
              onChange={(event) => setForm((prev) => ({ ...prev, course: event.target.value }))}
            />
          </label>
          <label>
            课次
            <Input
              value={form.lesson}
              onChange={(event) => setForm((prev) => ({ ...prev, lesson: event.target.value }))}
              placeholder="例如：L23"
            />
          </label>
          <label>
            内容
            <RichTextEditor
              value={form.content}
              onChange={(html) => setForm((prev) => ({ ...prev, content: html }))}
              placeholder="开始记录笔记..."
              minHeight={220}
            />
          </label>
          <div className="form-actions">
            <Button type="submit" isDisabled={isSubmitting}>
              {isSubmitting ? '保存中...' : '保存笔记'}
            </Button>
          </div>
        </form>
      ) : null}

      {courseOptions.length > 0 ? (
        <div className="card expression-filter-row expression-filter-row-single">
          <SelectField
            value={courseFilter || undefined}
            onChange={(v) => setCourseFilter(v ?? '')}
            placeholder="全部课程"
              className="min-w-[180px]"
            options={courseOptions.map((course) => ({
              value: course,
              label: course,
            }))}
          />
        </div>
      ) : null}

      {isLoading ? <div className="card">加载中...</div> : null}
      {error ? <p className="error-text">{error}</p> : null}
      <div className="folder-grid">
        {filteredNotes.map((note) => (
          <article key={note.id} className="card folder-card">
            <Link className="folder-card-link" to={`/notes/${note.id}`}>
              <div className="folder-top">
                <strong>{note.title}</strong>
                <span className="folder-language">{note.lesson || '未分课次'}</span>
              </div>
              <p className="muted">{note.course || '未分类课程'}</p>
              <p className="muted">关联单词：{note._count?.words ?? 0}</p>
            </Link>
          </article>
        ))}
      </div>
    </section>
  )
}
