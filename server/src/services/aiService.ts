import OpenAI from "openai";
import { prisma } from "../lib/prisma";
import { getEnv } from "../lib/env";
import { AppError } from "../errors/AppError";

type SupportedLanguage = "en" | "jp";
type SourceLanguage = SupportedLanguage | "zh";

type FillWordInput = {
  word: string;
  /** Legacy field; kept for callers that don't pass sourceLanguage. */
  language: SupportedLanguage;
  /** New: the language the user typed. Defaults to `language`. */
  sourceLanguage?: SourceLanguage;
  /** New: only meaningful when source=zh — what language to translate INTO. */
  targetLanguage?: SupportedLanguage;
  extended?: boolean;
  userId: string;
};

type FillWordResult = {
  word: string;
  language: SupportedLanguage;
  reading: string;
  partOfSpeech: string;
  meaning: string;
  example: string;
  note: string;
};

type QuizWordInput = {
  word: string;
  reading: string;
  meaning: string;
  example: string;
  language: SupportedLanguage;
  userId: string;
};

type QuizWordResult = {
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
};

type ExpressionCasualInput = {
  zhText: string;
  language?: SupportedLanguage;
  userId: string;
};

type ExpressionCasualResult = {
  zhText: string;
  enCasual: string;
  jpCasual: string;
  sceneTag: string;
};

type ExpressionTranslateInput = {
  text: string;
  language: SupportedLanguage;
  userId: string;
};

type ExpressionTranslateResult = {
  zhText: string;
  sceneTag: string;
};

const SUPPORTED_LANGUAGES: SupportedLanguage[] = ["en", "jp"];
export function getDefaultModel() {
  return getEnv("OPENAI_MODEL")?.trim() || "gpt-4.1-mini";
}
const MAX_OUTPUT_TOKENS = 180;
const MAX_OUTPUT_TOKENS_EXTENDED = 400;
const MAX_QUIZ_OUTPUT_TOKENS = 130;
const MAX_EXPRESSION_OUTPUT_TOKENS = 200;

const DAILY_TOKEN_BUDGET_DEFAULT = 50000;

function getDailyTokenBudget(): number {
  const raw = getEnv("DAILY_AI_TOKEN_BUDGET");
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DAILY_TOKEN_BUDGET_DEFAULT;
}

async function assertWithinDailyBudget(userId: string) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const result = await prisma.aiUsageLog.aggregate({
    where: { userId, createdAt: { gte: start, lte: end } },
    _sum: { totalTokens: true },
  });

  const used = result._sum.totalTokens ?? 0;
  const budget = getDailyTokenBudget();
  if (used >= budget) {
    throw new AppError(
      `今日 AI 用量已达上限 (${used.toLocaleString()} / ${budget.toLocaleString()} tokens)，请明天再试`,
      429,
    );
  }
}

let openaiClient: OpenAI | null = null;

function getOpenAIClient() {
  const apiKey = getEnv("OPENAI_API_KEY")?.trim();
  if (!apiKey) {
    throw new AppError("OPENAI_API_KEY is not configured", 500);
  }
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey });
  }
  return openaiClient;
}

function sanitize(input?: string) {
  return (input ?? "").trim();
}

function parseModelJsonObject<T>(content: string): T {
  const normalized = sanitize(content);
  const candidates: string[] = [normalized];
  const fenced = normalized.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  if (fenced) {
    candidates.push(sanitize(fenced));
  }
  const firstBrace = normalized.indexOf("{");
  const lastBrace = normalized.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(normalized.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // try next candidate
    }
  }

  throw new AppError("AI returned invalid JSON", 502);
}

function detectLanguageFromWord(word: string): SupportedLanguage {
  const normalized = word.trim();
  if (/[\u3040-\u30ff\u31f0-\u31ff\u4e00-\u9faf]/.test(normalized)) return "jp";
  return "en";
}

