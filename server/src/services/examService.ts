import OpenAI from 'openai'
import { prisma } from '../lib/prisma'
import { getEnv } from '../lib/env'
import { AppError } from '../errors/AppError'

// The client extracts raw text from the uploaded PDF with pdf.js and posts it
// here alongside title/year/level. We ask the AI to structure the raw text
// into JLPT-style sections + questions and store the JSON blob. Extracting
// on the client keeps the Worker off the hook for heavy PDF rendering.

// Section types mirror the JLPT question categories so the UI can render them
// with the right prompt / choice layout. `other` is a catch-all for anything
// the AI can't confidently classify.
export type ExamSectionType =
  | 'vocabulary_reading'
  | 'vocabulary_kanji'
  | 'vocabulary_context'
  | 'vocabulary_paraphrase'
  | 'vocabulary_usage'
  | 'grammar_choose'
  | 'grammar_arrange'
  | 'reading_comprehension'
  | 'listening'
  | 'other'

export type ExamQuestion = {
  id: number
  stem: string
  target?: string
  choices: string[]
  passage?: string
  answer: number | null
  explanation?: string
}

export type ExamSection = {
  type: ExamSectionType
  instruction: string
  passage?: string
  questions: ExamQuestion[]
}

export type ParsedExam = {
  sections: ExamSection[]
}

const DEFAULT_LEVEL = 'N1'
// GPT-4.1-mini has a 128k context / 32k output window — enough headroom for a
// full N1 test's raw text + structured JSON reply in one shot.
const PARSE_MODEL_MAX_TOKENS = 16000

function getDefaultModel() {
  return getEnv('OPENAI_MODEL')?.trim() || 'gpt-4.1-mini'
}

let openaiClient: OpenAI | null = null
function getOpenAIClient() {
  const apiKey = getEnv('OPENAI_API_KEY')?.trim()
  if (!apiKey) throw new AppError('OPENAI_API_KEY is not configured', 500)
  if (!openaiClient) openaiClient = new OpenAI({ apiKey })
  return openaiClient
}

function sanitize(input?: string) {
  return (input ?? '').trim()
}

function parseJsonObject<T>(content: string): T {
  const trimmed = sanitize(content)
  const candidates = [trimmed]
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1]
  if (fenced) candidates.push(fenced.trim())
  for (const c of candidates) {
    try {
      return JSON.parse(c) as T
    } catch {
      // try next candidate
    }
  }
  throw new AppError('AI returned malformed JSON', 502)
}

