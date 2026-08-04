// 字幕划词 → 加进词单。播客详情页在选中文本后弹这个。
//
// 和加词页（AddWordPage）的分工：那边是「我知道要记哪个词，手输」，这边是
// 「听到生词，就手边这句话」。差别决定了两个设计：
//   - 词头存**原形**：字幕里是「食べました」，词单里该是「食べる」。还原交给
//     AI（服务端语境模式，见 aiService.buildContextPrompt）。
//   - 例句存**字幕原句**，不用 AI 自造的例句 —— 记忆钩子是「我在哪听到的」。
//
// 调用方按 draft 给 key，一次划词一个新实例，所以初始值直接在 useState 里算，
// 不需要「打开时重置」那套 effect。打开即查词，关掉重开会再花一次 token。

import { useEffect, useState } from 'react'
import { Button, Input, TextArea } from '@heroui/react'
import { SelectField } from './ui/SelectField'
import { Modal } from './ui/Modal'
import { fillWordByAi } from '../api/ai'
import { getErrorMessage, isDuplicateWordError } from '../api/error'
import { loadLastFolder, saveLastFolder } from '../lib/lastFolder'
import { useAppStore } from '../store/useAppStore'
import type { Folder } from '../types'

function pickFolder(folders: Folder[], language: 'en' | 'jp'): string {
  const sameLanguage = folders.filter((f) => f.language === language)
  if (sameLanguage.length === 0) return ''
  const last = loadLastFolder()
  if (sameLanguage.some((f) => f.id === last)) return last
  return sameLanguage[0].id
}

/** 例句拼成「原句｜译文」—— 和 AI 生成的例句、词库里的例句同一个格式。 */
function composeExample(sentence: string, translation: string): string {
  const zh = translation.trim()
  return zh ? `${sentence}｜${zh}` : sentence
}

type Props = {
  onClose: () => void
  /** 选中的原文，可能是活用形。 */
  selectedText: string
  /** 选中文本所在的整句字幕。 */
  sentence: string
  /** 该行自带的中文翻译，AI 翻译失败时兜底。 */
  sentenceZhFallback?: string
  language: 'en' | 'jp'
  onSaved?: (word: string) => void
}

