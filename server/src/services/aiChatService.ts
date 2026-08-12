// 询问 AI：语言学习的自由问答。可以追问、可以让它重答，最后能把整段对话存成
// 一篇笔记。
//
// 服务端是**无状态**的：会话存在浏览器（client/src/store/useAiChat.ts），每次
// 提问由客户端把历史整份带上来。这样不必为一个「随手清空、清空了也不用找回」
// 的东西建表，也不必操心多设备之间怎么合并会话 —— 真想留下来的对话，出口是
// 笔记，那是本来就有的持久化。
//
// 代价是历史越长 prompt 越贵，所以下面按条数和字数双重截断。

import { AppError } from '../errors/AppError'
import {
  assertWithinDailyBudget,
  completeChatOrThrow,
  completeJsonOrThrow,
  parseModelJsonObject,
  sanitize,
  type ChatMessage,
} from '../lib/aiClient'

/** 界面语言，也就是回答用的语言。 */
export type ChatLanguage = 'zh' | 'en' | 'jp'

const CHAT_LANGUAGES: readonly ChatLanguage[] = ['zh', 'en', 'jp']

const REPLY_LANGUAGE: Record<ChatLanguage, string> = {
  zh: '简体中文',
  en: 'English',
  jp: '日本語',
}

/**
 * 最多把最近多少条历史送进 prompt。20 条 ≈ 10 轮问答，足够撑住一个话题里的
 * 指代（「那它呢」「上面第二个例句」），再往前的内容对当前这一问基本没影响，
 * 却要一直付 token。
 */
const MAX_HISTORY_MESSAGES = 20
/** 单条消息的字数上限。正常提问几十字，超长的多半是整段文章，截断比烧 token 好。 */
const MAX_MESSAGE_CHARS = 2000
/** 回答的输出预算。带 2-3 个例句的语法讲解大约 500-800 token。 */
const MAX_REPLY_TOKENS = 1100
/** 标题只要一行字，给足解析 JSON 的余量即可。 */
const MAX_TITLE_TOKENS = 120
/** 概括标题时最多读多少字的对话。开头几轮就定了主题，全文送进去不划算。 */
const MAX_TITLE_SOURCE_CHARS = 1200
/** 标题长度上限，和 noteService 的 MAX_TITLE_LENGTH 相比是个更严的自我约束。 */
const MAX_TITLE_CHARS = 40

function pickLanguage(raw: unknown): ChatLanguage {
  return CHAT_LANGUAGES.includes(raw as ChatLanguage) ? (raw as ChatLanguage) : 'zh'
}

/**
 * 客户端传上来的历史是任意 JSON，一律在这里收敛成干净的消息数组：过滤角色、
 * 截断长度、丢掉空消息，最后只留最近 MAX_HISTORY_MESSAGES 条。
 */
function normalizeMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) throw new AppError('messages must be an array', 400)

  const messages: ChatMessage[] = []
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const { role, content } = item as { role?: unknown; content?: unknown }
    if (role !== 'user' && role !== 'assistant') continue
    const text = sanitize(typeof content === 'string' ? content : '').slice(
      0,
      MAX_MESSAGE_CHARS,
    )
    if (text) messages.push({ role, content: text })
  }

  if (messages.length === 0) throw new AppError('messages is required', 400)
  return messages.slice(-MAX_HISTORY_MESSAGES)
}

/**
 * 助教的人设与排版约定。
 *
 * 排版那条是有下游的：这几种记法前端的聊天气泡渲染得出来
 * （client/src/pages/askAi/ChatMarkdown.tsx），BlockNote 也解析得出来，所以
 * 「生成笔记」之后笔记里的排版和聊天里看到的是同一份。放开标题、表格、代码块
 * 会让两边都对不上。
 */