function buildParsePrompt(level: string) {
  return `You are parsing a JLPT ${level} real exam question paper. You will receive one or more images — each is a rendered page from the PDF. OCR the Japanese text yourself; do NOT ask for typed transcript.

Concrete example of the layout you should recognize:

  問題1  ___の言葉の読み方として最もよいものを、1・2・3・4から一つ選びなさい。
  [1] 駅前の店はどこも繁盛している。
      1  びんしょう  2  びんじょう  3  はんしょう  4  はんじょう
  [2] 契約の内容については、こちらの書類をご覧ください。
      1  せいやく  2  けいやく  3  こうやく  4  ようやく

The bracketed integer is the question number. Below it, "1 / 2 / 3 / 4" prefix the four choices.

Your job: identify the exam SECTIONS (問題1, 問題2 ...) across all pages and reconstruct each QUESTION with its 4 choices. Ignore cover / instruction pages that don't contain numbered questions.

Answer-key table: the LAST pages of this PDF may contain a "参考答案" (or "解答") grid where each cell shows a question number (e.g. "1番") and its correct choice below (e.g. "4"). When you see this grid, populate the "answer" field of each question with that integer (1-4). Do NOT create new question entries for the grid — those question numbers refer back to the questions you already emitted. If a question's answer isn't in the grid (or the grid isn't visible in the images you have), set that question's answer to null.

Return STRICT JSON matching this schema:
{
  "sections": [
    {
      "type": "vocabulary_reading" | "vocabulary_kanji" | "vocabulary_context" | "vocabulary_paraphrase" | "vocabulary_usage" | "grammar_choose" | "grammar_arrange" | "reading_comprehension" | "listening" | "other",
      "instruction": "the section's overall instruction, e.g. 問題1 ___の言葉の読み方として最もよいものを、1・2・3・4から一つ選びなさい。",
      "passage": "for reading_comprehension sections, the full passage the following questions refer to. Omit otherwise.",
      "questions": [
        {
          "id": integer question number as printed (1, 2, 3, ...),
          "stem": "the question sentence with ___ or the item to be classified/ordered. Keep the blank marker if present.",
          "target": "the underlined/blanked target word if this section is about a specific word (vocabulary_*). Omit otherwise.",
          "choices": ["1st choice", "2nd choice", "3rd choice", "4th choice"],
          "answer": null,
          "explanation": ""
        }
      ]
    }
  ]
}

Rules:
- Preserve the ORIGINAL Japanese/English text — don't translate, don't paraphrase, don't fix "typos" that might be intentional 出題.
- If a section is grammar_arrange (order the words), each choice is one of the 4 orderings; the stem contains ★ or blanks with numbered slots.
- reading_comprehension: put the source paragraph in the section's "passage" AND still list each sub-question under "questions". Do NOT duplicate the passage into every question's stem.
- listening: script text only; audio is uploaded separately. Include the question and 4 choices if they're printed.
- Skip pure filler pages (cover, instructions in Chinese/English, blank pages).
- If you're truly unsure about a question's shape, still emit it with your best-effort choices; better to have a rough entry than to drop it silently.
- All string values must be JSON-safe (no un-escaped newlines inside strings).
- The "answer" field is 1-indexed to match the printed choice numbers (1 / 2 / 3 / 4). Leave null if unknown.

Return ONLY the JSON object. No commentary.`
}

// Second-pass parser for the SEPARATE solution / explanation PDF. Its purpose
// is to fill the `explanation` (and if the question PDF's answer table was
// missing, also `answer`) for questions we already extracted. Output is a
// dictionary keyed by the printed question number so we can merge it back
// onto the parsed exam without any layout reasoning.
type SolutionEntry = { answer?: number | null; explanation?: string }
type SolutionResult = { entries: Record<string, SolutionEntry> }

function buildSolutionPrompt(level: string) {
  return `You are reading pages from a JLPT ${level} exam SOLUTION / EXPLANATION document (Chinese-annotated). Extract one JSON entry per numbered item you see on the pages. Each entry gets "answer" (1-4 integer if you can find it) and "explanation" (transcribed printed text).

CRITICAL: Extract the ACTUAL question numbers visible in the images, not example numbers from these instructions. If you don't see numbered items in the images, say so honestly in "seen" — but do NOT invent numbers.

The booklet uses THREE common formats — recognize all of them:

━━━ FORMAT A (词汇读音 / 汉字 / 近义 类) ━━━
The correct answer is the choice whose Chinese meaning matches the translated stem.

  N.
  <Chinese translation of stem>
  1 <kana> <kanji-form>(<Chinese-meaning>)
  2 <kana> <kanji-form>(<Chinese-meaning>)
  3 <kana> <kanji-form>(<Chinese-meaning>)
  4 <kana> <kanji-form>(<Chinese-meaning>)      ← whichever Chinese meaning matches the stem → answer

━━━ FORMAT B (用法題) ━━━
The correct answer is printed EXPLICITLY as (X) at the end of the header line where X is a digit 1-4.

  N.
  <target word>(<reading>)(<meaning>)(X)        ← ★ trailing (X) IS the answer
  1 <Japanese usage sentence>...
  2 <Japanese usage sentence>...
  3 <Japanese usage sentence>...
  4 <Japanese usage sentence>...

For Format B, extract that trailing (X) integer as "answer".

━━━ FORMAT C (文法 / 解説段落 类) ━━━
The correct answer appears inside a Chinese-language 解析 paragraph, phrased as "选择选项X" / "选X" / "选项X" / "答案是X".

  N.
  解析:<Chinese explanation>
  ...选择选项X。                                 ← X is the answer

For Format C, scan the paragraph for that phrase and extract the integer.

━━━ OUTPUT SHAPE ━━━
{
  "seen": "honest 1-sentence English description of what you observe (helps me debug). Example: 'Two full pages of Chinese-annotated vocab explanations, ~14 items numbered <first>-<last>.' Or: 'Pages appear mostly blank; only faint outlines visible' if the render is genuinely broken.",
  "entries": {
    "<actual question number as string>": { "answer": <1-4 or null>, "explanation": "..." },
    ...
  }
}

━━━ RULES ━━━
- Extract EVERY numbered item you actually see. The keys of "entries" MUST be the real numbers on the page, not the placeholder N from these instructions.
- If a page is truly unreadable (blank / garbled render), say so in "seen" and return {"entries": {}} — this is honest, not lazy.
- "explanation" = faithfully quote/summarize the printed text for that item. Include the Chinese translation + Japanese forms + choice meanings so the user can review why they were wrong.
- Return ONLY the JSON object.`
}

