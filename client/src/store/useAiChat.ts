import { create } from 'zustand'

import { chatWithAi, type AiChatMessage } from '../api/ai'
import { getErrorMessage } from '../api/error'
import { lookup, messages as dictionaries } from '../i18n'
import { useSettings } from './useSettings'

/**
 * 「询问 AI」的会话。
 *
 * 只有一条会话，存在 localStorage 里 —— 服务端刻意不落库（理由见
 * server/src/services/aiChatService.ts）。放 store 而不是页面 state，是因为
 * 中途跳去查个词、刷新一下浏览器，都不该把问过的话弄丢；真要留下来的对话，
 * 出口是「生成笔记」。
 */

export type ChatMessage = AiChatMessage & {
  /** 只用来当列表 key，不发给服务端。 */
  id: string
}

const STORAGE_KEY = 'word-sprint-ai-chat'

let messageSeq = 0

function newMessage(role: ChatMessage['role'], content: string): ChatMessage {
  return { id: `${Date.now()}-${messageSeq++}`, role, content }
}

/** localStorage 里可能是上个版本写的、也可能被人改坏，一律过一遍再进 state。 */
function normalize(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return []
  const out: ChatMessage[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const { role, content } = item as { role?: unknown; content?: unknown }
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') continue
    out.push(newMessage(role, content))
  }
  return out
}

function load(): ChatMessage[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? normalize(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

function persist(messages: ChatMessage[]) {
  try {
    if (messages.length === 0) window.localStorage.removeItem(STORAGE_KEY)
    else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages))
  } catch {
    // 无痕模式 / 配额满：本次会话照常用，只是刷新之后就没了。
  }
}

/**
 * 取消令牌：清空会话之后，前一次还在飞的回答不能再落回来。发送按钮在等待期间
 * 是禁用的，所以同时在飞的最多一个。
 */
let runToken = 0

type AiChatState = {
  messages: ChatMessage[]
  /** 正在等这一轮回答。 */
  isPending: boolean
  error: string | null
  send: (text: string) => Promise<void>
  /** 掀掉最后一条回答重新问一次；上一次失败（末尾还是提问）时就是重试。 */
  regenerate: () => Promise<void>
  clear: () => void
}

export const useAiChat = create<AiChatState>((set, get) => {
  async function ask(history: ChatMessage[]) {
    const token = ++runToken
    // 提问先落地：网络失败也不该把用户敲的字弄丢，界面上留着它才好重试。
    persist(history)
    set({ messages: history, isPending: true, error: null })

    try {
      const reply = await chatWithAi({
        messages: history.map(({ role, content }) => ({ role, content })),
        language: useSettings.getState().settings.uiLanguage,
      })
      if (token !== runToken) return
      const next = [...history, newMessage('assistant', reply)]
      persist(next)
      set({ messages: next, isPending: false })
    } catch (error) {
      if (token !== runToken) return
      const language = useSettings.getState().settings.uiLanguage
      set({
        isPending: false,
        error: getErrorMessage(error, lookup(dictionaries[language], 'askAi.failed')),
      })
    }
  }

  return {
    messages: load(),
    isPending: false,
    error: null,

    send: async (text) => {
      const content = text.trim()
      if (!content || get().isPending) return
      await ask([...get().messages, newMessage('user', content)])
    },

    regenerate: async () => {
      if (get().isPending) return
      const history = get().messages
      const last = history[history.length - 1]
      if (!last) return
      await ask(last.role === 'assistant' ? history.slice(0, -1) : history)
    },

    clear: () => {
      runToken += 1
      persist([])
      set({ messages: [], isPending: false, error: null })
    },
  }
})