export function AddWordFromSubtitleDialog({
  onClose,
  selectedText,
  sentence,
  sentenceZhFallback,
  language,
  onSaved,
}: Props) {
  const folders = useAppStore((state) => state.folders)
  const createWord = useAppStore((state) => state.createWord)
  const isSubmitting = useAppStore((state) => state.isSubmitting)

  // 挂载即开查，所以初值就是 true —— 免得在 effect 里同步 setState。
  const [isLoading, setIsLoading] = useState(true)
  const [aiError, setAiError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  /** AI 还原出的原形和选中原文不同时提示一句，让人知道词头被改过。 */
  const [normalizedFrom, setNormalizedFrom] = useState<string | null>(null)
  const [form, setForm] = useState(() => ({
    word: selectedText,
    reading: '',
    meaning: '',
    partOfSpeech: '',
    note: '',
    // AI 还没回来先用行内翻译占位，查词失败也有个能存的例句。
    example: composeExample(sentence, sentenceZhFallback ?? ''),
    folderId: pickFolder(folders, language),
  }))

  useEffect(() => {
    let alive = true
    void fillWordByAi({
      word: selectedText,
      sourceLanguage: language,
      targetLanguage: language,
      context: sentence,
    })
      .then((result) => {
        if (!alive) return
        const baseForm = result.baseForm || result.word || selectedText
        setForm((current) => ({
          ...current,
          word: baseForm,
          reading: result.reading || current.reading,
          meaning: result.meaning || current.meaning,
          partOfSpeech: result.partOfSpeech || current.partOfSpeech,
          note: result.note || current.note,
          example: composeExample(
            sentence,
            result.sentenceZh || sentenceZhFallback || '',
          ),
        }))
        if (baseForm !== selectedText) setNormalizedFrom(selectedText)
      })
      .catch((error) => {
        if (!alive) return
        // 查词失败不关弹框：词头和例句已经填好，手写释义照样能存。
        setAiError(getErrorMessage(error, '查词失败，可以手动填'))
      })
      .finally(() => {
        if (alive) setIsLoading(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 词单是打开弹框时才去拉的（播客页平时不需要 folders），初值那会儿往往还
  // 是空的。按仓库里 AddWordPage 的做法在渲染期补，而不是再挂一个 effect。
  const [folderSynced, setFolderSynced] = useState(false)
  if (!folderSynced && !form.folderId && folders.length > 0) {
    const picked = pickFolder(folders, language)
    if (picked) {
      setFolderSynced(true)
      setForm((current) => ({ ...current, folderId: picked }))
    }
  }

  const folderOptions = folders
    .filter((f) => f.language === language)
    .map((f) => ({ value: f.id, label: f.name }))

  const handleSave = async () => {
    const word = form.word.trim()
    if (!word) {
      setSaveError('词头不能为空')
      return
    }
    if (!form.folderId) {
      setSaveError(
        folderOptions.length === 0
          ? `还没有${language === 'jp' ? '日语' : '英语'}词单，先去词单页建一个`
          : '选一个词单',
      )
      return
    }
    setSaveError(null)
    try {
      await createWord({
        folderIds: [form.folderId],
        word,
        reading: form.reading.trim(),
        meaning: form.meaning.trim(),
        example: form.example.trim(),
        note: form.note.trim(),
        partOfSpeech: form.partOfSpeech.trim(),
        language,
      })
      saveLastFolder(form.folderId)
      onSaved?.(word)
      onClose()
    } catch (error) {
      setSaveError(
        isDuplicateWordError(error)
          ? `「${word}」已经在词单里了`
          : getErrorMessage(error, '保存失败'),
      )
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="加入词单"
      size="md"
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          <span className="text-xs text-muted">
            {isLoading
              ? 'AI 查词中…'
              : normalizedFrom
                ? `已还原原形（划的是「${normalizedFrom}」）`
                : ''}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" type="button" onPress={onClose}>
              取消
            </Button>
            <Button
              type="button"
              onPress={() => void handleSave()}
              isDisabled={isSubmitting || isLoading}
            >
              {isSubmitting ? '保存中…' : '保存'}
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid gap-3">
        {aiError ? (
          <div className="rounded-md bg-accent-soft px-2.5 py-1.5 text-[13px]">
            {aiError}
          </div>
        ) : null}

        <label className="grid gap-1 text-[13px]">
          词头
          <Input
            value={form.word}
            onChange={(e) => setForm((c) => ({ ...c, word: e.target.value }))}
            placeholder="原形"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1 text-[13px]">
            读音
            <Input
              value={form.reading}
              onChange={(e) =>
                setForm((c) => ({ ...c, reading: e.target.value }))
              }
            />
          </label>
          <label className="grid gap-1 text-[13px]">
            词性
            <Input
              value={form.partOfSpeech}
              onChange={(e) =>
                setForm((c) => ({ ...c, partOfSpeech: e.target.value }))
              }
            />
          </label>
        </div>

        <label className="grid gap-1 text-[13px]">
          释义
          <TextArea
            value={form.meaning}
            onChange={(e) => setForm((c) => ({ ...c, meaning: e.target.value }))}
            rows={2}
          />
        </label>

        <label className="grid gap-1 text-[13px]">
          例句（字幕原句｜中文）
          <TextArea
            value={form.example}
            onChange={(e) => setForm((c) => ({ ...c, example: e.target.value }))}
            rows={2}
          />
        </label>

        <label className="grid gap-1 text-[13px]">
          备注
          <Input
            value={form.note}
            onChange={(e) => setForm((c) => ({ ...c, note: e.target.value }))}
          />
        </label>

        <label className="grid gap-1 text-[13px]">
          词单
          <SelectField
            value={form.folderId || undefined}
            onChange={(v) => setForm((c) => ({ ...c, folderId: v ?? '' }))}
            options={folderOptions}
            placeholder={folderOptions.length ? '选择词单' : '暂无词单'}
            isDisabled={folderOptions.length === 0}
            aria-label="词单"
            fullWidth
          />
        </label>

        {saveError ? (
          <div className="text-[13px] text-danger">{saveError}</div>
        ) : null}
      </div>
    </Modal>
  )
}