// Cloudflare Workers cap HTTP requests at ~30s wall time — one giant vision
// call over 16+ pages routinely blows past that and gets silently killed by
// the platform. Split pages into small chunks and fire them in parallel; each
// chunk finishes well under 30s and the total wall time stays under the
// slowest single chunk (~15s) rather than N × single-page cost.
const CHUNK_SIZE = 4
// Solution booklets are denser (many items per page, small font), and the
// vision model tends to skim under load. Smaller chunks give it more
// attention budget per page and improve extraction reliability.
const SOLUTION_CHUNK_SIZE = 2

async function callParseChunk(
  pages: string[],
  level: string,
  chunkIdx: number,
  totalChunks: number,
  firstPageInChunk: number,
  lastPageInChunk: number,
): Promise<ParsedExam> {
  const client = getOpenAIClient()
  const completion = await client.chat.completions.create({
    model: getDefaultModel(),
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You are a JLPT exam parser. You return strict JSON matching the schema in the user prompt. Never include prose outside the JSON.',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              buildParsePrompt(level) +
              `\n\nCONTEXT: You are receiving pages ${firstPageInChunk}-${lastPageInChunk} of a ${totalChunks}-chunk exam split. Only output sections whose questions are VISIBLE in these images. If a section (問題N) is only partially visible in these pages, still emit it with just the questions you can see — a neighboring chunk will pick up the rest and we'll merge downstream.`,
          },
          ...pages.map(
            (dataUrl) =>
              ({
                type: 'image_url',
                image_url: { url: dataUrl, detail: 'high' },
              }) as const,
          ),
        ],
      },
    ],
    max_tokens: PARSE_MODEL_MAX_TOKENS,
    temperature: 0,
  })

  const content = completion.choices[0]?.message?.content
  const finish = completion.choices[0]?.finish_reason
  const usage = completion.usage
  console.log(
    `[exam-parse] chunk ${chunkIdx + 1}/${totalChunks} pages ${firstPageInChunk}-${lastPageInChunk} finish=${finish} tokens_in=${usage?.prompt_tokens} tokens_out=${usage?.completion_tokens}`,
  )
  if (!content) return { sections: [] }

  try {
    const parsed = parseJsonObject<ParsedExam>(content)
    if (!parsed || !Array.isArray(parsed.sections)) return { sections: [] }
    return parsed
  } catch {
    console.log(
      `[exam-parse] chunk ${chunkIdx + 1} malformed JSON, dropped:`,
      content.slice(0, 400),
    )
    return { sections: [] }
  }
}

