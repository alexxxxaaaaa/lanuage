import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@heroui/react'
import { CalendarDays, Check, CircleAlert, Loader2, Plus, Tag, Trash2 } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router'

import {
  deleteNote,
  getTags,
  getNoteById,
  updateNote,
  type NoteDetail,
  type NotePatch,
} from '../api/notes'
import { getErrorMessage } from '../api/error'
import { TagField } from '../components/notes/TagField'
import { NoteDateField } from '../components/notes/NoteDateField'
import { NoteEditor, type NoteEditorHandle } from '../components/notes/NoteEditor'
import { confirm } from '../components/ui/dialog'
import {
  usePageActive,
  usePageTitle,
  useOnPageReactivated,
} from '../components/layout/pageContext'
import { useAutoSave, type SaveStatus } from '../hooks/useAutoSave'
import { useNotesRevision } from '../store/useNotesRevision'
import { useI18n } from '../i18n'

function SaveIndicator({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  const { t } = useI18n()

  if (status === 'error') {
    return (
      <Button className="text-danger" size="sm" variant="ghost" onPress={onRetry}>
        <CircleAlert className="size-3.5" aria-hidden />
        {t('notes.saveFailed')}
      </Button>
    )
  }

  const label: Record<Exclude<SaveStatus, 'error'>, string> = {
    idle: '',
    pending: t('notes.unsaved'),
    saving: t('notes.saving'),
    saved: t('notes.saved'),
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
      {status === 'saving' ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
      {status === 'saved' ? <Check className="size-3.5" aria-hidden /> : null}
      {label[status]}
    </span>
  )
}

export function NoteDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { t } = useI18n()
  const isPageActive = usePageActive()

  const [note, setNote] = useState<NoteDetail | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 三个属性字段本地先改，落库交给自动保存；正文由编辑器自己拿着，页面只在它
  // 报变化时收一份字符串去存。
  const [title, setTitle] = useState('')
  const [tag, setTag] = useState('')
  const [noteAt, setNoteAt] = useState('')

  const titleRef = useRef<HTMLTextAreaElement>(null)
  const editorRef = useRef<NoteEditorHandle>(null)

  const bumpNotesRevision = useNotesRevision((state) => state.bump)

  const { status, queue, flush, isDirty } = useAutoSave<NotePatch>(
    useCallback(
      async (patch) => {
        if (!id) return
        await updateNote(id, patch)
        // 落地之后再通知列表页，它才不会读到改之前的那一版。
        bumpNotesRevision()
      },
      [id, bumpNotesRevision],
    ),
  )

  /** 标签、日期这种一次点定的字段不必等防抖。 */
  const commit = useCallback(
    (patch: NotePatch) => {
      queue(patch)
      void flush()
    },
    [queue, flush],
  )

  useEffect(() => {
    if (!id) return
    let ignore = false

    async function load(noteId: string) {
      setIsLoading(true)
      setError(null)
      try {
        const [data, tagOptions] = await Promise.all([getNoteById(noteId), getTags()])
        if (ignore) return
        setNote(data)
        setTitle(data.title)
        setTag(data.tag)
        setNoteAt(data.noteAt)
        setTags(tagOptions.map((option) => option.tag))
      } catch (loadError) {
        if (!ignore) setError(getErrorMessage(loadError, t('notes.loadError')))
      } finally {
        if (!ignore) setIsLoading(false)
      }
    }

    void load(id)
    return () => {
      ignore = true
    }
    // t 只用在报错文案上，不值得为它重新拉一次笔记。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // 从「新增单词」回来时关联单词会变。只换 note，可编辑的三个字段保持本地值 ——
  // 离开页面时已经 flush 过，服务端拿到的就是它们。
  useOnPageReactivated(() => {
    if (!id) return
    void getNoteById(id).then(setNote).catch(() => undefined)
    void getTags()
      .then((options) => setTags(options.map((option) => option.tag)))
      .catch(() => undefined)
  })

  // 页面退到后台就把待发的改动送出去。keep-alive 下组件不卸载，所以这一步比
  // 卸载兜底更常触发。
  useEffect(() => {
    if (!isPageActive) void flush()
  }, [isPageActive, flush])

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') void flush()
    }
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (isDirty()) event.preventDefault()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [flush, isDirty])

  // Cmd/Ctrl+S 立刻存一次。自动保存已经兜住了，但手会自己按。
  useEffect(() => {
    if (!isPageActive) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 's' || !(event.metaKey || event.ctrlKey)) return
      event.preventDefault()
      void flush()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isPageActive, flush])

  // 标题是会换行的 textarea，高度跟着内容走。
  useEffect(() => {
    const element = titleRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }, [title])

  const displayTitle = title.trim() || t('notes.untitled')
  usePageTitle(`/notes/${id ?? ''}`, note ? displayTitle : null)

  const handleDelete = async () => {
    if (!id) return
    const ok = await confirm({
      title: t('notes.deleteConfirmTitle'),
      content: t('notes.deleteConfirmBody', { title: displayTitle }),
      okText: t('notes.delete'),
      status: 'danger',
    })
    if (!ok) return
    try {
      await deleteNote(id)
      bumpNotesRevision()
      navigate('/notes', { replace: true })
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, t('notes.deleteError')))
    }
  }

  if (!id) return null

  return (
    <section className="page">
      {isLoading ? <div className="card">{t('notes.loading')}</div> : null}
      {error ? <p className="error-text">{error}</p> : null}

      {note ? (
        <div className="note-doc">
          <div className="flex items-center justify-between gap-3">
            <SaveIndicator status={status} onRetry={() => void flush()} />
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                onPress={() => navigate(`/words/new?noteId=${note.id}`)}
              >
                <Plus className="size-4" aria-hidden />
                {t('notes.addWord')}
              </Button>
              <Button size="sm" variant="ghost" onPress={() => void handleDelete()}>
                <Trash2 className="size-4" aria-hidden />
                {t('notes.delete')}
              </Button>
            </div>
          </div>

          <textarea
            className="note-title"
            ref={titleRef}
            rows={1}
            value={title}
            placeholder={t('notes.untitled')}
            onChange={(event) => {
              setTitle(event.target.value)
              queue({ title: event.target.value })
            }}
            onKeyDown={(event) => {
              // 标题不收换行，回车一律当「写完了，去正文」—— 跟 Notion 一致。
              if (event.key !== 'Enter') return
              event.preventDefault()
              editorRef.current?.focusStart()
            }}
          />

          <dl className="note-props">
            <div className="note-prop">
              <dt>
                <Tag className="size-4" aria-hidden />
                {t('notes.tag')}
              </dt>
              <dd>
                <TagField
                  value={tag}
                  options={tags}
                  onChange={(next) => {
                    setTag(next)
                    commit({ tag: next })
                  }}
                />
              </dd>
            </div>
            <div className="note-prop">
              <dt>
                <CalendarDays className="size-4" aria-hidden />
                {t('notes.noteAt')}
              </dt>
              <dd>
                <NoteDateField
                  value={noteAt}
                  onChange={(iso) => {
                    setNoteAt(iso)
                    commit({ noteAt: iso })
                  }}
                />
              </dd>
            </div>
          </dl>

          <NoteEditor
            ref={editorRef}
            initialContent={note.content}
            onChange={(content) => queue({ content })}
          />

          <div className="mt-2 flex flex-col gap-3 border-t border-separator pt-5">
            <h3 className="m-0 text-base">
              {t('notes.linkedWords', { count: note.words.length })}
            </h3>
            {note.words.length === 0 ? (
              <p className="muted m-0 text-sm">{t('notes.noLinkedWords')}</p>
            ) : (
              <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
                {note.words.map((word) => (
                  <li key={word.id}>
                    <Link
                      className="flex flex-col gap-0.5 rounded-xl bg-surface-secondary px-3.5 py-2.5 no-underline hover:bg-surface-tertiary"
                      to={`/folders/${word.folderIds[0] ?? ''}#word-${word.id}`}
                    >
                      <span className="flex items-baseline gap-2">
                        <b className="text-foreground">{word.word}</b>
                        <span className="text-[13px] text-muted">{word.reading}</span>
                        <span className="ml-auto shrink-0 text-xs text-muted">
                          {word.folders.map((folder) => folder.name).join(' / ')}
                        </span>
                      </span>
                      {word.meaning ? (
                        <span className="truncate text-[13px] text-muted">{word.meaning}</span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </section>
  )
}
