import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Chip, Input, Switch, TextArea } from '@heroui/react'
import { confirm, alertDialog } from '../components/ui/dialog'
import { Search } from 'lucide-react'
import { useParams } from 'react-router'
import { generateExpressionCasual } from '../api/ai'
import {
  deleteExpression,
  getExpressionFolderById,
  updateExpression,
  createExpression,
} from '../api/expressions'
import { getErrorMessage } from '../api/error'
import { MultiSelectField, type SelectOption } from '../components/ui/SelectField'
import { SCENE_TAGS, parseSceneTags, serializeSceneTags } from '../lib/sceneTags'
import { useI18n } from '../i18n'
import type { Expression } from '../types'

type ExpressionForm = {
  zhText: string
  /** 目标语言的译文。存的时候按分类语言落到 enCasual / jpCasual，另一列留空。 */
  text: string
  sceneTags: string[]
  note: string
}

const initialForm: ExpressionForm = {
  zhText: '',
  text: '',
  sceneTags: [],
  note: '',
}

/** 分类语言决定译文存哪一列 —— 一条表达只属于一种语言，另一列恒为空。 */
function toCasualFields(language: 'en' | 'jp', text: string) {
  return language === 'jp'
    ? { jpCasual: text, enCasual: '' }
    : { enCasual: text, jpCasual: '' }
}

function casualOf(language: 'en' | 'jp', item: Expression) {
  return language === 'jp' ? item.jpCasual : item.enCasual
}

function readRevealedIds(storageKey: string | null): Set<string> {
  if (typeof window === 'undefined' || !storageKey) return new Set()
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? new Set(parsed.map(String)) : new Set()
  } catch {
    return new Set()
  }
}