async function callSolutionChunk(
  pages: string[],
  level: string,
  chunkIdx: number,
  totalChunks: number,
  firstPageInChunk: number,
  lastPageInChunk: number,
): Promise<SolutionResult> {
  const client = getOpenAIClient()
  const completion = await client.chat.completions.create({
    model: getDefaultModel(),
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You are a JLPT exam solution parser. You return strict JSON matching the schema in the user prompt. Never include prose outside the JSON.',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              buildSolutionPrompt(level) +
              `\n\nCONTEXT: You are looking at pages ${firstPageInChunk}-${lastPageInChunk} of a ${totalChunks}-chunk split of the solution booklet.`,
          },
          ...pages.map(
            (dataUrl) =>
              ({
                type: 'image_url',
                image_url: { url: dataUrl, detail: 'high' },
              }) as const,
          ),
        ],
      },
    ],
    max_tokens: PARSE_MODEL_MAX_TOKENS,
    temperature: 0,
  })
  const content = completion.choices[0]?.message?.content
  const usage = completion.usage
  console.log(
    `[exam-solution] chunk ${chunkIdx + 1}/${totalChunks} pages ${firstPageInChunk}-${lastPageInChunk} tokens_in=${usage?.prompt_tokens} tokens_out=${usage?.completion_tokens}`,
  )
  if (!content) return { entries: {} }
  try {
    const parsed = parseJsonObject<SolutionResult & { seen?: string }>(content)
    if (!parsed || typeof parsed.entries !== 'object') return { entries: {} }
    const entryCount = Object.keys(parsed.entries).length
    if (parsed.seen) {
      console.log(`[exam-solution] chunk ${chunkIdx + 1} seen: ${parsed.seen}`)
    }
    if (entryCount === 0) {
      console.log(
        `[exam-solution] chunk ${chunkIdx + 1} returned 0 entries. raw:`,
        content.slice(0, 800),
      )
    } else {
      const firstKey = Object.keys(parsed.entries)[0]
      const firstEntry = parsed.entries[firstKey]
      console.log(
        `[exam-solution] chunk ${chunkIdx + 1} extracted ${entryCount} entries, keys: [${Object.keys(parsed.entries).slice(0, 8).join(',')}${entryCount > 8 ? ',...' : ''}], sample: {"${firstKey}":${JSON.stringify(firstEntry).slice(0, 200)}}`,
      )
    }
    return { entries: parsed.entries }
  } catch {
    console.log('[exam-solution] chunk malformed JSON, dropped:', content.slice(0, 400))
    return { entries: {} }
  }
}

async function callSolutionModel(
  pages: string[],
  level: string,
): Promise<SolutionResult> {
  const chunks: string[][] = []
  for (let i = 0; i < pages.length; i += SOLUTION_CHUNK_SIZE) {
    chunks.push(pages.slice(i, i + SOLUTION_CHUNK_SIZE))
  }
  console.log(
    `[exam-solution] vision path: ${pages.length} pages → ${chunks.length} chunks`,
  )
  const results = await Promise.all(
    chunks.map((chunk, idx) => {
      const firstPage = idx * SOLUTION_CHUNK_SIZE + 1
      const lastPage = firstPage + chunk.length - 1
      return callSolutionChunk(chunk, level, idx, chunks.length, firstPage, lastPage)
    }),
  )
  const merged: Record<string, SolutionEntry> = {}
  for (const r of results) {
    for (const [key, val] of Object.entries(r.entries)) {
      // Later chunk wins if there's a conflict — but a real overlap should
      // only happen when a question's explanation spills across pages,
      // which is fine since either chunk's parse should be reasonable.
      merged[key] = { ...merged[key], ...val }
    }
  }
  return { entries: merged }
}