function buildPrompt(word: string, language: SupportedLanguage) {
  const languageHint =
    language === "jp" ? "jp + kana reading" : "en + IPA reading";
  const noteHint =
    language === "en"
      ? "note: verb->过去式/过去分词, noun->复数, adjective->比较级/最高级; no fabrication"
      : "note: 简短中文用法";
  // Push the model toward sentences that actually exercise the word's morphology
  // instead of bare dictionary form. JP especially needs verb/adjective conjugation
  // to be useful for learners.
  const exampleStyle =
    language === "jp"
      ? 'example: exactly 2 lines; each line "<日本語の例文>｜<中文翻译>". 句子要有一定语境(从句/接续/复合句优先)，避免只用辞書形：动词应使用至少一种变形(て形/た形/ない形/敬語ます形/受身/可能/使役/条件形/意向形等)，形容词应展示语境(过去/否定/连用)。两句要使用不同的形态/语境，不要重复。'
      : 'example: exactly 2 lines; each line "<English sentence>｜<中文翻译>". Sentences should show real syntactic context (subordinate clause/perfect aspect/passive/comparative as appropriate). Avoid bare present-tense templates; vary structure between the two lines.';
  return [
    "Return JSON only: word,language,reading,partOfSpeech,meaning,example,note.",
    `language="${language}", ${languageHint}.`,
    "meaning: 简体中文, 按词性分行(如 n./v.).",
    exampleStyle,
    noteHint,
    "Keep concise: meaning<=140 chars, example<=260 chars, note<=60 chars.",
    `word: ${word}`,
  ].join("\n");
}

function buildTranslatePrompt(chineseWord: string, target: SupportedLanguage) {
  // Translation mode: the user typed Chinese; we need the equivalent word in
  // `target`. The returned `word` is the target-language word, `language` is
  // the target language.
  const headInfo =
    target === "jp"
      ? "Translate the Chinese concept into a natural Japanese word/expression."
      : "Translate the Chinese concept into a natural English word/expression.";
  const langHint = target === "jp" ? "jp + kana reading" : "en + IPA reading";
  const exampleStyle =
    target === "jp"
      ? 'example: exactly 2 lines; each line "<日本語の例文>｜<中文翻译>". 句子要展示真实语境(从句/复合句/受身/可能/敬語等),避免只用辞書形。两行使用不同形态。'
      : 'example: exactly 2 lines; each line "<English sentence>｜<中文翻译>". Show real syntactic context (tense/voice/clause). Two lines vary.';
  const noteHint =
    target === "en"
      ? "note: verb->过去式/过去分词, noun->复数, adjective->比较级/最高级 (when applicable); 若有其它常用对应词,列在 note 末尾"
      : "note: 简短中文用法; 若有其它常用对应词(如「问候」可同时对应 挨拶/こんにちは),列在 note 末尾。";
  return [
    "Return JSON only: word,language,reading,partOfSpeech,meaning,example,note.",
    headInfo,
    `language="${target}", ${langHint}.`,
    "word: the target-language equivalent of the input Chinese (kanji or kana for jp; ascii for en). Pick the most common natural translation. If multiple valid options exist, pick one; mention alternatives in note.",
    "meaning: 简体中文释义, 简洁, 按词性分行(如 n./v.).",
    exampleStyle,
    noteHint,
    "Keep concise: meaning<=140 chars, example<=260 chars, note<=80 chars.",
    `chinese input: ${chineseWord}`,
  ].join("\n");
}

function buildPromptRetry(word: string, language: SupportedLanguage) {
  const exampleRule =
    language === "jp"
      ? 'example cannot be empty, exactly 2 lines, each line "<日本語の例文>｜<中文翻译>". 两句使用不同的动/形变形或语境(如 て形/た形/ない形/敬語/受身/可能/使役/条件形)，避免只给辞書形。'
      : 'example cannot be empty, exactly 2 lines, each line "<English sentence>｜<Chinese translation>". Two lines must vary in syntactic structure (tense/voice/clause type).';
  return [
    "Return strict JSON only: word,language,reading,partOfSpeech,meaning,example,note.",
    `language must be "${language}".`,
    `word must stay "${word}".`,
    "reading cannot be empty.",
    "meaning cannot be empty, must be concise Simplified Chinese.",
    exampleRule,
    "partOfSpeech should be a short value like n./v./adj./adv. when possible.",
    "for English adjectives (adj.), note should include comparative and superlative.",
    "no markdown, no explanation text outside JSON.",
  ].join("\n");
}

