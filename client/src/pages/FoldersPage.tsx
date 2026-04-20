import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
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
    const confirmed = window.confirm(
      `确定要删除分类「${folder.name}」吗？${
        wordCount > 0 ? `这会同时删除该分类下的 ${wordCount} 个单词。` : ''
      }`,
    )
    if (!confirmed) return

    await useAppStore.getState().deleteFolder(folder.id)
  }

  return (
    <section className="page">
      <div className="section-header">
        <div>
          <p className="eyebrow">Folders</p>
          <h2>分类列表</h2>
        </div>
        <div className="hero-actions compact-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={isLoadingFolders}
            onClick={() => void useAppStore.getState().fetchFolders()}
          >
            刷新
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => {
              setIsCreating((prev) => !prev)
              setForm(INITIAL_FORM)
            }}
          >
            {isCreating ? '收起' : '新建分类'}
          </button>
        </div>
      </div>

      {isCreating ? (
        <form className="card folder-form" onSubmit={handleCreate}>
          <label className="form-field">
            <span>分类名称</span>
            <input
              type="text"
              value={form.name}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, name: event.target.value }))
              }
              placeholder="例如：CET-6 / N3"
              required
            />
          </label>
          <label className="form-field">
            <span>语言</span>
            <select
              value={form.language}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  language: event.target.value as 'en' | 'jp',
                }))
              }
            >
              <option value="en">英语 (en)</option>
              <option value="jp">日语 (jp)</option>
            </select>
          </label>
          <div className="form-actions">
            <button type="submit" className="primary-button" disabled={isSubmitting}>
              {isSubmitting ? '创建中...' : '创建'}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setIsCreating(false)
                setForm(INITIAL_FORM)
              }}
            >
              取消
            </button>
          </div>
        </form>
      ) : null}

      {isLoadingFolders ? <div className="card">正在加载分类...</div> : null}
      {error ? <p className="error-text">{error}</p> : null}

      {!isLoadingFolders && folderList.length === 0 ? (
        <div className="card empty-state">
          <p>还没有分类，点击右上角「新建分类」开始吧。</p>
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
                <span>分类名称</span>
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
                <span>语言</span>
                <select
                  value={editForm.language}
                  onChange={(event) =>
                    setEditForm((prev) => ({
                      ...prev,
                      language: event.target.value as 'en' | 'jp',
                    }))
                  }
                >
                  <option value="en">英语 (en)</option>
                  <option value="jp">日语 (jp)</option>
                </select>
              </label>
              <div className="form-actions">
                <button
                  type="submit"
                  className="primary-button"
                  disabled={isSubmitting}
                >
                  保存
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={cancelEdit}
                >
                  取消
                </button>
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
                <p className="muted">单词数量：{folder._count?.words ?? 0}</p>
              </Link>
              <div className="folder-card-actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => beginEdit(folder)}
                >
                  重命名
                </button>
                <button
                  type="button"
                  className="ghost-button danger"
                  onClick={() => void handleDelete(folder)}
                  disabled={isSubmitting}
                >
                  删除
                </button>
              </div>
            </article>
          ),
        )}
      </div>
    </section>
  )
}
