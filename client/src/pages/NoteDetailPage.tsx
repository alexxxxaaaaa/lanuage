import { useEffect, useState } from 'react'
import { Button, Input } from '@heroui/react'
import { Link, useNavigate, useParams } from 'react-router'
import { getNoteById, type NoteDetail, updateNote } from '../api/notes'
import { RichTextEditor } from '../components/RichTextEditor'

export function NoteDetailPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const [note, setNote] = useState<NoteDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [form, setForm] = useState({
    title: '',
    course: '',
    lesson: '',
    content: '',
  })

  useEffect(() => {
    if (!id) return
    let ignore = false
    async function loadNote(noteId: string) {
      setIsLoading(true)
      setError(null)
      try {
        const data = await getNoteById(noteId)
        if (ignore) return
        setNote(data)
        setForm({
          title: data.title,
          course: data.course,
          lesson: data.lesson,
          content: data.content ?? '',
        })
      } catch {
        if (!ignore) setError('加载笔记失败')
      } finally {
        if (!ignore) setIsLoading(false)
      }
    }
    void loadNote(id)
    return () => {
      ignore = true
    }
  }, [id, reloadToken])

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
      setReloadToken((token) => token + 1)
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
          <h2>{note?.title ?? '笔记详情'}</h2>
          <p className="muted">
            {note?.course || '未分类课程'} · {note?.lesson || '未分课次'}
          </p>
        </div>
        {note ? (
          <div className="compact-actions">
            {isEditing ? (
              <Button variant="outline"
                type="button"
                onPress={() => {
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
              </Button>
            ) : (
              <Button type="button" onPress={() => setIsEditing(true)}>
                编辑笔记
              </Button>
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
                  minHeight={260}
                />
              </label>
              <div className="form-actions">
                <Button type="submit" isDisabled={isSubmitting}>
                  {isSubmitting ? '保存中...' : '保存修改'}
                </Button>
              </div>
            </form>
          ) : (
            <article className="card">
              <RichTextEditor value={note.content} readOnly minHeight={120} />
            </article>
          )}

          <div className="section-header">
            <h3>关联单词</h3>
            <Button
              type="button"
              onPress={() => navigate(`/words/new?noteId=${note.id}`)}
            >
              从此笔记添加单词
            </Button>
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
                    className="button button--outline"
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
