import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Button,
  Checkbox,
  CheckboxGroup,
  Chip,
  Input,
  Popover,
  ProgressBar,
  Skeleton,
  Tag,
  TagGroup,
  Tooltip,
  toast,
} from '@heroui/react'
import { Plus, RotateCcw, Sparkles, Trash2 } from 'lucide-react'

import { DictEntryResults } from './DictEntryResults'
import { JlptChips } from './JlptChips'
import { SpeakButton } from './SpeakButton'
import { alertDialog, confirm } from './ui/dialog'
import { getErrorMessage, isDuplicateWordError } from '../api/error'
import { createWord, deleteWord, getWords, updateWord } from '../api/words'
import { useI18n } from '../i18n'
import type { WordLookup } from '../hooks/useWordLookup'
import { useAppStore } from '../store/useAppStore'
import { useSettings } from '../store/useSettings'
import { useWordIndex } from '../store/useWordIndex'

/**
 * 一个词的查词结果卡：词头 + 词单标签 + AI 释义 + 本地词库词条。
 *
 * 数据全部来自 useWordLookup（查词页按输入框查，文解析页按点中那个词的辞書形
 * 查）。这里只做两件卡片自己的事：排版，以及词单的增删 —— 后者带弹层、确认框
 * 和 toast，是 UI，所以留在这一层，写回结果走 lookup.replaceWord/removeWord。
 */
