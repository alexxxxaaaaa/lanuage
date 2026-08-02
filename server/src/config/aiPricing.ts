/**
 * OpenAI list prices, in USD per 1,000,000 tokens.
 *
 * Source: https://developers.openai.com/api/docs/pricing (checked 2026-08-02).
 * This table is the only thing standing between a token count and the figure
 * the app shows as money, so it is kept here on its own rather than inlined at
 * a call site — when OpenAI moves a price, exactly one file changes.
 */

/** The four buckets a request is billed in. USD per 1M tokens. */
export interface TokenRates {
  /** Prompt tokens that were neither served from nor written to cache. */
  input: number
  cachedInput: number
  cacheWrite: number
  output: number
}

interface ModelPricing {
  short: TokenRates
  /** Omitted for models billed at a single rate regardless of prompt size. */
  long?: TokenRates
}

/**
 * GPT-5.6 switches to its long-context rate card once a request's prompt goes
 * past this many tokens, and the higher rate then applies to the *whole*
 * request rather than just the overflow.
 */
export const LONG_CONTEXT_THRESHOLD = 272_000

const PRICING: Readonly<Record<string, ModelPricing>> = {
  'gpt-5.6-sol': {
    short: { input: 5.0, cachedInput: 0.5, cacheWrite: 6.25, output: 30.0 },
    long: { input: 10.0, cachedInput: 1.0, cacheWrite: 12.5, output: 45.0 },
  },
  'gpt-5.6-terra': {
    short: { input: 2.0, cachedInput: 0.2, cacheWrite: 2.5, output: 12.0 },
    long: { input: 4.0, cachedInput: 0.4, cacheWrite: 5.0, output: 18.0 },
  },
  'gpt-5.6-luna': {
    short: { input: 0.2, cachedInput: 0.02, cacheWrite: 0.25, output: 1.2 },
    long: { input: 0.4, cachedInput: 0.04, cacheWrite: 0.5, output: 1.8 },
  },
  // The retired default. Still stamped on every historical usage row, so it
  // stays priced — otherwise past periods would quietly read as free.
  'gpt-4.1-mini': {
    short: { input: 0.4, cachedInput: 0.1, cacheWrite: 0, output: 1.6 },
  },
}

/** List price of `model`, or null when we hold no price for it. */
export function getModelRates(model: string): TokenRates | null {
  return PRICING[model]?.short ?? null
}

export interface BillableTokens {
  /** The whole prompt, cached and cache-written tokens included. */
  promptTokens: number
  cachedTokens: number
  cacheWriteTokens: number
  completionTokens: number
}

/**
 * What one call cost, in USD — or null when `model` has no price on file, so
 * callers can report the gap instead of silently billing it as zero.
 *
 * Cached and freshly-cached tokens are carved *out of* `promptTokens` rather
 * than added to it: the API reports them as a breakdown of the prompt, so
 * charging both would bill the same token twice.
 */
export function estimateCallCostUsd(
  model: string,
  tokens: BillableTokens,
): number | null {
  const pricing = PRICING[model]
  if (!pricing) return null
  const rates =
    tokens.promptTokens > LONG_CONTEXT_THRESHOLD && pricing.long
      ? pricing.long
      : pricing.short

  // Clamped so a malformed usage payload can never drive the fresh-token count
  // negative and refund the bill.
  const cached = Math.min(Math.max(tokens.cachedTokens, 0), tokens.promptTokens)
  const written = Math.min(
    Math.max(tokens.cacheWriteTokens, 0),
    tokens.promptTokens - cached,
  )
  const fresh = tokens.promptTokens - cached - written

  return (
    (fresh * rates.input +
      cached * rates.cachedInput +
      written * rates.cacheWrite +
      tokens.completionTokens * rates.output) /
    1_000_000
  )
}
