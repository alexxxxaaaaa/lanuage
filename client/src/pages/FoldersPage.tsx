import { useEffect, useState } from 'react'
import { SelectField } from '../components/ui/SelectField'
import { Button, Input } from '@heroui/react'
import { Link } from 'react-router'
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
          <Button variant="outline"
            type="button"
            isDisabled={isLoadingFolders}
            onPress={() => void useAppStore.getState().fetchFolders()}
          >
            {t('folders.refresh')}
          </Button>
          <Button
            type="button"
            onPress={() => {
              setIsCreating((prev) => !prev)
              setForm(INITIAL_FORM)
            }}
          >
            {isCreating ? t('folders.collapse') : t('folders.createFolder')}
          </Button>
        </div>
      </div>

      {isCreating ? (
        <form className="card grid gap-3" onSubmit={handleCreate}>
          <label className="form-field">
            <span>{t('folders.folderName')}</span>
            <Input
              value={form.name}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, name: event.target.value }))
              }
              placeholder={t('folders.folderNamePlaceholder')}
            />
          </label>
          <label className="form-field">
            <span>{t('folders.language')}</span>
            <SelectField
              value={form.language}
              onChange={(v) =>
                setForm((prev) => ({ ...prev, language: v }))
              }
              options={[
                { value: 'en', label: t('folders.englishOption') },
                { value: 'jp', label: t('folders.japaneseOption') },
              ]}
            />
          </label>
          <div className="form-actions">
            <Button type="submit" isDisabled={isSubmitting}>
              {isSubmitting ? t('folders.creating') : t('folders.create')}
            </Button>
            <Button variant="outline"
              type="button"
              onPress={() => {
                setIsCreating(false)
                setForm(INITIAL_FORM)
              }}
            >
              {t('folders.cancel')}
            </Button>
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
              className="card folder-card grid gap-3"
              onSubmit={(event) => handleUpdate(event, folder.id)}
            >
              <label className="form-field">
                <span>{t('folders.folderName')}</span>
                <Input
                  value={editForm.name}
                  onChange={(event) =>
                    setEditForm((prev) => ({ ...prev, name: event.target.value }))
                  }
                />
              </label>
              <label className="form-field">
                <span>{t('folders.language')}</span>
                <SelectField
                  value={editForm.language}
                  onChange={(v) =>
                    setEditForm((prev) => ({ ...prev, language: v }))
                  }
                  options={[
                    { value: 'en', label: t('folders.englishOption') },
                    { value: 'jp', label: t('folders.japaneseOption') },
                  ]}
                />
              </label>
              <div className="form-actions">
                <Button
                  type="submit"
                  isDisabled={isSubmitting}
                >
                  {t('folders.save')}
                </Button>
                <Button variant="outline"
                  type="button"
                  onPress={cancelEdit}
                >
                  {t('folders.cancel')}
                </Button>
              </div>
            </form>
          ) : (
            <article key={folder.id} className="card folder-card">
              <Link className="folder-card-link" to={`/folders/${folder.id}`}>
                <div className="folder-top">
                  <strong>{folder.name}</strong>
                  <span className="folder-language">
                    {folder.language.toUpperCase()}
                  </span>
                </div>
                {(folder.dueCount ?? 0) > 0 ? (
                  <div className="-mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full bg-red-500/12 px-2 py-1 text-xs font-bold whitespace-nowrap text-red-700">
                      {t('folders.dueToday', { count: folder.dueCount ?? 0 })}
                    </span>
                  </div>
                ) : (folder.reviewedTodayCount ?? 0) > 0 ? (
                  <div className="-mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full bg-green-600/12 px-2 py-1 text-xs font-bold whitespace-nowrap text-green-700">
                      {t('folders.reviewedToday', {
                        count: folder.reviewedTodayCount ?? 0,
                      })}
                    </span>
                  </div>
                ) : null}
                <p className="muted">{t('folders.wordCount', { count: folder._count?.words ?? 0 })}</p>
                {(folder._count?.words ?? 0) > 0 ? (
                  <div className="mt-0.5 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-foreground/8">
                      <span
                        className="block h-full rounded-[inherit] bg-accent transition-[width] duration-300"
                        style={{
                          width: `${Math.round(
                            ((folder.masteredCount ?? 0) / (folder._count?.words ?? 1)) * 100,
                          )}%`,
                        }}
                      />
                    </div>
                    <span className="text-xs whitespace-nowrap text-muted">
                      {t('folders.masteredOf', {
                        mastered: folder.masteredCount ?? 0,
                        total: folder._count?.words ?? 0,
                      })}
                    </span>
                  </div>
                ) : null}
              </Link>
              <div className="folder-card-actions">
                <Button variant="outline" size="sm"
                  type="button"
                  onPress={() => beginEdit(folder)}
                >
                  {t('folders.rename')}
                </Button>
                <Button variant="danger-soft" size="sm"
                  type="button"
                  onPress={() => void handleDelete(folder)}
                  isDisabled={isSubmitting}
                >
                  {t('folders.delete')}
                </Button>
              </div>
            </article>
          ),
        )}
      </div>
    </section>
  )
}
