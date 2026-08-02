import { useEffect, useMemo, useState } from 'react'
import { Button, Input, TextArea } from '@heroui/react'
import { confirm, alertDialog } from '../components/ui/dialog'
import { Search } from 'lucide-react'
import { useParams } from 'react-router'
import { generateExpressionCasual, translateExpressionToZh } from '../api/ai'
import {
  deleteExpression,
  getExpressionFolderById,
  updateExpression,
  createExpression,
} from '../api/expressions'
import { getErrorMessage } from '../api/error'
import { useI18n } from '../i18n'
import type { Expression } from '../types'

const initialForm = {
  zhText: '',
  sceneTag: '',
  note: '',
  enCasual: '',
  jpCasual: '',
}

export function ExpressionFolderDetailPage() {
  const { t } = useI18n()
  const { id } = useParams<{ id: string }>()
  const [folderName, setFolderName] = useState('')
  const [folderLanguage, setFolderLanguage] = useState<'en' | 'jp'>('en')
  const [rows, setRows] = useState<Expression[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isAiLoading, setIsAiLoading] = useState(false)
  const [isAiTranslateLoading, setIsAiTranslateLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [query, setQuery] = useState('')
  const [form, setForm] = useState(initialForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingForm, setEditingForm] = useState(initialForm)
  const revealStorageKey = id ? `expr-revealed:${id}` : null
  const [revealedIds, setRevealedIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined' || !id) return new Set()
    try {
      const raw = window.localStorage.getItem(`expr-revealed:${id}`)
      if (!raw) return new Set()
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? new Set(parsed.map(String)) : new Set()
    } catch {
      return new Set()
    }
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !revealStorageKey) return
    try {
      window.localStorage.setItem(revealStorageKey, JSON.stringify(Array.from(revealedIds)))
    } catch {
      // ignore quota errors
    }
  }, [revealedIds, revealStorageKey])

  useEffect(() => {
    if (typeof window === 'undefined' || !revealStorageKey) return
    try {
      const raw = window.localStorage.getItem(revealStorageKey)
      if (!raw) {
        setRevealedIds(new Set())
        return
      }
      const parsed = JSON.parse(raw)
      setRevealedIds(Array.isArray(parsed) ? new Set(parsed.map(String)) : new Set())
    } catch {
      setRevealedIds(new Set())
    }
  }, [revealStorageKey])

  const toggleReveal = (expressionId: string) => {
    setRevealedIds((prev) => {
      const next = new Set(prev)
      if (next.has(expressionId)) next.delete(expressionId)
      else next.add(expressionId)
      return next
    })
  }

  const loadFolder = async () => {
    if (!id) return
    setIsLoading(true)
    setError(null)
    try {
      const folder = await getExpressionFolderById(id)
      setFolderName(folder.name)
      setFolderLanguage(folder.language)
      setRows(folder.expressions ?? [])
    } catch (loadError) {
      setError(getErrorMessage(loadError, t('expression.loadFolderError')))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadFolder()
  }, [id])

  const filteredRows = useMemo(() => {
    const keyword = query.trim()
    if (!keyword) return rows
    return rows.filter((item) =>
      [item.zhText, item.enCasual, item.jpCasual, item.sceneTag, item.note]
        .join('\n')
        .includes(keyword),
    )
  }, [rows, query])

  const handleAiGenerate = async () => {
    const zhText = form.zhText.trim()
    if (!zhText) {
      void alertDialog.warning({
        title: t('expression.enterZhFirst'),
        content: t('expression.enterZhHint'),
        okText: t('expression.save'),
      })
      return
    }
    setIsAiLoading(true)
    try {
      const generated = await generateExpressionCasual({ zhText, language: folderLanguage })
      setForm((prev) => ({
        ...prev,
        enCasual:
          folderLanguage === 'en' ? generated.enCasual || prev.enCasual : '',
        jpCasual:
          folderLanguage === 'jp' ? generated.jpCasual || prev.jpCasual : '',
        sceneTag: generated.sceneTag || prev.sceneTag,
      }))
    } catch (aiError) {
      const retry = await confirm({
        title: t('expression.aiFailed'),
        content: getErrorMessage(aiError, t('expression.aiRetry')),
        okText: t('expression.retry'),
        cancelText: t('expression.cancel'),
      })
      if (retry) void handleAiGenerate()
    } finally {
      setIsAiLoading(false)
    }
  }

  const handleAiTranslate = async () => {
    const sourceText = (folderLanguage === 'jp' ? form.jpCasual : form.enCasual).trim()
    if (!sourceText) {
      void alertDialog.warning({
        title: t('expression.enterSourceFirst'),
        content: t('expression.enterSourceHint'),
        okText: t('expression.save'),
      })
      return
    }
    setIsAiTranslateLoading(true)
    try {
      const translated = await translateExpressionToZh({
        text: sourceText,
        language: folderLanguage,
      })
      setForm((prev) => ({
        ...prev,
        zhText: translated.zhText || prev.zhText,
        sceneTag: prev.sceneTag || translated.sceneTag,
      }))
    } catch (aiError) {
      const retry = await confirm({
        title: t('expression.aiTranslateFailed'),
        content: getErrorMessage(aiError, t('expression.aiRetry')),
        okText: t('expression.retry'),
        cancelText: t('expression.cancel'),
      })
      if (retry) void handleAiTranslate()
    } finally {
      setIsAiTranslateLoading(false)
    }
  }

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!id) return
    if (!form.zhText.trim()) {
      setError(t('expression.zhRequired'))
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      await createExpression({
        folderId: id,
        zhText: form.zhText,
        enCasual: folderLanguage === 'en' ? form.enCasual : '',
        jpCasual: folderLanguage === 'jp' ? form.jpCasual : '',
        sceneTag: form.sceneTag,
        note: form.note,
      })
      setForm(initialForm)
      setIsCreating(false)
      await loadFolder()
    } catch (submitError) {
      setError(getErrorMessage(submitError, t('expression.createError')))
    } finally {
      setIsSubmitting(false)
    }
  }

  const startEdit = (item: Expression) => {
    setEditingId(item.id)
    setEditingForm({
      zhText: item.zhText,
      enCasual: item.enCasual,
      jpCasual: item.jpCasual,
      sceneTag: item.sceneTag,
      note: item.note,
    })
  }

  const handleEditSave = async () => {
    if (!editingId) return
    try {
      await updateExpression(editingId, {
        ...editingForm,
        enCasual: folderLanguage === 'en' ? editingForm.enCasual : '',
        jpCasual: folderLanguage === 'jp' ? editingForm.jpCasual : '',
      })
      setEditingId(null)
      await loadFolder()
    } catch (updateError) {
      setError(getErrorMessage(updateError, t('expression.updateError')))
    }
  }

  const handleDelete = async (item: Expression) => {
    const ok = await confirm({
      title: t('expression.deleteConfirmTitle'),
      content: item.zhText,
      okText: t('expression.delete'),
      cancelText: t('expression.cancel'),
      status: 'danger',
    })
    if (!ok) return
    try {
      await deleteExpression(item.id)
      await loadFolder()
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, t('expression.deleteError')))
    }
  }

  return (
    <section className="page">
      <div className="section-header">
        <div>
          <h2>{folderName || t('expression.folderDetailTitle')}</h2>
          <p className="muted">
            {t('expression.language')}：
            {folderLanguage === 'jp' ? t('expression.japanese') : t('expression.english')}
          </p>
        </div>
        <Button
          type="button"
          onPress={() => setIsCreating((prev) => !prev)}
        >
          {isCreating ? t('expression.collapseCreate') : t('expression.addExpression')}
        </Button>
      </div>

      {isCreating ? (
        <form className="card word-form" onSubmit={(event) => void handleCreate(event)}>
          <label>
            {t('expression.zhText')} <span className="required-mark">*</span>
            <TextArea
              rows={3}
              value={form.zhText}
              onChange={(event) => setForm((prev) => ({ ...prev, zhText: event.target.value }))}
            />
          </label>
          <label>
            {t('expression.sceneTag')} <span className="optional-mark">(可选)</span>
            <Input
              value={form.sceneTag}
              onChange={(event) => setForm((prev) => ({ ...prev, sceneTag: event.target.value }))}
              placeholder={t('expression.scenePlaceholder')}
            />
          </label>
          <div className="form-actions">
            <Button variant="outline"
              type="button"
              onPress={() => void handleAiGenerate()}
              isDisabled={isAiLoading}
            >
              {isAiLoading ? t('expression.generatingByAi') : t('expression.generateByAi')}
            </Button>
          </div>
          <label>
            {folderLanguage === 'jp' ? t('expression.japanese') : t('expression.english')}
            <TextArea
              rows={3}
              value={folderLanguage === 'jp' ? form.jpCasual : form.enCasual}
              onChange={(event) =>
                setForm((prev) =>
                  folderLanguage === 'jp'
                    ? { ...prev, jpCasual: event.target.value, enCasual: '' }
                    : { ...prev, enCasual: event.target.value, jpCasual: '' },
                )
              }
            />
          </label>
          <div className="form-actions">
            <Button variant="outline"
              type="button"
              onPress={() => void handleAiTranslate()}
              isDisabled={isAiTranslateLoading}
            >
              {isAiTranslateLoading
                ? t('expression.translatingByAi')
                : t('expression.translateToZh')}
            </Button>
          </div>
          <label>
            {t('expression.note')}
            <TextArea
              rows={3}
              value={form.note}
              onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))}
            />
          </label>
          <div className="form-actions">
            <Button type="submit" isDisabled={isSubmitting}>
              {isSubmitting ? t('expression.saving') : t('expression.saveExpression')}
            </Button>
          </div>
        </form>
      ) : null}

      <div className="card expression-filter-row expression-filter-row-single">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
          <Input
            className="w-full pl-9"
            placeholder={t('expression.searchPlaceholder')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>

      {isLoading ? <div className="card">{t('expression.loading')}</div> : null}
      {error ? <p className="error-text">{error}</p> : null}

      <div className="word-list">
        {filteredRows.map((item) => {
          const isEditing = editingId === item.id
          return (
            <article key={item.id} className="card word-card">
              {isEditing ? (
                <div className="word-form">
                  <label>
                    {t('expression.zhText')}
                    <TextArea
                      rows={2}
                      value={editingForm.zhText}
                      onChange={(event) =>
                        setEditingForm((prev) => ({ ...prev, zhText: event.target.value }))
                      }
                    />
                  </label>
                  <label>
                    {folderLanguage === 'jp' ? t('expression.japanese') : t('expression.english')}
                    <TextArea
                      rows={2}
                      value={
                        folderLanguage === 'jp'
                          ? editingForm.jpCasual
                          : editingForm.enCasual
                      }
                      onChange={(event) =>
                        setEditingForm((prev) =>
                          folderLanguage === 'jp'
                            ? { ...prev, jpCasual: event.target.value, enCasual: '' }
                            : { ...prev, enCasual: event.target.value, jpCasual: '' },
                        )
                      }
                    />
                  </label>
                  <label>
                    {t('expression.sceneTag')}
                    <Input
                      value={editingForm.sceneTag}
                      onChange={(event) =>
                        setEditingForm((prev) => ({ ...prev, sceneTag: event.target.value }))
                      }
                    />
                  </label>
                  <label>
                    {t('expression.note')}
                    <TextArea
                      rows={2}
                      value={editingForm.note}
                      onChange={(event) =>
                        setEditingForm((prev) => ({ ...prev, note: event.target.value }))
                      }
                    />
                  </label>
                  <div className="compact-actions">
                    <Button type="button" onPress={() => void handleEditSave()}>
                      {t('expression.save')}
                    </Button>
                    <Button variant="outline" type="button" onPress={() => setEditingId(null)}>
                      {t('expression.cancel')}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="word-card-header">
                    <div>
                      <strong className="word-title">{item.zhText}</strong>
                      <p className="muted">{item.sceneTag || t('expression.unclassifiedScene')}</p>
                    </div>
                  </div>
                  <div className="grid gap-1.5">
                    <p
                      className="word-note-text"
                      style={{ visibility: revealedIds.has(item.id) ? 'visible' : 'hidden' }}
                    >
                      <strong>{folderLanguage === 'jp' ? 'JP' : 'EN'}:</strong>{' '}
                      {folderLanguage === 'jp'
                        ? item.jpCasual || '-'
                        : item.enCasual || '-'}
                    </p>
                    <Button variant="outline" size="sm" className="justify-self-start rounded-md text-xs"
                      type="button"
                      onPress={() => toggleReveal(item.id)}
                    >
                      {revealedIds.has(item.id)
                        ? t('expression.hideAnswer')
                        : t('expression.showAnswer')}
                    </Button>
                    {item.note ? <p className="muted word-note-text">{item.note}</p> : null}
                  </div>
                  <div className="compact-actions">
                    <Button variant="outline" type="button" onPress={() => startEdit(item)}>
                      {t('expression.edit')}
                    </Button>
                    <Button variant="danger-soft" size="sm" type="button" onPress={() => handleDelete(item)}>
                      {t('expression.delete')}
                    </Button>
                  </div>
                </>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}
