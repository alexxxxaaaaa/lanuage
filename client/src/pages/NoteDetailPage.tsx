import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getNoteById, type NoteDetail, updateNote } from '../api/notes'
import { RichTextEditor } from '../components/RichTextEditor'

export function NoteDetailPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const [note, setNote] = useState<NoteDetail | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    title: '',
    course: '',
    lesson: '',
    content: '',
  })

  const loadNote = async (noteId: string) => {
    setIsLoading(true)
    setError(null)
    try {
      const data = await getNoteById(noteId)
      setNote(data)
      setForm({
        title: data.title,
        course: data.course,
        lesson: data.lesson,
        content: data.content ?? '',
      })
    } catch {
      setError('加载笔记失败')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (!id) return
    void loadNote(id)
  }, [id])

  const handleUpdate = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!id) return
    const plain = form.content.replace(/<[^>]+>/g, '').trim()
    if (!plain) {
      setError('笔记内容不能为空')
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      await updateNote(id, form)
      setIsEditing(false)
      await loadNote(id)
    } catch {
      setError('更新笔记失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!id) return null

  return (
    <section className="page">
      <div className="section-header">
        <div>
          <p className="eyebrow">
            <Link to="/notes">← 返回笔记</Link>
          </p>
          <h2>{note?.title ?? '笔记详情'}</h2>
          <p className="muted">
            {note?.course || '未分类课程'} · {note?.lesson || '未分课次'}
          </p>
        </div>
        {note ? (
          <div className="compact-actions">
            {isEditing ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setIsEditing(false)
                  setForm({
                    title: note.title,
                    course: note.course,
                    lesson: note.lesson,
                    content: note.content ?? '',
                  })
                }}
              >
                取消编辑
              </button>
            ) : (
              <button type="button" className="primary-button" onClick={() => setIsEditing(true)}>
                编辑笔记
              </button>
            )}
          </div>
        ) : null}
      </div>

      {isLoading ? <div className="card">加载中...</div> : null}
      {error ? <p className="error-text">{error}</p> : null}

      {note ? (
        <>
          {isEditing ? (
            <form className="card word-form" onSubmit={(event) => void handleUpdate(event)}>
              <label>
                标题
                <input
                  value={form.title}
                  onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                  required
                />
              </label>
              <label>
                课程
                <input
                  value={form.course}
                  onChange={(event) => setForm((prev) => ({ ...prev, course: event.target.value }))}
                />
              </label>
              <label>
                课次
                <input
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
                  minHeight={260}
                />
              </label>
              <div className="form-actions">
                <button type="submit" className="primary-button" disabled={isSubmitting}>
                  {isSubmitting ? '保存中...' : '保存修改'}
                </button>
              </div>
            </form>
          ) : (
            <article className="card">
              <RichTextEditor value={note.content} readOnly minHeight={120} />
            </article>
          )}

          <div className="section-header">
            <h3>关联单词</h3>
            <button
              type="button"
              className="primary-button"
              onClick={() => navigate(`/words/new?noteId=${note.id}`)}
            >
              从此笔记添加单词
            </button>
          </div>

          {note.words.length === 0 ? (
            <div className="card empty-state">
              <p>当前笔记还没有关联单词。</p>
            </div>
          ) : (
            <div className="word-list">
              {note.words.map((word) => (
                <article key={word.id} className="card word-card">
                  <div className="word-card-title">
                    <strong className="word-title">{word.word}</strong>
                    <span className="muted word-reading">{word.reading}</span>
                  </div>
                  {word.meaning ? <p className="word-meaning">{word.meaning}</p> : null}
                  <Link
                    className="secondary-link"
                    to={`/folders/${word.folderId}#word-${word.id}`}
                  >
                    查看 / 编辑
                  </Link>
                </article>
              ))}
            </div>
          )}
        </>
      ) : null}
    </section>
  )
}
