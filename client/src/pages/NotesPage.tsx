import { useEffect, useState } from 'react'
import {
  Button,
  Chip,
  EmptyState,
  SearchField,
  Table,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
} from '@heroui/react'
import { FileText, Plus, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router'

import {
  createNote,
  deleteNote,
  getTags,
  getNotes,
  type TagOption,
} from '../api/notes'
import { getErrorMessage } from '../api/error'
import { confirm } from '../components/ui/dialog'
import { useOnPageReactivated } from '../components/layout/pageContext'
import { formatListDate } from '../lib/datetime'
import { useNotesRevision } from '../store/useNotesRevision'
import { useI18n } from '../i18n'
import type { NoteListItem } from '../types'

/** 搜索是打到服务端的（正文只有那边有），所以别每敲一个字就发一次。 */
const SEARCH_DEBOUNCE_MS = 250

// 标签名是用户自己敲的字符串，直接当 key 会跟「全部」撞名。加个前缀隔开。
const ALL_TAGS_KEY = 'all'
const TAG_KEY_PREFIX = 'tag:'

export function NotesPage() {
  const navigate = useNavigate()
  const { t, language } = useI18n()

  const [notes, setNotes] = useState<NoteListItem[]>([])
  const [tags, setTags] = useState<TagOption[]>([])
  const [tag, setTag] = useState('')
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 刷新信号是全局的：详情页保存成功后也会 bump，所以「改完立刻返回列表」不会
  // 因为保存请求还没落地就读到旧数据。
  const revision = useNotesRevision((state) => state.revision)
  const reload = useNotesRevision((state) => state.bump)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    let ignore = false
    async function load() {
      setIsLoading(true)
      setError(null)
      try {
        const rows = await getNotes({ tag, q: debouncedQuery })
        if (!ignore) setNotes(rows)
      } catch (loadError) {
        if (!ignore) setError(getErrorMessage(loadError, t('notes.loadError')))
      } finally {
        if (!ignore) setIsLoading(false)
      }
    }
    void load()
    return () => {
      ignore = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag, debouncedQuery, revision])

  // 标签选项跟着笔记走，但不受当前筛选影响 —— 否则选中一个标签之后其它选项
  // 就消失了，没法切换。
  useEffect(() => {
    let ignore = false
    void getTags()
      .then((options) => {
        if (!ignore) setTags(options)
      })
      .catch(() => undefined)
    return () => {
      ignore = true
    }
  }, [revision])

  // 从详情页回来时标题、标签、时间都可能变过。
  useOnPageReactivated(reload)

  const handleCreate = async () => {
    setIsCreating(true)
    setError(null)
    try {
      // 先落一条空笔记再跳进去，之后全靠自动保存打补丁。当前筛的标签顺手带上。
      const created = await createNote(tag ? { tag } : {})
      navigate(`/notes/${created.id}`)
    } catch (createError) {
      setError(getErrorMessage(createError, t('notes.createError')))
    } finally {
      setIsCreating(false)
    }
  }

  const handleDelete = async (note: NoteListItem) => {
    const ok = await confirm({
      title: t('notes.deleteConfirmTitle'),
      content: t('notes.deleteConfirmBody', {
        title: note.title.trim() || t('notes.untitled'),
      }),
      okText: t('notes.delete'),
      status: 'danger',
    })
    if (!ok) return
    try {
      await deleteNote(note.id)
      setNotes((rows) => rows.filter((row) => row.id !== note.id))
      reload()
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, t('notes.deleteError')))
    }
  }

  const isFiltered = tag !== '' || debouncedQuery !== ''

  return (
    <section className="page">
      <div className="section-header">
        <div>
          <h2>{t('routes.notes')}</h2>
          <p className="muted">{t('notes.subtitle')}</p>
        </div>
        <Button isDisabled={isCreating} onPress={() => void handleCreate()}>
          <Plus className="size-4" aria-hidden />
          {t('notes.create')}
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        <SearchField
          aria-label={t('notes.searchPlaceholder')}
          className="max-w-96"
          value={query}
          onChange={setQuery}
        >
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder={t('notes.searchPlaceholder')} />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>

        {tags.length > 0 ? (
          <ToggleButtonGroup
            isDetached
            aria-label={t('notes.tag')}
            className="flex-wrap"
            disallowEmptySelection
            selectedKeys={[tag ? `${TAG_KEY_PREFIX}${tag}` : ALL_TAGS_KEY]}
            selectionMode="single"
            size="sm"
            onSelectionChange={(keys) => {
              const [key] = [...keys]
              const next = typeof key === 'string' ? key : ALL_TAGS_KEY
              setTag(next.startsWith(TAG_KEY_PREFIX) ? next.slice(TAG_KEY_PREFIX.length) : '')
            }}
          >
            <ToggleButton id={ALL_TAGS_KEY}>{t('notes.allTags')}</ToggleButton>
            {tags.map((option) => (
              <ToggleButton id={`${TAG_KEY_PREFIX}${option.tag}`} key={option.tag}>
                {option.tag}
                <span className="text-muted">{option.count}</span>
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        ) : null}
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      <Table>
        <Table.ScrollContainer>
          {/* 固定布局：默认的 auto 布局会按内容重新分配，下面声明的列宽等于白写。 */}
          <Table.Content
            aria-label={t('routes.notes')}
            className="min-w-[760px] [table-layout:fixed]"
          >
            <Table.Header>
              {/* 两个文本列给百分比宽度，否则自动布局会按内容分配，摘要被挤成一小条。 */}
              <Table.Column isRowHeader width="24%">
                {t('notes.columnTitle')}
              </Table.Column>
              <Table.Column width="46%">{t('notes.columnPreview')}</Table.Column>
              <Table.Column width={140}>{t('notes.tag')}</Table.Column>
              <Table.Column width={80}>{t('notes.columnWords')}</Table.Column>
              <Table.Column width={120}>{t('notes.noteAt')}</Table.Column>
              {/* 操作列，表头留空是这类列的通行做法。 */}
              <Table.Column width={64}>{''}</Table.Column>
            </Table.Header>
            <Table.Body
              renderEmptyState={() => (
                <EmptyState className="flex flex-col items-center gap-3 py-12 text-center">
                  <FileText className="size-8 text-muted" aria-hidden />
                  <span className="text-sm text-muted">
                    {isLoading
                      ? t('notes.loading')
                      : isFiltered
                        ? t('notes.emptyFiltered')
                        : t('notes.empty')}
                  </span>
                  {isLoading || isFiltered ? null : (
                    <Button size="sm" variant="ghost" onPress={() => void handleCreate()}>
                      {t('notes.create')}
                    </Button>
                  )}
                </EmptyState>
              )}
            >
              {notes.map((note) => (
                // 整行是个链接（react-aria 的 href），点击、Cmd+点击新开标签都照常，
                // 不用再拿伪元素盖一层。客户端路由由 AriaRouterProvider 接上。
                <Table.Row className="group" href={`/notes/${note.id}`} key={note.id}>
                  {/* 每格一行文本，行高和内边距全交给 HeroUI —— 之前把标题和摘要
                      叠在同一格里，行被撑高、上下留白就没了。 */}
                  <Table.Cell className="truncate font-medium text-foreground">
                    {note.title.trim() || t('notes.untitled')}
                  </Table.Cell>
                  <Table.Cell className="truncate text-muted">
                    {note.preview || '—'}
                  </Table.Cell>
                  <Table.Cell>
                    {note.tag ? (
                      <Chip className="max-w-full" color="accent" size="sm" variant="soft">
                        <Chip.Label className="truncate">{note.tag}</Chip.Label>
                      </Chip>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </Table.Cell>
                  <Table.Cell className="tabular-nums text-muted">
                    {note.wordCount > 0 ? note.wordCount : '—'}
                  </Table.Cell>
                  <Table.Cell className="tabular-nums text-muted">
                    {formatListDate(note.noteAt, language)}
                  </Table.Cell>
                  <Table.Cell>
                    <Tooltip delay={300}>
                      <Button
                        isIconOnly
                        aria-label={t('notes.delete')}
                        className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100"
                        size="sm"
                        variant="ghost"
                        onPress={() => void handleDelete(note)}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                      <Tooltip.Content>{t('notes.delete')}</Tooltip.Content>
                    </Tooltip>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>

    </section>
  )
}