function normalizeEnglishAdjectiveNote(result: FillWordResult) {
  if (result.language !== "en") return result.note;
  const pos = result.partOfSpeech.toLowerCase();
  if (!pos.includes("adj")) return result.note;
  if (result.note.includes("比较级") || result.note.includes("最高级"))
    return result.note;
  const word = sanitize(result.word);
  if (!word) return result.note;
  return `比较级: more ${word}; 最高级: most ${word}`;
}

function buildQuizPrompt(input: QuizWordInput) {
  return [
    "Generate one multiple-choice question for vocabulary review.",
    "Return JSON only with keys: question, options, answerIndex, explanation.",
    "- options must be exactly 4 short choices in Chinese",
    "- answerIndex must be 0..3",
    "- explanation must be short Chinese",
    `language: ${input.language}`,
    `word: ${input.word}`,
    `reading: ${input.reading}`,
    `meaning: ${input.meaning}`,
    `example: ${input.example}`,
  ].join("\n");
}

function buildExpressionCasualPrompt(input: { zhText: string; language?: SupportedLanguage }) {
  const target = input.language === "jp" ? "Japanese" : "English";
  const outputRule =
    input.language === "jp"
      ? '- jpCasual: practical spoken Japanese sentence; enCasual must be empty string ""'
      : '- enCasual: practical spoken English sentence; jpCasual must be empty string ""';
  return [
    `Convert Chinese expression to natural daily conversational ${target}.`,
    "Return JSON only with keys: zhText, enCasual, jpCasual, sceneTag.",
    "- zhText: must be exactly the same as input zh, do not paraphrase or shorten",
    outputRule,
    "- sceneTag: one short Chinese tag like 点餐/课堂/寒暄/求助/表达观点",
    "- avoid formal written style",
    "- keep generated sentence concise and practical",
    `input zh: ${input.zhText}`,
  ].join("\n");
}

function buildExpressionTranslatePrompt(input: { text: string; language: SupportedLanguage }) {
  const sourceLabel = input.language === "jp" ? "Japanese" : "English";
  return [
    `Translate the following ${sourceLabel} spoken expression into natural Simplified Chinese.`,
    "Return JSON only with keys: zhText, sceneTag.",
    "- zhText: concise natural Simplified Chinese translation, keep the speaking tone",
    "- sceneTag: one short Chinese tag like 点餐/课堂/寒暄/求助/表达观点",
    "- no formal written style, keep it practical",
    `input ${sourceLabel}: ${input.text}`,
  ].join("\n");
}

function safeParseExpressionTranslateJson(
  content: string,
): ExpressionTranslateResult {
  try {
    const parsed =
      parseModelJsonObject<Partial<ExpressionTranslateResult>>(content);
    const result: ExpressionTranslateResult = {
      zhText: sanitize(parsed.zhText),
      sceneTag: sanitize(parsed.sceneTag),
    };
    if (!result.zhText) {
      throw new AppError("AI returned invalid translate result", 502);
    }
    return result;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("AI returned invalid translate JSON", 502);
  }
}

function safeParseJson(content: string, fallbackWord: string): FillWordResult {
  try {
    const parsed = parseModelJsonObject<
      Partial<FillWordResult> & {
        pronunciation?: string;
        ipa?: string;
        kana?: string;
      }
    >(content);
    const normalizedWord = sanitize(parsed.word) || fallbackWord;
    const normalizedReading =
      sanitize(parsed.reading) ||
      sanitize(parsed.pronunciation) ||
      sanitize(parsed.ipa) ||
      sanitize(parsed.kana) ||
      normalizedWord;
    const result: FillWordResult = {
      word: normalizedWord,
      language: parsed.language === "jp" ? "jp" : "en",
      reading: normalizedReading,
      partOfSpeech: sanitize(parsed.partOfSpeech),
      meaning: sanitize(parsed.meaning),
      example: sanitize(parsed.example),
      note: sanitize(parsed.note),
    };
    if (!result.word || !result.reading) {
      throw new AppError("AI returned invalid result", 502);
    }
    return result;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("AI returned invalid JSON", 502);
  }
}

function isSparseFillWordResult(result: FillWordResult) {
  return !result.meaning || !result.example;
}