function mergeSolutionIntoExam(exam: ParsedExam, solution: SolutionResult): ParsedExam {
  let merged = 0
  let missing = 0
  const nextSections = exam.sections.map((sec) => ({
    ...sec,
    questions: sec.questions.map((q) => {
      const entry = solution.entries[String(q.id)]
      if (!entry) {
        missing++
        return q
      }
      merged++
      return {
        ...q,
        // Solution answer beats a null from question-side parse; if both have
        // an answer, trust the question-side (extracted from the printed 参考答案 grid).
        answer: q.answer ?? entry.answer ?? null,
        explanation: q.explanation || entry.explanation || '',
      }
    }),
  }))
  console.log(
    `[exam-merge] merged ${merged}/${merged + missing} questions with solution entries (${Object.keys(solution.entries).length} entries available)`,
  )
  return { sections: nextSections }
}

async function callParseModel(pages: string[], level: string): Promise<ParsedExam> {
  const chunks: string[][] = []
  for (let i = 0; i < pages.length; i += CHUNK_SIZE) {
    chunks.push(pages.slice(i, i + CHUNK_SIZE))
  }
  console.log(
    `[exam-parse] vision path: ${pages.length} pages → ${chunks.length} chunks of up to ${CHUNK_SIZE}`,
  )

  // All chunks in parallel — bounded by CF Worker's outbound concurrency
  // (~6 by default, plenty for typical 4-10 chunks). If a chunk fails or
  // returns empty, we still merge the rest — better partial data than 502.
  const results = await Promise.all(
    chunks.map((chunk, idx) => {
      const firstPage = idx * CHUNK_SIZE + 1
      const lastPage = firstPage + chunk.length - 1
      return callParseChunk(chunk, level, idx, chunks.length, firstPage, lastPage)
    }),
  )

  // Naive merge: concat sections in chunk order. Section boundaries usually
  // fall between chunks (問題N ends before the next 問題 starts on a new
  // page), so duplicates are rare. When they occur (same 問題N appearing in
  // two neighbors), we keep both — user can spot & delete via the UI later.
  const mergedSections = results.flatMap((r) => r.sections)
  const totalQuestions = mergedSections.reduce((s, sec) => s + sec.questions.length, 0)
  const answerCount = mergedSections.reduce(
    (s, sec) => s + sec.questions.filter((q) => q.answer !== null).length,
    0,
  )
  console.log(
    `[exam-parse] merged: ${mergedSections.length} sections, ${totalQuestions} questions total, ${answerCount} with answer`,
  )

  // Fallback: if most questions lack an answer, the 参考答案 grid was likely
  // isolated in a chunk that emitted no questions (so its answers had nothing
  // to attach to). Do one focused pass over the LAST few pages that asks for
  // just the answer grid, then merge those integers onto the questions.
  if (totalQuestions > 0 && answerCount < totalQuestions / 2 && pages.length > 2) {
    console.log('[exam-parse] answer count low, running dedicated answer-table pass')
    const tailPages = pages.slice(Math.max(0, pages.length - 4))
    const answers = await extractAnswerTable(tailPages, level)
    console.log(`[exam-parse] answer-table pass found ${Object.keys(answers).length} answers`)
    for (const section of mergedSections) {
      for (const q of section.questions) {
        if (q.answer === null || q.answer === undefined) {
          const a = answers[String(q.id)]
          if (typeof a === 'number') q.answer = a
        }
      }
    }
  }

  return { sections: mergedSections }
}

/** Dedicated pass over just the tail pages that asks the vision model to
 *  return ONLY the printed answer-key table as a plain map { "1": 4, "2": 2, ... }.
 *  Used as a fallback when the main chunked parse didn't attach answers
 *  because the grid page(s) fell into a chunk with no visible questions. */