export function WordLookupCard({
  lookup,
  children,
  className,
}: {
  lookup: WordLookup
  /** 卡片最上面的一段自定义内容（查词页的辞書形建议行）。 */
  children?: ReactNode
  className?: string
}) {
  const { t } = useI18n()
  const folders = useAppStore((state) => state.folders)
  const localDictEnabled = useSettings((state) => state.settings.localDictEnabled)
  const [isSaving, setIsSaving] = useState(false)
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [pickedFolderIds, setPickedFolderIds] = useState<string[]>([])
  const [newFolderName, setNewFolderName] = useState('')

  const {
    aiView,
    addSeed,
    existingWord,
    headLevels,
    headReading,
    headWord,
    isGeneratingAi,
    aiProgress,
    aiError,
    isLoadingLocal,
    localEntries,
    meta,
    speakLang,
    wordLanguage,
  } = lookup

  useEffect(() => {
    void useAppStore.getState().fetchFolders()
  }, [])

  const wordFolders = useMemo(() => (Array.isArray(folders) ? folders : []), [folders])
  const currentFolders = useMemo(() => {
    if (!existingWord) return []
    const byId = new Map(wordFolders.map((folder) => [folder.id, folder]))
    return existingWord.folderIds.flatMap((id) => {
      const folder = byId.get(id) ?? existingWord.folders?.find((item) => item.id === id)
      return folder ? [{ id, name: folder.name }] : []
    })
  }, [existingWord, wordFolders])
  const availableFolders = useMemo(
    () =>
      wordFolders.filter(
        (folder) =>
          folder.language === wordLanguage && !existingWord?.folderIds.includes(folder.id),
      ),
    [wordFolders, wordLanguage, existingWord],
  )

  const handleAddOpenChange = (open: boolean) => {
    setIsAddOpen(open)
    if (open) {
      setPickedFolderIds([])
      setNewFolderName('')
    }
  }

  const handleAddToFolders = async () => {
    const name = newFolderName.trim()
    if (pickedFolderIds.length === 0 && !name) return
    setIsSaving(true)
    try {
      const folderIds = [...pickedFolderIds]
      if (name) {
        const folder = await useAppStore
          .getState()
          .createFolder({ name, language: wordLanguage })
        if (!folder) throw new Error(t('wordSearch.addFailed'))
        folderIds.push(folder.id)
      }
      if (existingWord) {
        lookup.replaceWord(
          await updateWord(existingWord.id, {
            folderIds: [...new Set([...existingWord.folderIds, ...folderIds])],
          }),
        )
      } else if (addSeed) {
        lookup.replaceWord(
          await createWord({
            folderIds,
            language: addSeed.language,
            word: addSeed.word,
            reading: addSeed.reading,
            partOfSpeech: addSeed.partOfSpeech,
            meaning: addSeed.meaning,
            example: addSeed.example,
            note: addSeed.note,
          }),
        )
      }
      // 右侧索引和词单卡片的计数都要跟上（这里没走 useAppStore.createWord）。
      useWordIndex.getState().refresh()
      void useAppStore.getState().fetchFolders()
      toast.success(t('wordSearch.addedSuccess'))
      setIsAddOpen(false)
    } catch (error) {
      if (isDuplicateWordError(error)) {
        void alertDialog.warning({ title: t('wordSearch.duplicate') })
      } else {
        void alertDialog.error({
          title: t('wordSearch.addFailed'),
          content: getErrorMessage(error, t('wordSearch.tryLater')),
        })
      }
    } finally {
      setIsSaving(false)
    }
  }

  /**
   * 点掉一个词单标签。服务端要求词至少留在一个词单里，所以移除最后一个标签
   * 等于把词从单词库删掉（连复习进度），这一步要用户确认。词单被移空时顺手
   * 删掉词单本身 —— 词单是词的标签，空标签没有存在的意义。
   */
  const handleRemoveFolder = async (folderId: string) => {
    if (!existingWord || isSaving) return
    const isLast = existingWord.folderIds.length <= 1
    if (isLast) {
      const ok = await confirm({
        title: t('wordSearch.removeLastTitle'),
        content: t('wordSearch.removeLastContent', { word: existingWord.word }),
        status: 'warning',
      })
      if (!ok) return
    }
    setIsSaving(true)
    try {
      if (isLast) {
        await deleteWord(existingWord.id)
        lookup.removeWord(existingWord.id)
      } else {
        lookup.replaceWord(
          await updateWord(existingWord.id, {
            folderIds: existingWord.folderIds.filter((id) => id !== folderId),
          }),
        )
      }
      useWordIndex.getState().refresh()
      toast.success(t('wordSearch.removedSuccess'))
      const rest = await getWords({ folderId }).catch(() => null)
      if (rest && rest.length === 0) {
        await useAppStore.getState().deleteFolder(folderId)
      } else {
        void useAppStore.getState().fetchFolders()
      }
    } catch (error) {
      void alertDialog.error({
        title: t('wordSearch.removeFailed'),
        content: getErrorMessage(error, t('wordSearch.tryLater')),
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleClearAi = async () => {
    const ok = await confirm({
      title: t('wordSearch.aiClearConfirm'),
      status: 'warning',
    })
    if (!ok) return
    try {
      await lookup.clearAi()
    } catch (error) {
      void alertDialog.error({
        title: t('wordSearch.aiClearFailed'),
        content: getErrorMessage(error, t('wordSearch.tryLater')),
      })
    }
  }

  // 本地来源分块的显隐：设置开关 + 这个方向本地词库有没有收（英语那两个方向
  // 只有 AI 行）。AI 小节不受这个开关影响，恒在。
  const showLocalBlock = localDictEnabled && meta.hasLocalDict
  // 词单标签行右侧的来源标记：这个词有哪几种释义。JLPT 级别是词本身的属性，
  // 不是一回事，所以分成两组、隔开一段距离摆。
  const hasSourceTags = showLocalBlock && (localEntries.length > 0 || Boolean(aiView))

  return (
    <article className={`card grid gap-3 ${className ?? ''}`}>
      {children}

      {/* 标题区：词头 + 发音 + 读音就是这张卡的标题；
          没生成过 AI 释义时，生成按钮放右上角。 */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <h3 className="m-0 text-2xl/tight font-bold text-foreground">{headWord}</h3>
          {speakLang ? (
            <SpeakButton
              text={headWord}
              reading={headReading}
              lang={speakLang}
              size="md"
            />
          ) : null}
          {headReading ? <span className="muted text-sm">{headReading}</span> : null}
        </div>
        {!aiView && !isGeneratingAi ? (
          <Button
            variant="primary"
            size="sm"
            type="button"
            onPress={() => void lookup.generateAi()}
          >
            <Sparkles className="size-3.5" aria-hidden />
            {t('wordSearch.aiGenerate')}
          </Button>
        ) : null}
      </div>

      {/* 词单标签行：已在的词单可点叉移除，末尾是「+ 添加到词单」；右侧先标出
          本地 / AI 哪边有内容（和右侧索引同款），再隔开一段距离挂 JLPT 级别。 */}
      <div className="flex flex-wrap items-center gap-1.5">
        {currentFolders.length > 0 ? (
          <TagGroup
            aria-label={t('wordSearch.inFolders')}
            size="sm"
            onRemove={(keys) => void handleRemoveFolder(String([...keys][0]))}
          >
            <TagGroup.List items={currentFolders} className="gap-1.5">
              {(folder) => (
                <Tag key={folder.id} id={folder.id} textValue={folder.name}>
                  {folder.name}
                </Tag>
              )}
            </TagGroup.List>
          </TagGroup>
        ) : null}
        {existingWord || addSeed ? (
          <Popover isOpen={isAddOpen} onOpenChange={handleAddOpenChange}>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              className="h-7 min-h-7 gap-1 rounded-full border border-dashed border-border px-2.5 text-xs font-normal text-muted"
            >
              <Plus className="size-3.5" aria-hidden />
              {t('wordSearch.addWord')}
            </Button>
            <Popover.Content className="w-72">
              <Popover.Dialog className="grid gap-3">
                <Popover.Heading className="m-0 text-sm font-semibold">
                  {t('wordSearch.addWord')}
                </Popover.Heading>
                {availableFolders.length > 0 ? (
                  <CheckboxGroup
                    aria-label={t('wordSearch.addWord')}
                    value={pickedFolderIds}
                    onChange={setPickedFolderIds}
                    className="max-h-56 gap-2 overflow-y-auto"
                  >
                    {availableFolders.map((folder) => (
                      <Checkbox key={folder.id} value={folder.id}>
                        <Checkbox.Content>
                          <Checkbox.Control>
                            <Checkbox.Indicator />
                          </Checkbox.Control>
                          <span className="truncate">{folder.name}</span>
                        </Checkbox.Content>
                      </Checkbox>
                    ))}
                  </CheckboxGroup>
                ) : (
                  <p className="muted m-0 text-[13px]">{t('wordSearch.noFolderOption')}</p>
                )}
                <Input
                  value={newFolderName}
                  onChange={(event) => setNewFolderName(event.target.value)}
                  placeholder={t('wordSearch.newFolderPlaceholder')}
                />
                <Button
                  size="sm"
                  type="button"
                  isPending={isSaving}
                  isDisabled={pickedFolderIds.length === 0 && !newFolderName.trim()}
                  onPress={() => void handleAddToFolders()}
                >
                  {t('wordSearch.confirmAdd')}
                </Button>
              </Popover.Dialog>
            </Popover.Content>
          </Popover>
        ) : null}
        {hasSourceTags || headLevels.length > 0 ? (
          <span className="ml-auto flex items-center gap-4">
            {hasSourceTags ? (
              <span className="flex items-center gap-1.5">
                {localEntries.length > 0 ? (
                  <Chip size="sm" variant="soft">
                    <Chip.Label>{t('wordSearch.tagLocal')}</Chip.Label>
                  </Chip>
                ) : null}
                {aiView ? (
                  <Chip size="sm" color="accent" variant="soft">
                    <Chip.Label>{t('wordSearch.tagAi')}</Chip.Label>
                  </Chip>
                ) : null}
              </span>
            ) : null}
            <JlptChips levels={headLevels} />
          </span>
        ) : null}
      </div>

      {aiError ? <p className="error-text m-0">{aiError}</p> : null}

      {/* AI 释义：排在其他来源上面。没生成时整块不出现（按钮在右上角）。 */}
      {aiView || isGeneratingAi || aiProgress > 0 ? (
        <div className="grid gap-3 border-t border-border pt-3">
          {aiView ? (
            <div className="flex flex-wrap items-center gap-2">
              <Chip size="sm" variant="soft" color="accent">
                <Chip.Label>{t('wordSearch.sourceAi')}</Chip.Label>
              </Chip>
              {aiView.partOfSpeech ? (
                <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-bold text-accent">
                  {aiView.partOfSpeech}
                </span>
              ) : null}
              <div className="ml-auto flex items-center gap-1.5">
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  isPending={isGeneratingAi}
                  onPress={() => void lookup.generateAi(true)}
                >
                  <RotateCcw className="size-3.5" aria-hidden />
                  {t('wordSearch.regenerate')}
                </Button>
                <Tooltip delay={0}>
                  <Button
                    isIconOnly
                    variant="ghost"
                    size="sm"
                    type="button"
                    aria-label={t('wordSearch.aiClear')}
                    isDisabled={isGeneratingAi}
                    onPress={() => void handleClearAi()}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </Button>
                  <Tooltip.Content>{t('wordSearch.aiClear')}</Tooltip.Content>
                </Tooltip>
              </div>
            </div>
          ) : null}

          {isGeneratingAi || aiProgress > 0 ? (
            <ProgressBar
              aria-label={t('wordSearch.aiSearching')}
              color={isGeneratingAi ? 'accent' : 'success'}
              size="sm"
              value={aiProgress}
            >
              <ProgressBar.Track>
                <ProgressBar.Fill />
              </ProgressBar.Track>
            </ProgressBar>
          ) : null}

          {aiView?.meaning ? (
            <p className="m-0 text-[15px]/[1.7] whitespace-pre-wrap text-foreground">
              {aiView.meaning}
            </p>
          ) : null}

          {aiView?.example ? (
            <div className="grid gap-1 rounded-xl border border-border bg-foreground/2 px-3.5 py-3">
              <span className="text-xs font-bold tracking-[0.06em] text-muted uppercase">
                {t('wordSearch.example')}
              </span>
              <p className="m-0 leading-[1.7] whitespace-pre-wrap text-foreground">
                {aiView.example}
              </p>
            </div>
          ) : null}

          {aiView?.note ? (
            <div className="grid gap-1 rounded-xl border border-border bg-foreground/2 px-3.5 py-3">
              <span className="text-xs font-bold tracking-[0.06em] text-muted uppercase">
                {t('wordSearch.note')}
              </span>
              <p className="m-0 leading-[1.7] whitespace-pre-wrap text-foreground">
                {aiView.note}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* 其他来源：本地词库的词典条目，排在 AI 释义后面。 */}
      {showLocalBlock ? (
        <div className="grid gap-4 border-t border-border pt-3">
          {isLoadingLocal ? (
            <div className="grid gap-2 py-1">
              <Skeleton className="h-4 w-2/5 rounded-lg" />
              <Skeleton className="h-3 w-4/5 rounded-lg" />
              <Skeleton className="h-3 w-3/5 rounded-lg" />
            </div>
          ) : localEntries.length === 0 ? (
            <p className="muted m-0">{t('wordSearch.dictEmpty')}</p>
          ) : (
            <DictEntryResults entries={localEntries} />
          )}
        </div>
      ) : null}
    </article>
  )
}
