import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Modal } from 'antd'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { isDuplicateWordError } from '../api/error'
import { useAppStore } from '../store/useAppStore'

const initialForm = {
  folderId: '',
  word: '',
  reading: '',
  meaning: '',
  example: '',
  note: '',
}

export function AddWordPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const prefillFolderId = searchParams.get('folderId') ?? ''
  const folders = useAppStore((state) => state.folders)
  const isLoadingFolders = useAppStore((state) => state.isLoadingFolders)
  const isSubmitting = useAppStore((state) => state.isSubmitting)
  const error = useAppStore((state) => state.error)
  const folderList = useMemo(
    () => (Array.isArray(folders) ? folders : []),
    [folders],
  )

  const [form, setForm] = useState({ ...initialForm, folderId: prefillFolderId })
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const selectedFolder = useMemo(
    () => folderList.find((folder) => folder.id === form.folderId),
    [folderList, form.folderId],
  )
  const wordInputRef = useRef<HTMLInputElement>(null)
  const successTimerRef = useRef<number | null>(null)

  useEffect(() => {
    useAppStore.getState().clearError()
    void useAppStore.getState().fetchFolders()
    return () => {
      if (successTimerRef.current !== null) {
        window.clearTimeout(successTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (prefillFolderId) {
      setForm((current) => ({ ...current, folderId: prefillFolderId }))
    }
  }, [prefillFolderId])

  const showSuccess = (message: string) => {
    setSuccessMessage(message)
    if (successTimerRef.current !== null) {
      window.clearTimeout(successTimerRef.current)
    }
    successTimerRef.current = window.setTimeout(() => {
      setSuccessMessage(null)
      successTimerRef.current = null
    }, 2500)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!selectedFolder) {
      return
    }

    const savedWord = form.word

    try {
      await useAppStore.getState().createWord({
        folderId: form.folderId,
        word: form.word,
        reading: form.reading,
        meaning: form.meaning,
        example: form.example,
        note: form.note,
        language: selectedFolder.language,
      })

      setForm((current) => ({
        ...initialForm,
        folderId: current.folderId,
      }))
      showSuccess(`已添加「${savedWord}」，可以继续添加下一个`)
      wordInputRef.current?.focus()
    } catch (error) {
      if (isDuplicateWordError(error)) {
        Modal.warning({
          title: '重复单词',
          content: `分类内已存在「${savedWord}」，请勿重复添加。`,
          okText: '知道了',
        })
      }
      // Error state is already handled in Zustand.
    }
  }

  return (
    <section className="page">
      <div className="card">
        <p className="eyebrow">New Word</p>
        <h2>添加单词</h2>

        <form className="word-form" onSubmit={(event) => void handleSubmit(event)}>
          <label>
            分类
            <select
              value={form.folderId}
              disabled={isLoadingFolders}
              onChange={(event) =>
                setForm((current) => ({ ...current, folderId: event.target.value }))
              }
            >
              <option value="">请选择分类</option>
              {folderList.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name} ({folder.language})
                </option>
              ))}
            </select>
          </label>
          {!isLoadingFolders && folderList.length === 0 ? (
            <p className="error-text">
              暂无分类，请先到
              <button
                type="button"
                className="link-button"
                onClick={() => navigate('/folders')}
              >
                分类页
              </button>
              新建一个分类。
            </p>
          ) : null}

          <label>
            Word <span className="required-mark">*</span>
            <input
              ref={wordInputRef}
              value={form.word}
              onChange={(event) =>
                setForm((current) => ({ ...current, word: event.target.value }))
              }
              
              required
            />
          </label>

          <label>
            Reading <span className="required-mark">*</span>
            <input
              value={form.reading}
              onChange={(event) =>
                setForm((current) => ({ ...current, reading: event.target.value }))
              }
              
              required
            />
          </label>

          <label>
            Meaning <span className="optional-mark">(可选)</span>
            <textarea
              value={form.meaning}
              onChange={(event) =>
                setForm((current) => ({ ...current, meaning: event.target.value }))
              }
              
              rows={3}
            />
          </label>

          <label>
            Example <span className="optional-mark">(可选)</span>
            <textarea
              value={form.example}
              onChange={(event) =>
                setForm((current) => ({ ...current, example: event.target.value }))
              }
              
              rows={3}
            />
          </label>

          <label>
            Note <span className="optional-mark">(可选)</span>
            <textarea
              value={form.note}
              onChange={(event) =>
                setForm((current) => ({ ...current, note: event.target.value }))
              }
              placeholder="补充联想、词根或使用场景"
              rows={3}
            />
          </label>

          <div className="form-actions">
            <button type="submit" disabled={isSubmitting || isLoadingFolders}>
              {isSubmitting ? '提交中...' : '保存单词'}
            </button>
            {selectedFolder ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => navigate(`/folders/${selectedFolder.id}`)}
              >
                查看该分类
              </button>
            ) : null}
          </div>

          {successMessage ? (
            <p className="success-text">{successMessage}</p>
          ) : null}
          {error ? <p className="error-text">{error}</p> : null}
        </form>
      </div>
    </section>
  )
}