function buildSystemPrompt(language: ChatLanguage) {
  return [
    `你是一位语言学习助教，回答日语和英语的词汇、语法、表达、翻译、发音、文化背景问题。`,
    `一律用${REPLY_LANGUAGE[language]}回答；日语 / 英语的词和例句保持原文，需要时补读音和译文。`,
    '',
    '- 直接给答案，不要寒暄、不要复述问题、不要在结尾追问「还想了解什么」。',
    '- 讲清楚为什么，不要只给结论；有容易混的近义说法就顺带对比。',
    '- 例句给 1-3 句，每句配译文。',
    '- 排版只用这几种：段落、`- ` 无序列表、`1. ` 有序列表、**加粗**、`行内代码`。',
    '  不要用标题（#）、表格、代码块、HTML。',
    '- 不确定就直说，不要编造词条、出处或用例。',
    '- 与语言学习无关的问题，一句话说明并把话题带回来。',
  ].join('\n')
}

export type ChatInput = {
  /** 完整历史，最后一条必须是用户的提问。 */
  messages: unknown
  language: unknown
  userId: string
}

/**
 * 问一轮。「重新生成」在客户端表现为掀掉上一条回答再问一遍，所以这边不用区分
 * 首次提问和重答 —— 两者送上来的历史形状完全一样。
 */
export async function chatWithAi(input: ChatInput): Promise<{ reply: string }> {
  const messages = normalizeMessages(input.messages)
  if (messages[messages.length - 1].role !== 'user') {
    throw new AppError('last message must be from the user', 400)
  }

  const language = pickLanguage(input.language)
  await assertWithinDailyBudget(input.userId)

  const reply = await completeChatOrThrow({
    system: buildSystemPrompt(language),
    messages,
    maxOutputTokens: MAX_REPLY_TOKENS,
    log: {
      // 用量表里这一列显示的是「用户输入了什么」，对话就取这一问。
      word: messages[messages.length - 1].content.slice(0, 40),
      language,
      feature: 'chat',
      userId: input.userId,
    },
  })

  return { reply }
}

function buildTitlePrompt(messages: ChatMessage[], language: ChatLanguage) {
  const transcript = messages
    .map((message) => `${message.role === 'user' ? '问' : '答'}：${message.content}`)
    .join('\n')
    .slice(0, MAX_TITLE_SOURCE_CHARS)

  return [
    '为下面这段问答起一个笔记标题。只返回 JSON 对象，键只有 title。',
    `title：用${REPLY_LANGUAGE[language]}写，越短越好（中文 / 日文 <=20 字，英文 <=8 词），`,
    '概括这段对话讲的是什么（例如「助词 に 和 で 的区别」），',
    '不要加引号句号，不要出现「笔记」「对话」「问答」这类词。',
    '',
    transcript,
  ].join('\n')
}

/**
 * 把一段对话概括成笔记标题。
 *
 * 单独一个接口而不是塞进「生成笔记」里：笔记本身由客户端拿现成的 `/api/notes`
 * 建，正文是对话原文，服务端不参与；这里只补 AI 唯一有价值的那一件事。
 */
export async function titleForChat(input: ChatInput): Promise<{ title: string }> {
  const messages = normalizeMessages(input.messages)
  const language = pickLanguage(input.language)

  await assertWithinDailyBudget(input.userId)

  const content = await completeJsonOrThrow({
    system: 'You name notes. Return strict JSON with only the requested key.',
    user: buildTitlePrompt(messages, language),
    maxOutputTokens: MAX_TITLE_TOKENS,
    log: {
      word: messages[0].content.slice(0, 40),
      language,
      feature: 'chat_note_title',
      userId: input.userId,
    },
  })

  const parsed = parseModelJsonObject<{ title?: unknown }>(content)
  const title = sanitize(typeof parsed.title === 'string' ? parsed.title : '')
  // 模型偶尔会连引号一起给回来；标题为空时退回第一句提问，让笔记至少有个名字。
  const cleaned = title.replace(/^["'「『]|["'」』]$/g, '').trim()
  return {
    title: (cleaned || messages[0].content).slice(0, MAX_TITLE_CHARS),
  }
}
