import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { createExpressionFolder, getExpressionFolders } from '../api/expressions'
import { getErrorMessage } from '../api/error'
import { useI18n } from '../i18n'
import type { ExpressionFolder } from '../types'

export function ExpressionsPage() {
  const { t } = useI18n()
  const [folders, setFolders] = useState<ExpressionFolder[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [form, setForm] = useState({
    name: '',
    language: 'en' as 'en' | 'jp',
  })

  const loadFolders = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const list = await getExpressionFolders()
      setFolders(Array.isArray(list) ? list : [])
    } catch (loadError) {
      setError(getErrorMessage(loadError, t('expression.loadFolderError')))
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadFolders()
  }, [])

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
      await loadFolders()
    } catch (submitError) {
      setError(getErrorMessage(submitError, t('expression.createFolderError')))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="page">
      <div className="section-header">
        <div>
          <p className="eyebrow">Expressions</p>
          <h2>{t('expression.title')}</h2>
          <p className="muted">{t('expression.subtitle')}</p>
        </div>
        <button
          type="button"
          className="primary-button"
          onClick={() => setIsCreating((prev) => !prev)}
        >
          {isCreating ? t('expression.collapseCreate') : t('expression.createFolder')}
        </button>
      </div>

      {isCreating ? (
        <form className="card word-form" onSubmit={(event) => void handleCreateFolder(event)}>
          <label>
            {t('expression.folderName')}
            <input
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder={t('expression.folderNamePlaceholder')}
              required
            />
          </label>
          <label>
            {t('expression.language')}
            <select
              value={form.language}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, language: event.target.value as 'en' | 'jp' }))
              }
            >
              <option value="en">{t('expression.english')}</option>
              <option value="jp">{t('expression.japanese')}</option>
            </select>
          </label>
          <div className="form-actions">
            <button type="submit" className="primary-button" disabled={isSubmitting}>
              {isSubmitting ? t('expression.creating') : t('expression.saveFolder')}
            </button>
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
          </article>
        ))}
      </div>
    </section>
  )
}
