// 所有 AI 功能共用的那一层：模型、请求形状、用量记账、JSON 解析、日预算。
//
// 从 services/aiService.ts 里搬出来的，一个字没改。搬的理由是它已经不只服务
// 那一个文件了（文解析在 services/textAnalyzeService.ts），而这几件事必须
// 全站只有一份实现 —— 尤其是记账：漏记一次调用，就是日预算数不到的一次调用。

import OpenAI from 'openai'

import { AppError } from '../errors/AppError'
import { getEnv } from './env'
import { prisma } from './prisma'

export function getDefaultModel() {
  return getEnv('OPENAI_MODEL')?.trim() || 'gpt-5.6-luna'
}

const DAILY_TOKEN_BUDGET_DEFAULT = 50000

function getDailyTokenBudget(): number {
  const raw = getEnv('DAILY_AI_TOKEN_BUDGET')
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DAILY_TOKEN_BUDGET_DEFAULT
}

export async function assertWithinDailyBudget(userId: string) {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date()
  end.setHours(23, 59, 59, 999)

  const result = await prisma.aiUsageLog.aggregate({
    where: { userId, createdAt: { gte: start, lte: end } },
    _sum: { totalTokens: true },
  })

  const used = result._sum.totalTokens ?? 0
  const budget = getDailyTokenBudget()
  if (used >= budget) {
    throw new AppError(
      `今日 AI 用量已达上限 (${used.toLocaleString()} / ${budget.toLocaleString()} tokens)，请明天再试`,
      429,
    )
  }
}

let openaiClient: OpenAI | null = null

function getOpenAIClient() {
  const apiKey = getEnv('OPENAI_API_KEY')?.trim()
  if (!apiKey) {
    throw new AppError('OPENAI_API_KEY is not configured', 500)
  }
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey })
  }
  return openaiClient
}

export function sanitize(input?: string | null) {
  return (input ?? '').trim()
}

/** What the usage row records about *why* a call happened. */
export type UsageLogFields = {
  /** The user's input, verbatim — the admin usage table lists this. */
  word: string
  language: string
  feature: string
  userId: string
}

export type JsonCompletionInput = {
  system: string
  user: string
  /** Ceiling on generated tokens. Reasoning is off, so this is all answer. */
  maxOutputTokens: number
  log: UsageLogFields
}

/** One turn of a conversation. The system prompt is passed separately. */
export type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type ChatCompletionInput = {
  system: string
  /** Full history, oldest first. Single-turn callers pass one user message. */
  messages: ChatMessage[]
  maxOutputTokens: number
  log: UsageLogFields
}

/**
 * One completion, with its token usage written to `AiUsageLog`.
 *
 * Every AI feature in this app goes through here, so the model, the request
 * shape and the billing record are decided once instead of a dozen times over.
 *
 * Two request choices are forced by the gpt-5.6 family and worth spelling out:
 *
 *  - `reasoning_effort: 'none'`. These models reason by default (`medium`),
 *    and reasoning tokens come out of the same `max_completion_tokens` budget
 *    as the answer. Every task here is either a short, fully-specified
 *    extraction into a fixed JSON shape or a tutor answering a question it
 *    already knows the answer to, and the budgets are 130–1100 tokens — any
 *    reasoning at all would consume the response and return nothing.
 *  - No `temperature`. The family rejects every value but the default, so the
 *    old per-feature 0.1/0.2/0.3 tuning is gone rather than merely unused.
 *
 * Usage is logged before the content is inspected: an empty reply still spent
 * tokens, and a call that vanishes from the ledger is a call the daily budget
 * stops counting.
 *
 * Returns the raw content, or null when the model returned none.
 */
async function complete(
  input: ChatCompletionInput & { json: boolean },
): Promise<string | null> {
  const model = getDefaultModel()
  const completion = await getOpenAIClient().chat.completions.create({
    model,
    ...(input.json ? { response_format: { type: 'json_object' as const } } : {}),
    reasoning_effort: 'none',
    max_completion_tokens: input.maxOutputTokens,
    messages: [{ role: 'system', content: input.system }, ...input.messages],
  })

  const usage = completion.usage
  await prisma.aiUsageLog.create({
    data: {
      ...input.log,
      model,
      promptTokens: usage?.prompt_tokens ?? 0,
      cachedTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
      cacheWriteTokens: usage?.prompt_tokens_details?.cache_write_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
      totalTokens: usage?.total_tokens ?? 0,
    },
  })

  return sanitize(completion.choices[0]?.message?.content) || null
}

/** A single-turn completion constrained to a JSON object. */
export async function completeJson(input: JsonCompletionInput): Promise<string | null> {
  return complete({
    system: input.system,
    messages: [{ role: 'user', content: input.user }],
    maxOutputTokens: input.maxOutputTokens,
    log: input.log,
    json: true,
  })
}

/**
 * A multi-turn completion returning prose.
 *
 * The only caller is the AI chat: its answer is read by a human rather than
 * parsed, so JSON mode would just be a wrapper to strip back off.
 */
export async function completeChatOrThrow(input: ChatCompletionInput): Promise<string> {
  const content = await complete({ ...input, json: false })
  if (!content) throw new AppError('AI did not return content', 502)
  return content
}

/** `completeJson` for callers with no fallback for an empty reply. */
export async function completeJsonOrThrow(input: JsonCompletionInput): Promise<string> {
  const content = await completeJson(input)
  if (!content) throw new AppError('AI did not return content', 502)
  return content
}

export function parseModelJsonObject<T>(content: string): T {
  const normalized = sanitize(content)
  const candidates: string[] = [normalized]
  const fenced = normalized.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]
  if (fenced) {
    candidates.push(sanitize(fenced))
  }
  const firstBrace = normalized.indexOf('{')
  const lastBrace = normalized.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(normalized.slice(firstBrace, lastBrace + 1))
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T
    } catch {
      // try next candidate
    }
  }

  throw new AppError('AI returned invalid JSON', 502)
}
