import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '../i18n'
import { useAppStore } from '../store/useAppStore'
import type { Folder } from '../types'

type FormState = {
  name: string
  language: 'en' | 'jp'
}

const INITIAL_FORM: FormState = {
  name: '',
  language: 'en',
}

export function FoldersPage() {
  const { t } = useI18n()
  const folders = useAppStore((state) => state.folders)
  const isLoadingFolders = useAppStore((state) => state.isLoadingFolders)
  const isSubmitting = useAppStore((state) => state.isSubmitting)
  const error = useAppStore((state) => state.error)
  const folderList = Array.isArray(folders) ? folders : []

  const [isCreating, setIsCreating] = useState(false)
  const [form, setForm] = useState<FormState>(INITIAL_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<FormState>(INITIAL_FORM)

  useEffect(() => {
    useAppStore.getState().clearError()
    void useAppStore.getState().fetchFolders()
  }, [])

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!form.name.trim()) return

    const folder = await useAppStore.getState().createFolder({
      name: form.name.trim(),
      language: form.language,
    })

    if (folder) {
      setForm(INITIAL_FORM)
      setIsCreating(false)
    }
  }

  const beginEdit = (folder: Folder) => {
    setEditingId(folder.id)
    setEditForm({ name: folder.name, language: folder.language })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditForm(INITIAL_FORM)
  }

  const handleUpdate = async (event: React.FormEvent, id: string) => {
    event.preventDefault()
    if (!editForm.name.trim()) return

    await useAppStore.getState().updateFolder(id, {
      name: editForm.name.trim(),
      language: editForm.language,
    })

    cancelEdit()
  }

  const handleDelete = async (folder: Folder) => {
    const wordCount = folder._count?.words ?? 0
    const suffix =
      wordCount > 0 ? ` ${t('folders.deleteConfirmWithWords', { count: wordCount })}` : ''
    const confirmed = window.confirm(
      `${t('folders.deleteConfirmTitle', { name: folder.name })}${suffix}`,
    )
    if (!confirmed) return

    await useAppStore.getState().deleteFolder(folder.id)
  }

  return (
    <section className="page">
      <div className="section-header">
        <div>
          <p className="eyebrow">Folders</p>
          <h2>{t('folders.title')}</h2>
        </div>
        <div className="hero-actions compact-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={isLoadingFolders}
            onClick={() => void useAppStore.getState().fetchFolders()}
          >
            {t('folders.refresh')}
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              setIsCreating((prev) => !prev)
              setForm(INITIAL_FORM)
            }}
          >
            {isCreating ? t('folders.collapse') : t('folders.createFolder')}
          </button>
        </div>
      </div>

      {isCreating ? (
        <form className="card folder-form" onSubmit={handleCreate}>
          <label className="form-field">
            <span>{t('folders.folderName')}</span>
            <input
              type="text"
              value={form.name}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, name: event.target.value }))
              }
              placeholder={t('folders.folderNamePlaceholder')}
              required
            />
          </label>
          <label className="form-field">
            <span>{t('folders.language')}</span>
            <select
              value={form.language}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  language: event.target.value as 'en' | 'jp',
                }))
              }
            >
              <option value="en">{t('folders.englishOption')}</option>
              <option value="jp">{t('folders.japaneseOption')}</option>
            </select>
          </label>
          <div className="form-actions">
            <button type="submit" className="primary-button" disabled={isSubmitting}>
              {isSubmitting ? t('folders.creating') : t('folders.create')}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setIsCreating(false)
                setForm(INITIAL_FORM)
              }}
            >
              {t('folders.cancel')}
            </button>
          </div>
        </form>
      ) : null}

      {isLoadingFolders ? <div className="card">{t('folders.loading')}</div> : null}
      {error ? <p className="error-text">{error}</p> : null}

      {!isLoadingFolders && folderList.length === 0 ? (
        <div className="card empty-state">
          <p>{t('folders.empty')}</p>
        </div>
      ) : null}

      <div className="folder-grid">
        {folderList.map((folder) =>
          editingId === folder.id ? (
            <form
              key={folder.id}
              className="card folder-card folder-edit"
              onSubmit={(event) => handleUpdate(event, folder.id)}
            >
              <label className="form-field">
                <span>{t('folders.folderName')}</span>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(event) =>
                    setEditForm((prev) => ({ ...prev, name: event.target.value }))
                  }
                  required
                />
              </label>
              <label className="form-field">
                <span>{t('folders.language')}</span>
                <select
                  value={editForm.language}
                  onChange={(event) =>
                    setEditForm((prev) => ({
                      ...prev,
                      language: event.target.value as 'en' | 'jp',
                    }))
                  }
                >
                  <option value="en">{t('folders.englishOption')}</option>
                  <option value="jp">{t('folders.japaneseOption')}</option>
                </select>
              </label>
              <div className="form-actions">
                <button
                  type="submit"
                  className="primary-button"
                  disabled={isSubmitting}
                >
                  {t('folders.save')}
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={cancelEdit}
                >
                  {t('folders.cancel')}
                </button>
              </div>
            </form>
          ) : (
            <article key={folder.id} className="card folder-card">
              <Link className="folder-card-link" to={`/folders/${folder.id}`}>
                <div className="folder-top">
                  <strong>{folder.name}</strong>
                  <div className="folder-top-tags">
                    {(folder.dueCount ?? 0) > 0 ? (
                      <span className="folder-due-pill">
                        {t('folders.dueToday', { count: folder.dueCount ?? 0 })}
                      </span>
                    ) : (folder.reviewedTodayCount ?? 0) > 0 ? (
                      <span className="folder-done-pill">
                        {t('folders.reviewedToday', {
                          count: folder.reviewedTodayCount ?? 0,
                        })}
                      </span>
                    ) : null}
                    <span className="folder-language">
                      {folder.language.toUpperCase()}
                    </span>
                  </div>
                </div>
                <p className="muted">{t('folders.wordCount', { count: folder._count?.words ?? 0 })}</p>
                {(folder._count?.words ?? 0) > 0 ? (
                  <div className="folder-mastery">
                    <div className="folder-mastery-bar">
                      <span
                        className="folder-mastery-fill"
                        style={{
                          width: `${Math.round(
                            ((folder.masteredCount ?? 0) / (folder._count?.words ?? 1)) * 100,
                          )}%`,
                        }}
                      />
                    </div>
                    <span className="folder-mastery-label">
                      {t('folders.masteredOf', {
                        mastered: folder.masteredCount ?? 0,
                        total: folder._count?.words ?? 0,
                      })}
                    </span>
                  </div>
                ) : null}
              </Link>
              <div className="folder-card-actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => beginEdit(folder)}
                >
                  {t('folders.rename')}
                </button>
                <button
                  type="button"
                  className="ghost-button danger"
                  onClick={() => void handleDelete(folder)}
                  disabled={isSubmitting}
                >
                  {t('folders.delete')}
                </button>
              </div>
            </article>
          ),
        )}
      </div>
    </section>
  )
}
