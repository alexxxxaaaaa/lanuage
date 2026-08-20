import { useEffect, useState } from 'react'
import { SelectField } from '../components/ui/SelectField'
import { Button, Input } from '@heroui/react'
import { Link } from 'react-router'
import { confirm } from '../components/ui/dialog'
import {
  createExpressionFolder,
  deleteExpressionFolder,
  getExpressionFolders,
} from '../api/expressions'
import { getErrorMessage } from '../api/error'
import { useI18n } from '../i18n'
import type { ExpressionFolder } from '../types'

export function ExpressionsPage() {
  const { t } = useI18n()
  const [folders, setFolders] = useState<ExpressionFolder[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [form, setForm] = useState({
    name: '',
    language: 'en' as 'en' | 'jp',
  })

  useEffect(() => {
    let ignore = false
    async function loadFolders() {
      setIsLoading(true)
      setError(null)
      try {
        const list = await getExpressionFolders()
        if (!ignore) setFolders(Array.isArray(list) ? list : [])
      } catch (loadError) {
        if (!ignore) setError(getErrorMessage(loadError, t('expression.loadFolderError')))
      } finally {
        if (!ignore) setIsLoading(false)
      }
    }
    void loadFolders()
    return () => {
      ignore = true
    }
  }, [reloadToken, t])

  const handleCreateFolder = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!form.name.trim()) {
      setError(t('expression.emptyFolderName'))
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      await createExpressionFolder(form)
      setForm({ name: '', language: 'en' })
      setIsCreating(false)
      setReloadToken((token) => token + 1)
    } catch (submitError) {
      setError(getErrorMessage(submitError, t('expression.createFolderError')))
    } finally {
      setIsSubmitting(false)
    }
  }

  // 分类里的表达会跟着一起没，所以确认框里把条数说清楚再删。
  const handleDeleteFolder = async (folder: ExpressionFolder) => {
    const count = folder._count?.expressions ?? 0
    const ok = await confirm({
      title: t('expression.deleteFolderConfirmTitle', { name: folder.name }),
      content: count > 0 ? t('expression.deleteFolderConfirmWithCount', { count }) : undefined,
      okText: t('expression.delete'),
      cancelText: t('expression.cancel'),
      status: 'danger',
    })
    if (!ok) return
    setDeletingId(folder.id)
    setError(null)
    try {
      await deleteExpressionFolder(folder.id)
      setReloadToken((token) => token + 1)
    } catch (deleteError) {
      setError(getErrorMessage(deleteError, t('expression.deleteFolderError')))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <section className="page">
      <div className="section-header">
        <div>
          <h2>{t('expression.title')}</h2>
          <p className="muted">{t('expression.subtitle')}</p>
        </div>
        <Button
          type="button"
          onPress={() => setIsCreating((prev) => !prev)}
        >
          {isCreating ? t('expression.collapseCreate') : t('expression.createFolder')}
        </Button>
      </div>

      {isCreating ? (
        <form className="card word-form" onSubmit={(event) => void handleCreateFolder(event)}>
          <label>
            {t('expression.folderName')}
            <Input
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder={t('expression.folderNamePlaceholder')}
            />
          </label>
          <label>
            {t('expression.language')}
            <SelectField
              value={form.language}
              onChange={(v) => setForm((prev) => ({ ...prev, language: v }))}
              options={[
                { value: 'en', label: t('expression.english') },
                { value: 'jp', label: t('expression.japanese') },
              ]}
            />
          </label>
          <div className="form-actions">
            <Button type="submit" isDisabled={isSubmitting}>
              {isSubmitting ? t('expression.creating') : t('expression.saveFolder')}
            </Button>
          </div>
        </form>
      ) : null}

      {isLoading ? <div className="card">{t('expression.loading')}</div> : null}
      {error ? <p className="error-text">{error}</p> : null}

      <div className="folder-grid">
        {folders.map((folder) => (
          <article key={folder.id} className="card folder-card">
            <Link className="folder-card-link" to={`/expressions/folders/${folder.id}`}>
              <div className="folder-top">
                <strong>{folder.name}</strong>
                <span className="folder-language">
                  {folder.language === 'jp' ? t('expression.japanese') : t('expression.english')}
                </span>
              </div>
              <p className="muted">
                {t('expression.expressionCount', { count: folder._count?.expressions ?? 0 })}
              </p>
            </Link>
            {/* 删除放在链接外面单起一行 —— 整张卡片都是进分类的入口，按钮嵌在
                里面点删除会顺手跳走。 */}
            <div className="folder-card-actions">
              <Button
                className="ml-auto"
                variant="danger-soft"
                size="sm"
                type="button"
                isDisabled={deletingId === folder.id}
                onPress={() => void handleDeleteFolder(folder)}
              >
                {t('expression.deleteFolder')}
              </Button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
