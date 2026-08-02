import { Button, Card, Chip, Input } from '@heroui/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'

import { SelectField } from '../components/ui/SelectField'
import { usePageActive } from '../components/layout/pageContext'
import { getTodayNewWords } from '../api/words'
import { useI18n } from '../i18n'
import { useAppStore } from '../store/useAppStore'
import { sessionPath, useActiveSessions } from '../store/useActiveSessions'
import type { Folder } from '../types'

type FormState = {
  name: string
  language: 'en' | 'jp'
}

const INITIAL_FORM: FormState = {
  name: '',
  language: 'en',
}

const FIELD = 'flex flex-col gap-1.5 text-sm'

/**
 * The wordlists hub: every list, what it owes today, and the two things you
 * can do with one — learn its new words or review its due ones.
 *
 * Learning and reviewing are per-wordlist, so their entry points live here on
 * the cards rather than in the sidebar. A card whose session is half-finished
 * says so and resumes it (the session page stays mounted; see
 * `useActiveSessions`), instead of quietly restarting from the top.
 */
export function FoldersPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const isActive = usePageActive()
  const folders = useAppStore((state) => state.folders)
  const dueReviews = useAppStore((state) => state.dueReviews)
  const hasLoadedReviews = useAppStore((state) => state.hasLoadedReviews)
  const isLoadingFolders = useAppStore((state) => state.isLoadingFolders)
  const isSubmitting = useAppStore((state) => state.isSubmitting)
  const error = useAppStore((state) => state.error)
  const sessions = useActiveSessions((state) => state.sessions)

  const [newWordCounts, setNewWordCounts] = useState<Record<string, number>>({})
  const [isCreating, setIsCreating] = useState(false)
  const [form, setForm] = useState<FormState>(INITIAL_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<FormState>(INITIAL_FORM)

  const refresh = useCallback(async () => {
    const store = useAppStore.getState()
    await Promise.all([
      store.fetchFolders(),
      store.fetchTodayReviews(),
      getTodayNewWords()
        .then((list) => {
          const counts: Record<string, number> = {}
          for (const word of Array.isArray(list) ? list : []) {
            counts[word.folderId] = (counts[word.folderId] ?? 0) + 1
          }
          setNewWordCounts(counts)
        })
        .catch(() => setNewWordCounts({})),
    ])
  }, [])

  // Refresh every time the page comes to the front, not just on mount: it
  // stays mounted in the background while the user learns or reviews, and the
  // "words left to learn" counts would otherwise be as old as the first visit.
  useEffect(() => {
    if (!isActive) return
    useAppStore.getState().clearError()
    void refresh()
  }, [isActive, refresh])

  // The store's due pool is live — it shrinks as a session submits ratings —
  // so prefer it over the folder payload's snapshot count.
  const dueByFolder = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const item of dueReviews) {
      counts[item.word.folderId] = (counts[item.word.folderId] ?? 0) + 1
    }
    return counts
  }, [dueReviews])

  const totalWords = folders.reduce(
    (sum, folder) => sum + (folder._count?.words ?? 0),
    0,
  )

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

  const languageOptions = [
    { value: 'en' as const, label: t('folders.englishOption') },
    { value: 'jp' as const, label: t('folders.japaneseOption') },
  ]

  return (
    <section className="page">
      <Card>
        <Card.Header className="flex-row flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            <Card.Title className="text-base">{t('folders.title')}</Card.Title>
            <Card.Description>
              {t('home.librarySummary', {
                folders: folders.length,
                words: totalWords,
              })}
            </Card.Description>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              isDisabled={isLoadingFolders}
              onPress={() => void refresh()}
            >
              {t('folders.refresh')}
            </Button>
            <Button
              size="sm"
              onPress={() => {
                setIsCreating((prev) => !prev)
                setForm(INITIAL_FORM)
              }}
            >
              {isCreating ? t('folders.collapse') : t('folders.createFolder')}
            </Button>
          </div>
        </Card.Header>

        {isCreating ? (
          <Card.Content>
            <form className="grid gap-3 sm:grid-cols-[1fr_auto_auto]" onSubmit={handleCreate}>
              <label className={FIELD}>
                <span>{t('folders.folderName')}</span>
                <Input
                  value={form.name}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, name: event.target.value }))
                  }
                  placeholder={t('folders.folderNamePlaceholder')}
                />
              </label>
              <label className={FIELD}>
                <span>{t('folders.language')}</span>
                <SelectField
                  value={form.language}
                  onChange={(value) => setForm((prev) => ({ ...prev, language: value }))}
                  options={languageOptions}
                />
              </label>
              <div className="flex items-end gap-2">
                <Button type="submit" isDisabled={isSubmitting}>
                  {isSubmitting ? t('folders.creating') : t('folders.create')}
                </Button>
                <Button
                  variant="outline"
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
          </Card.Content>
        ) : null}
      </Card>

      {error ? <p className="error-text">{error}</p> : null}

      {isLoadingFolders && folders.length === 0 ? (
        <Card>
          <Card.Content>{t('folders.loading')}</Card.Content>
        </Card>
      ) : null}

      {!isLoadingFolders && folders.length === 0 ? (
        <Card>
          <Card.Content className="muted">{t('folders.empty')}</Card.Content>
        </Card>
      ) : null}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))] items-stretch gap-4">
        {folders.map((folder) => {
          const wordCount = folder._count?.words ?? 0
          const due = hasLoadedReviews
            ? (dueByFolder[folder.id] ?? 0)
            : (folder.dueCount ?? 0)
          const newCount = newWordCounts[folder.id] ?? 0
          const mastered = folder.masteredCount ?? 0
          const masteredPercent =
            wordCount === 0 ? 0 : Math.round((mastered / wordCount) * 100)
          const learnSession = sessions[sessionPath('learn', folder.id)]
          const reviewSession = sessions[sessionPath('review', folder.id)]

          if (editingId === folder.id) {
            return (
              <Card key={folder.id}>
                <Card.Content>
                  <form
                    className="grid gap-3"
                    onSubmit={(event) => handleUpdate(event, folder.id)}
                  >
                    <label className={FIELD}>
                      <span>{t('folders.folderName')}</span>
                      <Input
                        value={editForm.name}
                        onChange={(event) =>
                          setEditForm((prev) => ({ ...prev, name: event.target.value }))
                        }
                      />
                    </label>
                    <label className={FIELD}>
                      <span>{t('folders.language')}</span>
                      <SelectField
                        value={editForm.language}
                        onChange={(value) =>
                          setEditForm((prev) => ({ ...prev, language: value }))
                        }
                        options={languageOptions}
                      />
                    </label>
                    <div className="flex gap-2">
                      <Button type="submit" size="sm" isDisabled={isSubmitting}>
                        {t('folders.save')}
                      </Button>
                      <Button variant="outline" size="sm" type="button" onPress={cancelEdit}>
                        {t('folders.cancel')}
                      </Button>
                    </div>
                  </form>
                </Card.Content>
              </Card>
            )
          }

          return (
            <Card key={folder.id} className="gap-3">
              <Card.Header className="flex-row items-start gap-2">
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/folders/${folder.id}`}
                    className="text-inherit no-underline"
                  >
                    <Card.Title className="truncate text-base">{folder.name}</Card.Title>
                  </Link>
                  <Card.Description>
                    {t('folders.wordCount', { count: wordCount })}
                  </Card.Description>
                </div>
                <Chip size="sm" variant="secondary">
                  {folder.language.toUpperCase()}
                </Chip>
              </Card.Header>

              <Card.Content className="flex flex-col gap-2.5">
                <div className="flex flex-wrap gap-1.5">
                  {due > 0 ? (
                    <Chip color="danger" size="sm" variant="soft">
                      {t('folders.dueToday', { count: due })}
                    </Chip>
                  ) : null}
                  {newCount > 0 ? (
                    <Chip color="accent" size="sm" variant="soft">
                      {t('folders.newToday', { count: newCount })}
                    </Chip>
                  ) : null}
                  {due === 0 && (folder.reviewedTodayCount ?? 0) > 0 ? (
                    <Chip color="success" size="sm" variant="soft">
                      {t('folders.reviewedToday', { count: folder.reviewedTodayCount ?? 0 })}
                    </Chip>
                  ) : null}
                </div>

                {wordCount > 0 ? (
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-tertiary">
                      {/* Gold, not accent: this bar reports what is already
                          mastered, and accent is reserved for what to do next
                          (the two buttons directly below it). */}
                      <span
                        className="block h-full rounded-[inherit] bg-gold transition-[width] duration-300"
                        style={{ width: `${masteredPercent}%` }}
                      />
                    </div>
                    <span className="text-xs whitespace-nowrap text-muted">
                      {t('folders.masteredOf', { mastered, total: wordCount })}
                    </span>
                  </div>
                ) : null}
              </Card.Content>

              <Card.Footer className="mt-auto flex-wrap gap-2">
                <Button
                  size="sm"
                  variant={learnSession ? 'primary' : 'secondary'}
                  isDisabled={!learnSession && newCount === 0}
                  onPress={() => navigate(sessionPath('learn', folder.id))}
                >
                  {learnSession
                    ? t('folders.resumeLearn', {
                        done: learnSession.done,
                        total: learnSession.total,
                      })
                    : newCount > 0
                      ? t('folders.learnWithCount', { count: newCount })
                      : t('folders.learn')}
                </Button>
                <Button
                  size="sm"
                  variant={reviewSession ? 'primary' : 'outline'}
                  isDisabled={!reviewSession && due === 0}
                  onPress={() => navigate(sessionPath('review', folder.id))}
                >
                  {reviewSession
                    ? t('folders.resumeReview', {
                        done: reviewSession.done,
                        total: reviewSession.total,
                      })
                    : due > 0
                      ? t('folders.reviewWithCount', { count: due })
                      : t('folders.review')}
                </Button>
                <div className="ml-auto flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    onPress={() => beginEdit(folder)}
                  >
                    {t('folders.rename')}
                  </Button>
                  <Button
                    variant="danger-soft"
                    size="sm"
                    type="button"
                    onPress={() => void handleDelete(folder)}
                    isDisabled={isSubmitting}
                  >
                    {t('folders.delete')}
                  </Button>
                </div>
              </Card.Footer>
            </Card>
          )
        })}
      </div>
    </section>
  )
}
