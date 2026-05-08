import { BookOutlined } from '@ant-design/icons'
import { FloatButton, Modal } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { fillWordByAi } from '../api/ai'
import { getErrorMessage, isDuplicateWordError } from '../api/error'
import { getNotes } from '../api/notes'
import { useAppStore } from '../store/useAppStore'

type FolderLanguage = 'en' | 'jp'

type QuickAddWordFloatProps = {
  preferredFolderId?: string | null
  preferredLanguage?: string
  prefillExample?: string
}

const initialForm = {
  folderId: '',
  sourceNoteId: '',
  word: '',
  reading: '',
  meaning: '',
  example: '',
  note: '',
  partOfSpeech: '',
}

function pickFolderByLanguage(
  folders: Array<{ id: string; language: FolderLanguage }>,
  language: FolderLanguage,
  currentFolderId: string,
) {
  const sameLanguage = folders.filter((item) => item.language === language)
  if (sameLanguage.length === 0) return ''
  if (sameLanguage.some((item) => item.id === currentFolderId)) return currentFolderId
  return sameLanguage[0].id
}

function toFolderLanguage(value?: string): FolderLanguage | null {
  if (value === 'en' || value === 'jp') return value
  return null
}

export function QuickAddWordFloat({
  preferredFolderId,
  preferredLanguage,
  prefillExample,
}: QuickAddWordFloatProps) {
  const folders = useAppStore((state) => state.folders)
  const createWord = useAppStore((state) => state.createWord)
  const fetchFolders = useAppStore((state) => state.fetchFolders)
  const isSubmitting = useAppStore((state) => state.isSubmitting)
  const [open, setOpen] = useState(false)
  const [aiTerm, setAiTerm] = useState('')
  const [isFillingByAi, setIsFillingByAi] = useState(false)
  const [noteOptions, setNoteOptions] = useState<Array<{ id: string; title: string }>>([])
  const folderList = useMemo(() => (Array.isArray(folders) ? folders : []), [folders])
  const [form, setForm] = useState(() => ({
    ...initialForm,
    folderId: preferredFolderId ?? '',
    example: prefillExample ?? '',
  }))
  const selectedFolder = useMemo(
    () => folderList.find((folder) => folder.id === form.folderId),
    [folderList, form.folderId],
  )

  useEffect(() => {
    void fetchFolders()
    void getNotes().then((rows) =>
      setNoteOptions((rows ?? []).map((item) => ({ id: item.id, title: item.title }))),
    )
  }, [fetchFolders])

  useEffect(() => {
    const normalizedLanguage = toFolderLanguage(preferredLanguage)
    setForm((current) => ({
      ...current,
      folderId:
        preferredFolderId ??
        (normalizedLanguage
          ? pickFolderByLanguage(folderList, normalizedLanguage, current.folderId)
          : current.folderId),
      example: current.example || prefillExample || '',
    }))
  }, [preferredFolderId, preferredLanguage, prefillExample, folderList])

  const resetForm = () => {
    setAiTerm('')
    setForm({
      ...initialForm,
      folderId: preferredFolderId ?? '',
      example: prefillExample ?? '',
    })
  }

  const handleAiFill = async (extended = false) => {
    const term = aiTerm.trim() || form.word.trim()
    if (!term) {
      Modal.warning({ title: '请输入要 AI 填充的单词' })
      return
    }
    if (!selectedFolder) {
      Modal.warning({ title: '请先选择分类' })
      return
    }

    setIsFillingByAi(true)
    try {
      const result = await fillWordByAi({
        word: term,
        extended,
      })
      setForm((current) => ({
        ...current,
        word: result.word || current.word,
        reading: result.reading || current.reading,
        meaning: result.meaning || current.meaning,
        example: result.example || current.example,
        note: result.note || current.note,
        partOfSpeech: result.partOfSpeech || current.partOfSpeech,
      }))
      setAiTerm('')
    } catch (error) {
      Modal.confirm({
        title: 'AI 填充失败',
        content: extended
          ? getErrorMessage(error, '已临时提高 token 上限仍失败，请稍后重试')
          : getErrorMessage(error, '可能是返回内容被截断，重试时会临时提高 token 上限'),
        okText: extended ? '再次重试' : '重试（提高 token）',
        cancelText: '关闭',
        onOk: () => handleAiFill(true),
      })
    } finally {
      setIsFillingByAi(false)
    }
  }

  const handleSubmit = async () => {
    if (!selectedFolder) {
      Modal.warning({ title: '请先选择分类' })
      return
    }
    const word = form.word.trim()
    if (!word) {
      Modal.warning({ title: '请填写单词' })
      return
    }

    try {
      await createWord({
        folderId: form.folderId,
        language: selectedFolder.language,
        sourceNoteId: form.sourceNoteId || undefined,
        word,
        reading: form.reading.trim() || undefined,
        meaning: form.meaning.trim() || undefined,
        example: form.example.trim() || undefined,
        note: form.note.trim() || undefined,
        partOfSpeech: form.partOfSpeech.trim() || undefined,
      })
      Modal.success({ title: '添加成功' })
      setOpen(false)
      resetForm()
    } catch (error) {
      if (isDuplicateWordError(error)) {
        Modal.warning({ title: '该分类中已存在同名单词' })
        return
      }
      Modal.error({ title: '添加失败', content: getErrorMessage(error, '请稍后重试') })
    }
  }

  return (
    <>
      <FloatButton
        className="quick-add-float"
        type="primary"
        icon={<BookOutlined />}
        tooltip="快速添加单词"
        style={{ insetInlineEnd: 24, bottom: 24, zIndex: 1200 }}
        onClick={() => setOpen(true)}
      />
      <Modal
        title="快速添加单词"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void handleSubmit()}
        okText="保存"
        cancelText="取消"
        confirmLoading={isSubmitting}
        width={760}
      >
        <div className="quick-add-form">
          <div className="quick-add-row">
            <label>分类</label>
            <select
              value={form.folderId}
              onChange={(event) =>
                setForm((current) => ({ ...current, folderId: event.target.value }))
              }
            >
              <option value="">请选择分类</option>
              {folderList.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name} ({folder.language.toUpperCase()})
                </option>
              ))}
            </select>
          </div>

          <div className="quick-add-row quick-add-row-ai">
            <label>AI 填充</label>
            <div className="quick-add-ai-box">
              <input
                value={aiTerm}
                onChange={(event) => setAiTerm(event.target.value)}
                placeholder="输入词条，点击 AI 自动填充"
              />
              <button
                type="button"
                className="secondary"
                onClick={() => void handleAiFill()}
                disabled={isFillingByAi}
              >
                {isFillingByAi ? '填充中...' : 'AI 填充'}
              </button>
            </div>
          </div>

          <div className="quick-add-grid">
            <div className="quick-add-row">
              <label>来源笔记</label>
              <select
                value={form.sourceNoteId}
                onChange={(event) =>
                  setForm((current) => ({ ...current, sourceNoteId: event.target.value }))
                }
              >
                <option value="">不关联笔记</option>
                {noteOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="quick-add-row">
              <label>词性</label>
              <input
                value={form.partOfSpeech}
                onChange={(event) =>
                  setForm((current) => ({ ...current, partOfSpeech: event.target.value }))
                }
                placeholder="如：n., v., adj."
              />
            </div>
          </div>

          <div className="quick-add-grid">
            <div className="quick-add-row">
              <label>单词</label>
              <input
                value={form.word}
                onChange={(event) =>
                  setForm((current) => ({ ...current, word: event.target.value }))
                }
                placeholder="请输入单词"
              />
            </div>
            <div className="quick-add-row">
              <label>读音</label>
              <input
                value={form.reading}
                onChange={(event) =>
                  setForm((current) => ({ ...current, reading: event.target.value }))
                }
                placeholder="例如 /həˈləʊ/"
              />
            </div>
          </div>

          <div className="quick-add-row">
            <label>释义</label>
            <textarea
              value={form.meaning}
              onChange={(event) =>
                setForm((current) => ({ ...current, meaning: event.target.value }))
              }
              rows={3}
              placeholder="请输入释义"
            />
          </div>

          <div className="quick-add-row">
            <label>例句</label>
            <textarea
              value={form.example}
              onChange={(event) =>
                setForm((current) => ({ ...current, example: event.target.value }))
              }
              rows={3}
              placeholder="请输入例句"
            />
          </div>

          <div className="quick-add-row">
            <label>备注</label>
            <textarea
              value={form.note}
              onChange={(event) =>
                setForm((current) => ({ ...current, note: event.target.value }))
              }
              rows={2}
              placeholder="补充记忆点（可选）"
            />
          </div>
        </div>
      </Modal>
    </>
  )
}