export function ExpressionFolderDetailPage() {
  const { t } = useI18n()
  const { id } = useParams<{ id: string }>()
  const [folderName, setFolderName] = useState('')
  const [folderLanguage, setFolderLanguage] = useState<'en' | 'jp'>('en')
  const [rows, setRows] = useState<Expression[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [reloadToken, setReloadToken] = useState(0)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isAiLoading, setIsAiLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [query, setQuery] = useState('')
  const [form, setForm] = useState(initialForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingForm, setEditingForm] = useState(initialForm)
  // 润色 / 备注解析是「这次怎么生成」的开关，不是表达本身的内容 —— 所以不放进
  // form，保存后也不跟着清空，连着加几条时不用每条重新勾。
  const [polish, setPolish] = useState(false)
  const [explain, setExplain] = useState(false)
  const revealStorageKey = id ? `expr-revealed:${id}` : null
  const [revealedIds, setRevealedIds] = useState<Set<string>>(() =>
    readRevealedIds(revealStorageKey),
  )

  // 换文件夹时把「已揭晓」重新从 localStorage 读一遍。渲染期直接调整 state 是
  // React 官方给 props 变化重置 state 的写法，比放 effect 少一轮渲染。
  const [revealedKey, setRevealedKey] = useState(revealStorageKey)
  if (revealedKey !== revealStorageKey) {
    setRevealedKey(revealStorageKey)
    setRevealedIds(readRevealedIds(revealStorageKey))
  }

  useEffect(() => {
    if (typeof window === 'undefined' || !revealStorageKey) return
    try {
      window.localStorage.setItem(revealStorageKey, JSON.stringify(Array.from(revealedIds)))
    } catch {
      // ignore quota errors
    }
  }, [revealedIds, revealStorageKey])

  const toggleReveal = (expressionId: string) => {
    setRevealedIds((prev) => {
      const next = new Set(prev)
      if (next.has(expressionId)) next.delete(expressionId)
      else next.add(expressionId)
      return next
    })
  }

  useEffect(() => {
    if (!id) return
    let ignore = false
    async function loadFolder(folderId: string) {
      setIsLoading(true)
      setError(null)
      try {
        const folder = await getExpressionFolderById(folderId)
        if (ignore) return
        setFolderName(folder.name)
        setFolderLanguage(folder.language)
        setRows(folder.expressions ?? [])
      } catch (loadError) {
        if (!ignore) setError(getErrorMessage(loadError, t('expression.loadFolderError')))
      } finally {
        if (!ignore) setIsLoading(false)
      }
    }
    void loadFolder(id)
    return () => {
      ignore = true
    }
  }, [id, reloadToken, t])

  const filteredRows = useMemo(() => {
    const keyword = query.trim()
    if (!keyword) return rows
    return rows.filter((item) =>
      [item.zhText, item.enCasual, item.jpCasual, item.sceneTag, item.note]
        .join('\n')
        .includes(keyword),
    )
  }, [rows, query])

  const sceneTagOptions = useMemo<SelectOption[]>(
    () =>
      SCENE_TAGS.map((tag) => ({
        value: tag.value,
        label: t(`expression.sceneTags.${tag.labelKey}`),
        textValue: tag.value,
      })),
    [t],
  )

  const sceneTagLabel = (value: string) => {
    const known = SCENE_TAGS.find((tag) => tag.value === value)
    return known ? t(`expression.sceneTags.${known.labelKey}`) : value
  }

  /**
   * 词表之外的标签也列进选项 —— 早期 AI 自由生成过「点餐」「寒暄」这类，编辑
   * 一条老表达时它们得留在下拉框里，否则一存就被吞掉。
   */
  const sceneTagOptionsFor = (values: string[]): SelectOption[] => {
    const known = new Set(sceneTagOptions.map((option) => option.value))
    return [
      ...sceneTagOptions,
      ...values.filter((value) => !known.has(value)).map((value) => ({ value, label: value })),
    ]
  }

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
      const generated = await generateExpressionCasual({
        zhText,
        language: folderLanguage,
        sceneTags: form.sceneTags,
        polish,
        explain,
      })
      setForm((prev) => ({
        ...prev,
        // 开了润色才会变，没开时服务端原样回显。
        zhText: generated.zhText || prev.zhText,
        text: generated.text || prev.text,
        note: generated.note || prev.note,
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
        ...toCasualFields(folderLanguage, form.text),
        sceneTag: serializeSceneTags(form.sceneTags),
        note: form.note,
      })
      setForm(initialForm)
      setIsCreating(false)
      setReloadToken((token) => token + 1)
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
      text: casualOf(folderLanguage, item),
      sceneTags: parseSceneTags(item.sceneTag),
      note: item.note,
    })
  }

  const handleEditSave = async () => {
    if (!editingId) return
    try {
      await updateExpression(editingId, {
        zhText: editingForm.zhText,
        ...toCasualFields(folderLanguage, editingForm.text),
        sceneTag: serializeSceneTags(editingForm.sceneTags),
        note: editingForm.note,
      })
      setEditingId(null)
      setReloadToken((token) => token + 1)
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
      setReloadToken((token) => token + 1)
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
            {t('expression.sceneTag')}{' '}
            <span className="optional-mark">({t('expression.optional')})</span>
            <MultiSelectField
              aria-label={t('expression.sceneTag')}
              values={form.sceneTags}
              onChange={(next) => setForm((prev) => ({ ...prev, sceneTags: next }))}
              options={sceneTagOptionsFor(form.sceneTags)}
              placeholder={t('expression.scenePlaceholder')}
              fullWidth
            />
          </label>
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <Switch isSelected={polish} onChange={setPolish}>
              <Switch.Content>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
                <span className="grid gap-0.5">
                  <span>{t('expression.polish')}</span>
                  <span className="muted text-xs font-normal">
                    {t('expression.polishHint')}
                  </span>
                </span>
              </Switch.Content>
            </Switch>
            <Switch isSelected={explain} onChange={setExplain}>
              <Switch.Content>
                <Switch.Control>
                  <Switch.Thumb />
                </Switch.Control>
                <span className="grid gap-0.5">
                  <span>{t('expression.explain')}</span>
                  <span className="muted text-xs font-normal">
                    {t('expression.explainHint')}
                  </span>
                </span>
              </Switch.Content>
            </Switch>
          </div>
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
              value={form.text}
              onChange={(event) => setForm((prev) => ({ ...prev, text: event.target.value }))}
            />
          </label>
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

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
        <Input
          className="w-full pl-9"
          placeholder={t('expression.searchPlaceholder')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {isLoading ? <div className="card">{t('expression.loading')}</div> : null}
      {error ? <p className="error-text">{error}</p> : null}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))] items-stretch gap-4">
        {filteredRows.map((item) => {
          if (editingId === item.id) {
            return (
              <Card key={item.id}>
                <Card.Content className="grid gap-3">
                  <label className="form-field">
                    <span>{t('expression.zhText')}</span>
                    <TextArea
                      rows={2}
                      value={editingForm.zhText}
                      onChange={(event) =>
                        setEditingForm((prev) => ({ ...prev, zhText: event.target.value }))
                      }
                    />
                  </label>
                  <label className="form-field">
                    <span>
                      {folderLanguage === 'jp' ? t('expression.japanese') : t('expression.english')}
                    </span>
                    <TextArea
                      rows={2}
                      value={editingForm.text}
                      onChange={(event) =>
                        setEditingForm((prev) => ({ ...prev, text: event.target.value }))
                      }
                    />
                  </label>
                  <label className="form-field">
                    <span>{t('expression.sceneTag')}</span>
                    <MultiSelectField
                      aria-label={t('expression.sceneTag')}
                      values={editingForm.sceneTags}
                      onChange={(next) => setEditingForm((prev) => ({ ...prev, sceneTags: next }))}
                      options={sceneTagOptionsFor(editingForm.sceneTags)}
                      placeholder={t('expression.scenePlaceholder')}
                      fullWidth
                    />
                  </label>
                  <label className="form-field">
                    <span>{t('expression.note')}</span>
                    <TextArea
                      rows={2}
                      value={editingForm.note}
                      onChange={(event) =>
                        setEditingForm((prev) => ({ ...prev, note: event.target.value }))
                      }
                    />
                  </label>
                  <div className="mt-1 flex gap-2">
                    <Button size="sm" type="button" onPress={() => void handleEditSave()}>
                      {t('expression.save')}
                    </Button>
                    <Button variant="outline" size="sm" type="button" onPress={() => setEditingId(null)}>
                      {t('expression.cancel')}
                    </Button>
                  </div>
                </Card.Content>
              </Card>
            )
          }

          const sceneTags = parseSceneTags(item.sceneTag)
          const isRevealed = revealedIds.has(item.id)
          return (
            <Card key={item.id} className="gap-3">
              <Card.Header className="gap-2">
                {/* 表达是整句，不是单词 —— 得能换行。`.word-title` 那套 `nowrap`
                    是给词卡的单个词用的，套在这儿会把长句顶出卡片。 */}
                <Card.Title className="multiline-text text-lg/[1.5]">{item.zhText}</Card.Title>
                {sceneTags.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {sceneTags.map((tag) => (
                      <Chip key={tag} size="sm" variant="secondary">
                        {sceneTagLabel(tag)}
                      </Chip>
                    ))}
                  </div>
                ) : (
                  <Card.Description>{t('expression.unclassifiedScene')}</Card.Description>
                )}
              </Card.Header>

              <Card.Content className="grid gap-2.5">
                {/* 答案盖住时用高斯模糊，而不是把字藏起来：藏起来那一版要留一块
                    空白占位，不然一开一合整列卡片都在跳；模糊本身就是原尺寸，
                    看着也像「这里有东西，点开看」。 */}
                <div className="grid gap-1.5 rounded-xl bg-surface-secondary px-3.5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold tracking-[0.08em] text-muted uppercase">
                      {folderLanguage === 'jp' ? 'JP' : 'EN'}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      onPress={() => toggleReveal(item.id)}
                    >
                      {isRevealed ? t('expression.hideAnswer') : t('expression.showAnswer')}
                    </Button>
                  </div>
                  <p
                    className={`multiline-text text-[15px]/[1.6] transition-[filter] duration-200 ${
                      isRevealed ? '' : 'blur-[6px] select-none'
                    }`}
                  >
                    {casualOf(folderLanguage, item) || '—'}
                  </p>
                </div>
                {item.note ? (
                  <p className="muted multiline-text text-sm/[1.6]">{item.note}</p>
                ) : null}
              </Card.Content>

              <Card.Footer className="mt-auto justify-end gap-2">
                <Button variant="ghost" size="sm" type="button" onPress={() => startEdit(item)}>
                  {t('expression.edit')}
                </Button>
                <Button
                  variant="danger-soft"
                  size="sm"
                  type="button"
                  onPress={() => void handleDelete(item)}
                >
                  {t('expression.delete')}
                </Button>
              </Card.Footer>
            </Card>
          )
        })}
      </div>
    </section>
  )
}