async function extractAnswerTable(
  tailPages: string[],
  level: string,
): Promise<Record<string, number>> {
  const client = getOpenAIClient()
  const completion = await client.chat.completions.create({
    model: getDefaultModel(),
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You extract JLPT exam answer keys from images. Return strict JSON.',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `These are the LAST pages of a JLPT ${level} question paper. Find any "参考答案" or "解答" table/grid that maps question numbers (1番, 2番, 3番...) to a correct choice (1/2/3/4).

Return JSON: {"answers": {"1": 4, "2": 2, "3": 4, ...}} using STRING keys for question numbers and INTEGER values 1-4 for choices. If no answer table is visible, return {"answers": {}}. No commentary.`,
          },
          ...tailPages.map(
            (dataUrl) =>
              ({
                type: 'image_url',
                image_url: { url: dataUrl, detail: 'high' },
              }) as const,
          ),
        ],
      },
    ],
    max_tokens: 4000,
    temperature: 0,
  })
  const content = completion.choices[0]?.message?.content
  if (!content) return {}
  try {
    const parsed = JSON.parse(content) as { answers?: Record<string, number> }
    return parsed.answers ?? {}
  } catch {
    console.log('[exam-parse] answer-table pass returned malformed JSON:', content.slice(0, 400))
    return {}
  }
}

type CreateExamInput = {
  userId: string
  title: string
  year?: string
  level?: string
  pages: string[]
  solutionPages?: string[]
  audioUrl?: string
}

export async function createExam(input: CreateExamInput) {
  const title = sanitize(input.title)
  const pages = Array.isArray(input.pages) ? input.pages : []
  const solutionPages = Array.isArray(input.solutionPages) ? input.solutionPages : []
  if (!title) throw new AppError('title is required', 400)
  if (pages.length === 0) throw new AppError('pages is required', 400)
  const level = sanitize(input.level) || DEFAULT_LEVEL
  const year = sanitize(input.year)

  // Fire the two vision-parse tasks in parallel — they're independent and
  // each internally chunks itself into small OpenAI calls that stay under
  // the Worker's 30s HTTP timeout.
  const [parsed, solution] = await Promise.all([
    callParseModel(pages, level),
    solutionPages.length > 0
      ? callSolutionModel(solutionPages, level)
      : Promise.resolve<SolutionResult>({ entries: {} }),
  ])
  const merged =
    solutionPages.length > 0 ? mergeSolutionIntoExam(parsed, solution) : parsed

  const exam = await prisma.exam.create({
    data: {
      userId: input.userId,
      title,
      year,
      level,
      audioUrl: sanitize(input.audioUrl),
      parsedData: JSON.stringify(merged),
    },
  })

  return exam
}

// Exams are now GLOBAL — admin uploads them, everyone sees the same library.
// The Exam.userId column is retained as an audit trail of who uploaded, but
// access control moved to route middleware (POST/DELETE = requireAdmin;
// GET = requireAuth for any logged-in user).

export async function listExams() {
  // Metadata only — don't ship the (potentially large) parsedData blob to the
  // list view. Detail page loads it separately.
  return prisma.exam.findMany({
    orderBy: [{ createdAt: 'desc' }],
    select: {
      id: true,
      title: true,
      year: true,
      level: true,
      questionPdfUrl: true,
      solutionPdfUrl: true,
      audioUrl: true,
      createdAt: true,
      updatedAt: true,
    },
  })
}

export async function getExamById(id: string) {
  const exam = await prisma.exam.findFirst({ where: { id } })
  if (!exam) throw new AppError('exam not found', 404)
  let parsed: ParsedExam = { sections: [] }
  try {
    parsed = JSON.parse(exam.parsedData) as ParsedExam
  } catch {
    parsed = { sections: [] }
  }
  return { ...exam, parsedData: parsed }
}

/** Admin-only. Cascades all users' attempts for this exam. */
export async function deleteExam(id: string) {
  const exam = await prisma.exam.findFirst({ where: { id } })
  if (!exam) throw new AppError('exam not found', 404)
  await prisma.$transaction([
    prisma.examAttempt.deleteMany({ where: { examId: id } }),
    prisma.exam.delete({ where: { id } }),
  ])
  return { id }
}

// ---- Attempt (做题会话) helpers ----

/** Attempts are per-user even though exams are global. Ownership check here
 *  is on the attempt itself; a user shouldn't be able to read or mutate
 *  another user's attempt even if they share the same exam. */
async function assertAttemptOwned(userId: string, examId: string, attemptId: string) {
  const attempt = await prisma.examAttempt.findFirst({
    where: { id: attemptId, examId, userId },
  })
  if (!attempt) throw new AppError('attempt not found', 404)
  return attempt
}

async function assertExamExists(examId: string) {
  const exam = await prisma.exam.findFirst({ where: { id: examId } })
  if (!exam) throw new AppError('exam not found', 404)
  return exam
}

export async function listAttempts(userId: string, examId: string) {
  await assertExamExists(examId)
  return prisma.examAttempt.findMany({
    where: { examId, userId },
    orderBy: { startedAt: 'desc' },
  })
}

/** Start a new attempt. Doesn't touch previous attempts (multiple allowed). */
export async function startAttempt(userId: string, examId: string) {
  await assertExamExists(examId)
  return prisma.examAttempt.create({
    data: {
      examId,
      userId,
      answers: '{}',
      scoreByType: '{}',
    },
  })
}

export async function getAttempt(
  userId: string,
  examId: string,
  attemptId: string,
) {
  return assertAttemptOwned(userId, examId, attemptId)
}

/** Auto-save call from the client. Only mutates the answers blob and any
 *  new listening-phase timestamp. Not finalized until submitAttempt. */
export async function patchAttempt(
  userId: string,
  examId: string,
  attemptId: string,
  patch: { answers?: Record<string, number> },
) {
  const attempt = await assertAttemptOwned(userId, examId, attemptId)
  if (attempt.finishedAt) {
    throw new AppError('attempt is already finalized', 409)
  }
  const nextAnswers = patch.answers
    ? JSON.stringify(patch.answers)
    : attempt.answers
  return prisma.examAttempt.update({
    where: { id: attemptId },
    data: { answers: nextAnswers },
  })
}

/** Finalize an attempt. Computes overall score + per-section breakdown by
 *  comparing the stored answers blob against each question's `answer` field.
 *  Questions with `answer === null` (no answer key parsed) don't count
 *  against total — a partially-keyed exam still gets a fair score. */
export async function submitAttempt(
  userId: string,
  examId: string,
  attemptId: string,
  patch: { answers?: Record<string, number> },
) {
  const exam = await assertExamExists(examId)
  const attempt = await assertAttemptOwned(userId, examId, attemptId)
  if (attempt.finishedAt) {
    throw new AppError('attempt is already finalized', 409)
  }

  const answers: Record<string, number> = patch.answers
    ? patch.answers
    : (JSON.parse(attempt.answers || '{}') as Record<string, number>)

  let parsed: ParsedExam = { sections: [] }
  try {
    parsed = JSON.parse(exam.parsedData) as ParsedExam
  } catch {
    parsed = { sections: [] }
  }

  let overallCorrect = 0
  let overallTotal = 0
  const byType: Record<string, { correct: number; total: number }> = {}
  for (const section of parsed.sections) {
    const b = byType[section.type] ?? { correct: 0, total: 0 }
    for (const q of section.questions) {
      if (q.answer === null || q.answer === undefined) continue
      b.total += 1
      overallTotal += 1
      const user = answers[String(q.id)]
      if (user === q.answer) {
        b.correct += 1
        overallCorrect += 1
      }
    }
    byType[section.type] = b
  }

  return prisma.examAttempt.update({
    where: { id: attemptId },
    data: {
      answers: JSON.stringify(answers),
      score: overallTotal > 0 ? Math.round((overallCorrect / overallTotal) * 100) : null,
      scoreByType: JSON.stringify(byType),
      finishedAt: new Date(),
    },
  })
}

export async function deleteAttempt(
  userId: string,
  examId: string,
  attemptId: string,
) {
  await assertAttemptOwned(userId, examId, attemptId)
  await prisma.examAttempt.delete({ where: { id: attemptId } })
  return { id: attemptId }
}
