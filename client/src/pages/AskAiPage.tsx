import { useEffect, useRef, useState } from 'react'
import { Button, EmptyState, TextArea } from '@heroui/react'
import { Loader2, NotebookPen, RefreshCw, Send, Sparkles, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router'

import { generateChatTitle } from '../api/ai'
import { getErrorMessage } from '../api/error'
import { createNote } from '../api/notes'
import { chatToNoteContent } from '../components/notes/chatToNote'
import { usePageActive } from '../components/layout/pageContext'
import { confirm } from '../components/ui/dialog'
import { useI18n } from '../i18n'
import { useAiChat, type ChatMessage } from '../store/useAiChat'
import { useNotesRevision } from '../store/useNotesRevision'
import { ChatMarkdown } from './askAi/ChatMarkdown'

/** 生成出来的笔记统一挂这个标签，笔记列表里一眼能筛出来。 */
const AI_TAG = 'AI'

/** 输入框的字数上限，和服务端 aiChatService 的 MAX_MESSAGE_CHARS 对齐。 */
const MAX_CHARS = 2000

/** AI 起标题失败时的退路：拿第一句提问顶上，别让笔记因此存不下来。 */
function firstQuestion(messages: ChatMessage[]) {
  const first = messages.find((message) => message.role === 'user')
  return (first?.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
}

/**
 * 询问 AI。
 *
 * 语言相关的自由问答，可以追问、可以让它重答，最后把整段对话存成一篇笔记
 * （标签 AI、时间为存的那一刻）。会话在浏览器本地（useAiChat），服务端不存 ——
 * 所以「清空会话」是真的清掉，笔记才是想留下来的那份。
 */
export function AskAiPage() {
  const { t, language } = useI18n()
  const navigate = useNavigate()
  const isPageActive = usePageActive()

  const messages = useAiChat((state) => state.messages)
  const isPending = useAiChat((state) => state.isPending)
  const error = useAiChat((state) => state.error)
  const send = useAiChat((state) => state.send)
  const regenerate = useAiChat((state) => state.regenerate)
  const clear = useAiChat((state) => state.clear)

  const bumpNotesRevision = useNotesRevision((state) => state.bump)

  const [draft, setDraft] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  // 新消息进来就滚到底。后台的 keep-alive 页面不能抢视口，所以 isPageActive 要
  // 进依赖 —— 顺带也让「离开再回来」落在最新一条上，这正是聊天该有的样子，
  // 优先于外壳按页面记的那个滚动位置。
  useEffect(() => {
    if (!isPageActive) return
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [isPageActive, messages, isPending])

  const handleSend = () => {
    const text = draft.trim()
    if (!text || isPending) return
    setDraft('')
    void send(text)
  }

  const handleClear = async () => {
    const ok = await confirm({
      title: t('askAi.clearConfirmTitle'),
      content: t('askAi.clearConfirmBody'),
      okText: t('askAi.clear'),
      status: 'danger',
    })
    if (ok) clear()
  }

  const handleSaveNote = async () => {
    setIsSaving(true)
    setSaveError(null)
    try {
      const payload = messages.map(({ role, content }) => ({ role, content }))
      // 起标题是额外一次 AI 调用，它失败（比如日预算见底）不该连笔记都存不下来。
      const title = await generateChatTitle({ messages: payload, language }).catch(() => '')
      const created = await createNote({
        title: title || firstQuestion(messages) || t('askAi.noteFallbackTitle'),
        content: chatToNoteContent(messages),
        tag: AI_TAG,
      })
      bumpNotesRevision()
      navigate(`/notes/${created.id}`)
    } catch (saveNoteError) {
      setSaveError(getErrorMessage(saveNoteError, t('askAi.saveFailed')))
    } finally {
      setIsSaving(false)
    }
  }

  const hasAnswer = messages.some((message) => message.role === 'assistant')

  return (
    <section className="page">
      <div className="section-header">
        <div>
          <h2>{t('routes.askAi')}</h2>
          <p className="muted">{t('askAi.subtitle')}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            isDisabled={!hasAnswer || isPending}
            isPending={isSaving}
            onPress={() => void handleSaveNote()}
          >
            <NotebookPen className="size-4" aria-hidden />
            {t('askAi.saveNote')}
          </Button>
          <Button
            isDisabled={messages.length === 0}
            variant="ghost"
            onPress={() => void handleClear()}
          >
            <Trash2 className="size-4" aria-hidden />
            {t('askAi.clear')}
          </Button>
        </div>
      </div>

      {saveError ? <p className="error-text m-0">{saveError}</p> : null}

      <div className="card flex flex-col gap-5">
        {messages.length === 0 ? (
          <EmptyState className="flex flex-col items-center gap-3 py-12 text-center">
            <Sparkles className="size-8 text-muted" aria-hidden />
            <span className="text-sm font-medium text-foreground">
              {t('askAi.emptyTitle')}
            </span>
            <span className="max-w-md text-sm text-muted">{t('askAi.emptyHint')}</span>
          </EmptyState>
        ) : (
          messages.map((message, index) =>
            message.role === 'user' ? (
              <div className="flex justify-end" key={message.id}>
                <div className="multiline-text max-w-[85%] rounded-2xl bg-accent/10 px-4 py-2.5">
                  {message.content}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-start gap-2" key={message.id}>
                <ChatMarkdown className="text-[15px]/[1.75]" text={message.content} />
                {/* 只有最后一条答得出「重新生成」：改写中间某一条，后面的追问就
                    接不上了。 */}
                {index === messages.length - 1 && !isPending ? (
                  <Button size="sm" variant="ghost" onPress={() => void regenerate()}>
                    <RefreshCw className="size-3.5" aria-hidden />
                    {t('askAi.regenerate')}
                  </Button>
                ) : null}
              </div>
            ),
          )
        )}

        {isPending ? (
          <p className="m-0 inline-flex items-center gap-2 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t('askAi.thinking')}
          </p>
        ) : null}

        {error ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="error-text m-0">{error}</p>
            <Button size="sm" variant="ghost" onPress={() => void regenerate()}>
              <RefreshCw className="size-3.5" aria-hidden />
              {t('askAi.retry')}
            </Button>
          </div>
        ) : null}

        <div ref={endRef} />
      </div>

      <div className="card grid gap-2.5">
        <TextArea
          aria-label={t('askAi.placeholder')}
          fullWidth
          maxLength={MAX_CHARS}
          placeholder={t('askAi.placeholder')}
          rows={3}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) return
            // 输入法选字时的回车是「确认候选」，不是发送 —— 日文输入尤其常见。
            if (event.nativeEvent.isComposing) return
            event.preventDefault()
            handleSend()
          }}
        />
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="muted text-xs">{t('askAi.enterHint')}</span>
          <Button
            className="ml-auto"
            isDisabled={!draft.trim()}
            isPending={isPending}
            onPress={handleSend}
          >
            <Send className="size-3.5" aria-hidden />
            {t('askAi.send')}
          </Button>
        </div>
      </div>
    </section>
  )
}