function safeParseQuizJson(content: string): QuizWordResult {
  try {
    const parsed = parseModelJsonObject<Partial<QuizWordResult>>(content);
    const options = Array.isArray(parsed.options)
      ? parsed.options
          .map((item) => sanitize(String(item)))
          .filter(Boolean)
          .slice(0, 4)
      : [];
    const answerIndex = Number(parsed.answerIndex);
    if (
      !sanitize(parsed.question) ||
      options.length !== 4 ||
      !Number.isInteger(answerIndex) ||
      answerIndex < 0 ||
      answerIndex > 3
    ) {
      throw new AppError("AI returned invalid quiz format", 502);
    }
    return {
      question: sanitize(parsed.question),
      options,
      answerIndex,
      explanation: sanitize(parsed.explanation),
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("AI returned invalid quiz JSON", 502);
  }
}

function safeParseExpressionJson(
  content: string,
  originalZhText: string,
  language?: SupportedLanguage,
): ExpressionCasualResult {
  try {
    const parsed =
      parseModelJsonObject<Partial<ExpressionCasualResult>>(content);
    const result: ExpressionCasualResult = {
      zhText: originalZhText,
      enCasual: sanitize(parsed.enCasual),
      jpCasual: sanitize(parsed.jpCasual),
      sceneTag: sanitize(parsed.sceneTag),
    };
    const targetValue = language === "jp" ? result.jpCasual : result.enCasual;
    if (!result.zhText || !targetValue) {
      throw new AppError("AI returned invalid expression result", 502);
    }
    return result;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("AI returned invalid expression JSON", 502);
  }
}

export async function fillWordByAi(input: FillWordInput) {
  const word = sanitize(input.word);
  const source: SourceLanguage = input.sourceLanguage ?? input.language;
  // For zh source the result's language is the target; otherwise the result
  // word is in the source language itself.
  const target: SupportedLanguage =
    source === "zh"
      ? input.targetLanguage ?? "jp"
      : source;
  const isTranslateMode = source === "zh";
  const tokenBudget = input.extended
    ? MAX_OUTPUT_TOKENS_EXTENDED
    : MAX_OUTPUT_TOKENS;

  if (!word) throw new AppError("word is required", 400);
  if (!SUPPORTED_LANGUAGES.includes(target)) {
    throw new AppError("targetLanguage must be en or jp", 400);
  }
  if (source !== "zh" && !SUPPORTED_LANGUAGES.includes(source)) {
    throw new AppError("sourceLanguage must be en, jp, or zh", 400);
  }

  await assertWithinDailyBudget(input.userId);

  const client = getOpenAIClient();
  const completion = await client.chat.completions.create({
    model: getDefaultModel(),
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a concise vocabulary assistant. Always return strict JSON object with requested keys.",
      },
      {
        role: "user",
        content: isTranslateMode
          ? buildTranslatePrompt(word, target)
          : buildPrompt(word, target),
      },
    ],
    max_tokens: tokenBudget,
    temperature: 0.2,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new AppError("AI did not return content", 502);
  }

  const usage = completion.usage;
  await prisma.aiUsageLog.create({
    data: {
      word,
      language: target,
      model: getDefaultModel(),
      feature: "word_fill",
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
      totalTokens: usage?.total_tokens ?? 0,
      userId: input.userId,
    },
  });

  const firstResult = safeParseJson(content, word);
  // In translate mode, force-pin language to target — `safeParseJson` defaults
  // to 'en' when the AI omits the field, which would be wrong for zh→jp.
  if (isTranslateMode) {
    firstResult.language = target;
  }
  firstResult.note = normalizeEnglishAdjectiveNote(firstResult);
  if (!isSparseFillWordResult(firstResult)) {
    return firstResult;
  }

  const retryCompletion = await client.chat.completions.create({
    model: getDefaultModel(),
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a concise vocabulary assistant. Return strict JSON only.",
      },
      {
        role: "user",
        content: isTranslateMode
          ? buildTranslatePrompt(word, target) +
            "\n注意: 第一次返回有字段缺失,请确保 meaning 和 example 都不为空。"
          : buildPromptRetry(word, target),
      },
    ],
    max_tokens: tokenBudget,
    temperature: 0.1,
  });

  const retryContent = retryCompletion.choices[0]?.message?.content;
  if (!retryContent) {
    return firstResult;
  }

  const retryUsage = retryCompletion.usage;
  await prisma.aiUsageLog.create({
    data: {
      word,
      language: target,
      model: getDefaultModel(),
      feature: "word_fill",
      promptTokens: retryUsage?.prompt_tokens ?? 0,
      completionTokens: retryUsage?.completion_tokens ?? 0,
      totalTokens: retryUsage?.total_tokens ?? 0,
      userId: input.userId,
    },
  });

  const retryResult = safeParseJson(retryContent, word);
  retryResult.note = normalizeEnglishAdjectiveNote(retryResult);
  // In translate mode the result word is the translation (from AI), not the
  // Chinese input — don't clobber it. In definition mode the word stays.
  return {
    ...firstResult,
    ...retryResult,
    word: isTranslateMode
      ? retryResult.word || firstResult.word
      : word,
    language: target,
    reading: retryResult.reading || firstResult.reading || (isTranslateMode ? '' : word),
    partOfSpeech: retryResult.partOfSpeech || firstResult.partOfSpeech,
    meaning: retryResult.meaning || firstResult.meaning,
    example: retryResult.example || firstResult.example,
    note: retryResult.note || firstResult.note,
  };
}

