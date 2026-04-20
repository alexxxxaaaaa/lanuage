import { useEffect, useState } from 'react'
import { Modal } from 'antd'
import { Link, useParams } from 'react-router-dom'
import { isDuplicateWordError } from '../api/error'
import { SpeakButton } from '../components/SpeakButton'
import { VoicePicker } from '../components/VoicePicker'
import { useAppStore } from '../store/useAppStore'
import type { Word } from '../types'

type WordFormState = {
  word: string
  reading: string
  meaning: string
  example: string
  note: string
}

function toFormState(word: Word): WordFormState {
  return {
    word: word.word,
    reading: word.reading,
    meaning: word.meaning,
    example: word.example,
    note: word.note,
  }
}

export function FolderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const currentFolder = useAppStore((state) => state.currentFolder)
  const isLoadingFolder = useAppStore((state) => state.isLoadingFolder)
  const isSubmitting = useAppStore((state) => state.isSubmitting)
  const error = useAppStore((state) => state.error)

  const [editingWordId, setEditingWordId] = useState<string | null>(null)
  const [form, setForm] = useState<WordFormState | null>(null)

  useEffect(() => {
    if (!id) return
    useAppStore.getState().clearError()
    void useAppStore.getState().fetchFolderById(id)
    return () => {
      useAppStore.getState().clearCurrentFolder()
    }
  }, [id])

  if (!id) {
    return null
  }

  const folder = currentFolder && currentFolder.id === id ? currentFolder : null
  const words = folder?.words ?? []

  const beginEdit = (word: Word) => {
    setEditingWordId(word.id)
    setForm(toFormState(word))
  }

  const cancelEdit = () => {
    setEditingWordId(null)
    setForm(null)
  }

  const handleSave = async (event: React.FormEvent, wordId: string) => {
    event.preventDefault()
    if (!form) return
    const nextWord = form.word.trim()

    try {
      await useAppStore.getState().updateWord(wordId, {
        word: nextWord,
        reading: form.reading.trim(),
        meaning: form.meaning.trim(),
        example: form.example.trim(),
        note: form.note.trim(),
      })

      cancelEdit()
    } catch (error) {
      if (isDuplicateWordError(error)) {
        Modal.warning({
          title: '重复单词',
          content: `分类内已存在「${nextWord}」，请换一个写法。`,
          okText: '知道了',
        })
      }
    }
  }

  const handleDelete = async (word: Word) => {
    const confirmed = window.confirm(`确定要删除单词「${word.word}」吗？`)
    if (!confirmed) return
    await useAppStore.getState().deleteWord(word.id)
  }

  return (
    <section className="page">
      <div className="section-header">
        <div>
          <p className="eyebrow">
            <Link to="/folders">← 返回分类</Link>
          </p>
          <h2>
            {folder ? folder.name : '分类详情'}
            {folder ? (
              <span className="folder-language tag-inline">
                {folder.language.toUpperCase()}
              </span>
            ) : null}
          </h2>
          <p className="muted">
            共 {words.length} 个单词
          </p>
        </div>
        <div className="hero-actions compact-actions">
          <Link
            className="primary-link"
            to={`/words/new${folder ? `?folderId=${folder.id}` : ''}`}
          >
            添加单词
          </Link>
        </div>
      </div>

      {folder ? <VoicePicker lang={folder.language} /> : null}

      {isLoadingFolder ? <div className="card">正在加载...</div> : null}
      {error ? <p className="error-text">{error}</p> : null}

      {!isLoadingFolder && folder && words.length === 0 ? (
        <div className="card empty-state">
          <p>这个分类下还没有单词，去添加一个吧。</p>
        </div>
      ) : null}

      <div className="word-list word-list-folder">
        {words.map((word) =>
          editingWordId === word.id && form ? (
            <form
              key={word.id}
              className="card word-card word-edit word-card-full"
              onSubmit={(event) => handleSave(event, word.id)}
            >
              <div className="word-grid">
                <label className="form-field">
                  <span>单词</span>
                  <input
                    value={form.word}
                    onChange={(event) =>
                      setForm((prev) =>
                        prev ? { ...prev, word: event.target.value } : prev,
                      )
                    }
                    required
                  />
                </label>
                <label className="form-field">
                  <span>读音</span>
                  <input
                    value={form.reading}
                    onChange={(event) =>
                      setForm((prev) =>
                        prev ? { ...prev, reading: event.target.value } : prev,
                      )
                    }
                    required
                  />
                </label>
                <label className="form-field form-field-full">
                  <span>释义（可选）</span>
                  <input
                    value={form.meaning}
                    onChange={(event) =>
                      setForm((prev) =>
                        prev ? { ...prev, meaning: event.target.value } : prev,
                      )
                    }
                  />
                </label>
                <label className="form-field form-field-full">
                  <span>例句（可选）</span>
                  <textarea
                    rows={2}
                    value={form.example}
                    onChange={(event) =>
                      setForm((prev) =>
                        prev ? { ...prev, example: event.target.value } : prev,
                      )
                    }
                  />
                </label>
                <label className="form-field form-field-full">
                  <span>笔记（可选）</span>
                  <textarea
                    rows={2}
                    value={form.note}
                    onChange={(event) =>
                      setForm((prev) =>
                        prev ? { ...prev, note: event.target.value } : prev,
                      )
                    }
                  />
                </label>
              </div>
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
            <article key={word.id} className="card word-card word-card-folder">
              <div className="word-card-header">
                <div className="word-card-title">
                  <strong className="word-title">{word.word}</strong>
                  <SpeakButton
                    text={word.word}
                    lang={word.language}
                    size="md"
                    label="朗读单词"
                  />
                  <span className="muted word-reading">{word.reading}</span>
                </div>
                <div className="folder-card-actions">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => beginEdit(word)}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    className="ghost-button danger"
                    onClick={() => void handleDelete(word)}
                    disabled={isSubmitting}
                  >
                    删除
                  </button>
                </div>
              </div>
              {word.meaning ? (
                <p className="word-meaning">{word.meaning}</p>
              ) : null}
              {word.example ? (
                <div className="word-example-block">
                  <div className="word-example-body">
                    <span className="word-example-label">例句</span>
                    <p className="word-example-text">{word.example}</p>
                  </div>
                  <SpeakButton
                    text={word.example}
                    lang={word.language}
                    label="朗读例句"
                  />
                </div>
              ) : null}
              {word.note ? (
                <p className="muted word-note-text">笔记：{word.note}</p>
              ) : null}
            </article>
          ),
        )}
      </div>
    </section>
  )
}