type ExampleOnlyInput = {
  word: string;
  reading?: string;
  meaning?: string;
  language: SupportedLanguage;
  userId: string;
};

const MAX_EXAMPLE_ONLY_TOKENS = 160;

function buildExampleOnlyPrompt(input: ExampleOnlyInput) {
  const rule =
    input.language === "jp"
      ? '2 行,每行 "<日本語例文>｜<中文翻译>"。两行用不同时态/词形,不要都用辞書形。'
      : '2 lines, each "<English>｜<中文>". Vary tense/voice.';
  return [
    'JSON, key "example" only.',
    `lang=${input.language}`,
    input.meaning ? `义:${sanitize(input.meaning)}` : "",
    rule,
    `词:${sanitize(input.word)}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generateExampleOnlyByAi(input: ExampleOnlyInput) {
  const word = sanitize(input.word);
  if (!word) throw new AppError("word is required", 400);
  if (!SUPPORTED_LANGUAGES.includes(input.language)) {
    throw new AppError("language must be en or jp", 400);
  }

  await assertWithinDailyBudget(input.userId);

  const client = getOpenAIClient();
  const completion = await client.chat.completions.create({
    model: getDefaultModel(),
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You return strict JSON with only the requested key.",
      },
      { role: "user", content: buildExampleOnlyPrompt({ ...input, word }) },
    ],
    max_tokens: MAX_EXAMPLE_ONLY_TOKENS,
    temperature: 0.2,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new AppError("AI did not return content", 502);

  const usage = completion.usage;
  await prisma.aiUsageLog.create({
    data: {
      word,
      language: input.language,
      model: getDefaultModel(),
      feature: "example_only",
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
      totalTokens: usage?.total_tokens ?? 0,
      userId: input.userId,
    },
  });

  const parsed = parseModelJsonObject<{ example?: unknown }>(content);
  // The model sometimes returns example as an array of lines instead of a
  // newline-joined string; flatten both shapes before sanitizing.
  const raw = parsed.example;
  const flat = Array.isArray(raw)
    ? raw.filter((x) => typeof x === "string" && x.trim()).join("\n")
    : typeof raw === "string"
      ? raw
      : "";
  return { example: sanitize(flat) };
}

type FillGrammarInput = {
  pattern: string;
  userId: string;
};

type FillGrammarResult = {
  pattern: string;
  connection: string;
  meaning: string;
  example: string;
  exampleZh: string;
  note: string;
};

const MAX_GRAMMAR_FILL_TOKENS = 360;

function buildGrammarPrompt(pattern: string) {
  return [
    'Return strict JSON only with keys: pattern, connection, meaning, example, exampleZh, note.',
    `Input pattern: ${pattern}`,
    'pattern: echo back the pattern exactly as given.',
    'connection: 接续规则,简体中文,如 "名词 / 动词辞書形 + にあたって"。多条用 \\n 分隔。',
    'meaning: 中文释义,逗号分隔多个义项,<=60 字。',
    'example: 日本語例句,正好 2 行,每行一句完整句,使用 \\n 分隔。两行体现不同语境/词形(如 て形/た形/ない形/敬語/受身/可能/使役/条件形)。每句必须包含该句型。',
    'exampleZh: 与 example 一一对应的中文翻译,正好 2 行,使用 \\n 分隔,顺序与 example 一致。',
    'note: 注意点/近义对比/语感差别,<=100 字,可为空字符串。',
  ].join('\n');
}

export async function fillGrammarByAi(input: FillGrammarInput): Promise<FillGrammarResult> {
  const pattern = sanitize(input.pattern);
  if (!pattern) throw new AppError('pattern is required', 400);

  await assertWithinDailyBudget(input.userId);

  const client = getOpenAIClient();
  const completion = await client.chat.completions.create({
    model: getDefaultModel(),
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: 'You are a Japanese N1 grammar assistant. Return strict JSON only.',
      },
      { role: 'user', content: buildGrammarPrompt(pattern) },
    ],
    max_tokens: MAX_GRAMMAR_FILL_TOKENS,
    temperature: 0.2,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new AppError('AI did not return content', 502);

  const usage = completion.usage;
  await prisma.aiUsageLog.create({
    data: {
      word: pattern,
      language: 'jp',
      model: getDefaultModel(),
      feature: 'grammar_fill',
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
      totalTokens: usage?.total_tokens ?? 0,
      userId: input.userId,
    },
  });

  const parsed = parseModelJsonObject<{
    pattern?: unknown;
    connection?: unknown;
    meaning?: unknown;
    example?: unknown;
    exampleZh?: unknown;
    note?: unknown;
  }>(content);

  // Flatten array-shaped fields (the model occasionally returns example/exampleZh
  // as ["line1", "line2"]) before sanitizing.
  const flatten = (v: unknown): string => {
    if (Array.isArray(v)) return v.filter((x) => typeof x === 'string' && x.trim()).join('\n');
    return typeof v === 'string' ? v : '';
  };

  return {
    pattern,
    connection: sanitize(flatten(parsed.connection)),
    meaning: sanitize(flatten(parsed.meaning)),
    example: sanitize(flatten(parsed.example)),
    exampleZh: sanitize(flatten(parsed.exampleZh)),
    note: sanitize(flatten(parsed.note)),
  };
}

// ===== JLPT 真题逐选项解析 =====

type QbankExplainInput = {
  /** 卷内题号，只用于日志，如 2020.12 Q37。 */
  label: string
  stemJp: string
  options: string[]
  answer: number
  /** 另一来源的答案，0 = 无分歧。非 0 时要求两个答案都给论据。 */
  altAnswer: number
  /** 読解题的文章正文，其余部分为空。 */
  passage: string
  userId: string
}

export type QbankExplainResult = {
  summary: string
  /** 与选项一一对应。 */
  options: string[]
}

/** summary ≤60 字 + 每个选项 ≤45 字，四选一正好卡在 240 字上限内。 */
const QBANK_EXPLAIN_SUMMARY_CHARS = 60
const QBANK_EXPLAIN_OPTION_CHARS = 45
// 中文约 1–1.5 token/字，240 字连 JSON 结构一起给到 500 有富余。
const MAX_QBANK_EXPLAIN_TOKENS = 500
// 全库最长的文章 1385 字，这个上限现有数据碰不到，纯粹是防脏数据把 prompt 撑爆。
const QBANK_PASSAGE_LIMIT = 2000

function buildQbankExplainPrompt(input: QbankExplainInput) {
  const optionList = input.options.map((o, i) => `${i + 1}. ${o}`).join('\n')
  const lines = [
    'Return strict JSON only with keys: summary, options.',
    `summary: 中文,<=${QBANK_EXPLAIN_SUMMARY_CHARS} 字。点出考点,并说明答案为何成立。`,
    `options: 长度正好 ${input.options.length} 的字符串数组,与选项 1..${input.options.length} 一一对应。`,
    `  每条中文 <=${QBANK_EXPLAIN_OPTION_CHARS} 字,说明该项为何对或为何错(错在哪个词/哪条语法/原文哪句)。`,
    '引用日文时用「」括起,不要重复抄整句选项。不要写「选项1」这类编号,直接说理由。',
  ]
  if (input.passage) {
    lines.push('', `【文章】\n${input.passage.slice(0, QBANK_PASSAGE_LIMIT)}`)
  }
  lines.push('', `【题干】\n${input.stemJp}`, '', `【选项】\n${optionList}`)
  if (input.altAnswer > 0) {
    // 分歧题：两个答案都判对，解析必须把两边的论据都摆出来，否则用户只看到
    // 「另一个也算对」却不知道为什么。
    lines.push(
      '',
      `【标准答案】本题两个来源答案不一致：一方给 ${input.answer}，另一方给 ${input.altAnswer}，官方答案无从查证，站点两个都判对。`,
      `summary 必须点明分歧在哪(争点是哪个词或哪句原文)；选项 ${input.answer} 和选项 ${input.altAnswer} 的条目都要给出支持各自的理由,不要把其中一个判成错的。`,
    )
  } else {
    lines.push('', `【标准答案】${input.answer}`)
  }
  return lines.join('\n')
}

export async function explainQbankQuestionByAi(
  input: QbankExplainInput,
): Promise<QbankExplainResult> {
  const stem = sanitize(input.stemJp)
  if (!stem) throw new AppError('题干为空,无法生成解析', 400)

  await assertWithinDailyBudget(input.userId)

  const client = getOpenAIClient()
  const completion = await client.chat.completions.create({
    model: getDefaultModel(),
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You are a JLPT N1 exam tutor. Explain in Simplified Chinese, be concise and specific. Return strict JSON only.',
      },
      { role: 'user', content: buildQbankExplainPrompt({ ...input, stemJp: stem }) },
    ],
    max_tokens: MAX_QBANK_EXPLAIN_TOKENS,
    temperature: 0.2,
  })

  const content = completion.choices[0]?.message?.content
  if (!content) throw new AppError('AI did not return content', 502)

  const usage = completion.usage
  await prisma.aiUsageLog.create({
    data: {
      word: input.label,
      language: 'jp',
      model: getDefaultModel(),
      feature: 'qbank_explain',
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
      totalTokens: usage?.total_tokens ?? 0,
      userId: input.userId,
    },
  })

  const parsed = parseModelJsonObject<{ summary?: unknown; options?: unknown }>(content)
  const options = Array.isArray(parsed.options)
    ? parsed.options.map((v) => sanitize(typeof v === 'string' ? v : ''))
    : []
  const summary = sanitize(typeof parsed.summary === 'string' ? parsed.summary : '')
  if (!summary && options.every((o) => !o)) {
    throw new AppError('AI 返回的解析是空的,请重试', 502)
  }
  // 少给的补空、多给的截掉：渲染时按下标对齐选项，长度不对会错位。
  return {
    summary,
    options: input.options.map((_, i) => options[i] ?? ''),
  }
}

export async function generateWordQuizByAi(input: QuizWordInput) {
  const word = sanitize(input.word);
  if (!word) throw new AppError("word is required", 400);
  if (!SUPPORTED_LANGUAGES.includes(input.language)) {
    throw new AppError("language must be en or jp", 400);
  }

  await assertWithinDailyBudget(input.userId);

  const client = getOpenAIClient();
  const completion = await client.chat.completions.create({
    model: getDefaultModel(),
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You create concise, accurate vocabulary quiz JSON only.",
      },
      {
        role: "user",
        content: buildQuizPrompt(input),
      },
    ],
    max_tokens: MAX_QUIZ_OUTPUT_TOKENS,
    temperature: 0.3,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new AppError("AI did not return quiz content", 502);
  }

  const usage = completion.usage;
  await prisma.aiUsageLog.create({
    data: {
      word,
      language: input.language,
      model: getDefaultModel(),
      feature: "word_quiz",
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
      totalTokens: usage?.total_tokens ?? 0,
      userId: input.userId,
    },
  });

  return safeParseQuizJson(content);
}

export async function generateExpressionCasualByAi(
  input: ExpressionCasualInput,
) {
  const zhText = sanitize(input.zhText);
  if (!zhText) throw new AppError("zhText is required", 400);
  const language = input.language;
  if (language && !SUPPORTED_LANGUAGES.includes(language)) {
    throw new AppError("language must be en or jp", 400);
  }

  await assertWithinDailyBudget(input.userId);

  const client = getOpenAIClient();
  const completion = await client.chat.completions.create({
    model: getDefaultModel(),
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You output concise spoken expression JSON only.",
      },
      {
        role: "user",
        content: buildExpressionCasualPrompt({ zhText, language }),
      },
    ],
    max_tokens: MAX_EXPRESSION_OUTPUT_TOKENS,
    temperature: 0.3,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new AppError("AI did not return expression content", 502);
  }

  const usage = completion.usage;
  await prisma.aiUsageLog.create({
    data: {
      word: zhText,
      language: language ?? "multi",
      model: getDefaultModel(),
      feature: "expression_casual",
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
      totalTokens: usage?.total_tokens ?? 0,
      userId: input.userId,
    },
  });

  return safeParseExpressionJson(content, zhText, language);
}

export async function translateExpressionToZhByAi(
  input: ExpressionTranslateInput,
) {
  const text = sanitize(input.text);
  if (!text) throw new AppError("text is required", 400);
  if (!SUPPORTED_LANGUAGES.includes(input.language)) {
    throw new AppError("language must be en or jp", 400);
  }

  await assertWithinDailyBudget(input.userId);

  const client = getOpenAIClient();
  const completion = await client.chat.completions.create({
    model: getDefaultModel(),
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "You output concise Chinese translation JSON only.",
      },
      {
        role: "user",
        content: buildExpressionTranslatePrompt({
          text,
          language: input.language,
        }),
      },
    ],
    max_tokens: MAX_EXPRESSION_OUTPUT_TOKENS,
    temperature: 0.3,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new AppError("AI did not return translate content", 502);
  }

  const usage = completion.usage;
  await prisma.aiUsageLog.create({
    data: {
      word: text,
      language: input.language,
      model: getDefaultModel(),
      feature: "expression_translate",
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
      totalTokens: usage?.total_tokens ?? 0,
      userId: input.userId,
    },
  });

  return safeParseExpressionTranslateJson(content);
}

export async function fillWordByAiAuto(
  userId: string,
  wordInput: string,
  extended?: boolean,
) {
  const word = sanitize(wordInput);
  if (!word) throw new AppError("word is required", 400);
  const language = detectLanguageFromWord(word);
  const result = await fillWordByAi({ word, language, extended, userId });
  return { ...result, language };
}

export async function getAiUsageSummary(userId: string, days = 7) {
  const safeDays = Number.isFinite(days)
    ? Math.max(1, Math.min(90, Math.floor(days)))
    : 7;
  const since = new Date();
  since.setDate(since.getDate() - (safeDays - 1));
  since.setHours(0, 0, 0, 0);

  const logs = await prisma.aiUsageLog.findMany({
    where: { userId, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const totals = logs.reduce(
    (
      acc: {
        calls: number;
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
      },
      item: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
      },
    ) => {
      acc.calls += 1;
      acc.promptTokens += item.promptTokens;
      acc.completionTokens += item.completionTokens;
      acc.totalTokens += item.totalTokens;
      return acc;
    },
    { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  );

  const byDayMap = new Map<string, { calls: number; totalTokens: number }>();
  for (const item of logs) {
    const key = item.createdAt.toISOString().slice(0, 10);
    const current = byDayMap.get(key) ?? { calls: 0, totalTokens: 0 };
    current.calls += 1;
    current.totalTokens += item.totalTokens;
    byDayMap.set(key, current);
  }

  const byDay = Array.from(byDayMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, value]) => ({ date, ...value }));

  const byFeatureMap = new Map<
    string,
    { calls: number; totalTokens: number }
  >();
  for (const item of logs as Array<(typeof logs)[number] & { feature?: string }>) {
    const key = item.feature || "other";
    const current = byFeatureMap.get(key) ?? { calls: 0, totalTokens: 0 };
    current.calls += 1;
    current.totalTokens += item.totalTokens;
    byFeatureMap.set(key, current);
  }
  const byFeature = Array.from(byFeatureMap.entries())
    .sort((a, b) => b[1].totalTokens - a[1].totalTokens)
    .map(([feature, value]) => ({ feature, ...value }));

  return {
    model: getDefaultModel(),
    days: safeDays,
    totals,
    byDay,
    byFeature,
    logs: logs.map(
      (item: (typeof logs)[number] & { feature?: string }) => ({
        id: item.id,
        word: item.word,
        language: item.language,
        model: item.model,
        feature: item.feature ?? "other",
        totalTokens: item.totalTokens,
        createdAt: item.createdAt,
      }),
    ),
  };
}
