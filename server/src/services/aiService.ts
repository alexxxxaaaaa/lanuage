import OpenAI from "openai";
import { prisma } from "../lib/prisma";
import { AppError } from "../errors/AppError";

type SupportedLanguage = "en" | "jp";

type FillWordInput = {
  word: string;
  language: SupportedLanguage;
  extended?: boolean;
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
};

type ExpressionTranslateResult = {
  zhText: string;
  sceneTag: string;
};

const SUPPORTED_LANGUAGES: SupportedLanguage[] = ["en", "jp"];
const DEFAULT_MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini";
const MAX_OUTPUT_TOKENS = 250;
const MAX_OUTPUT_TOKENS_EXTENDED = 600;
const MAX_QUIZ_OUTPUT_TOKENS = 180;
const MAX_EXPRESSION_OUTPUT_TOKENS = 280;

let openaiClient: OpenAI | null = null;

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
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

  return [
    "Return JSON only: word,language,reading,partOfSpeech,meaning,example,note.",
    `language="${language}", ${languageHint}.`,
    "meaning: 简体中文, 按词性分行(如 n./v.).",
    'example: exactly 2 lines; each line "<目标语言句子>｜<中文翻译>".',
    noteHint,
    "Keep concise: meaning<=140 chars, example<=200 chars, note<=60 chars.",
    `word: ${word}`,
  ].join("\n");
}

function buildPromptRetry(word: string, language: SupportedLanguage) {
  return [
    "Return strict JSON only: word,language,reading,partOfSpeech,meaning,example,note.",
    `language must be "${language}".`,
    `word must stay "${word}".`,
    "reading cannot be empty.",
    "meaning cannot be empty, must be concise Simplified Chinese.",
    'example cannot be empty, exactly 2 lines, each line "<target sentence>｜<Chinese translation>".',
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

function buildExpressionCasualPrompt(input: ExpressionCasualInput) {
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

function buildExpressionTranslatePrompt(input: ExpressionTranslateInput) {
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
  const language = input.language;
  const tokenBudget = input.extended
    ? MAX_OUTPUT_TOKENS_EXTENDED
    : MAX_OUTPUT_TOKENS;

  if (!word) throw new AppError("word is required", 400);
  if (!SUPPORTED_LANGUAGES.includes(language)) {
    throw new AppError("language must be en or jp", 400);
  }

  const client = getOpenAIClient();
  const completion = await client.chat.completions.create({
    model: DEFAULT_MODEL,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a concise vocabulary assistant. Always return strict JSON object with requested keys.",
      },
      {
        role: "user",
        content: buildPrompt(word, language),
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
      language,
      model: DEFAULT_MODEL,
      feature: "word_fill",
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
      totalTokens: usage?.total_tokens ?? 0,
    },
  });

  const firstResult = safeParseJson(content, word);
  firstResult.note = normalizeEnglishAdjectiveNote(firstResult);
  if (!isSparseFillWordResult(firstResult)) {
    return firstResult;
  }

  const retryCompletion = await client.chat.completions.create({
    model: DEFAULT_MODEL,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "You are a concise vocabulary assistant. Return strict JSON only.",
      },
      {
        role: "user",
        content: buildPromptRetry(word, language),
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
      language,
      model: DEFAULT_MODEL,
      feature: "word_fill",
      promptTokens: retryUsage?.prompt_tokens ?? 0,
      completionTokens: retryUsage?.completion_tokens ?? 0,
      totalTokens: retryUsage?.total_tokens ?? 0,
    },
  });

  const retryResult = safeParseJson(retryContent, word);
  retryResult.note = normalizeEnglishAdjectiveNote(retryResult);
  return {
    ...firstResult,
    ...retryResult,
    word,
    language,
    reading: retryResult.reading || firstResult.reading || word,
    partOfSpeech: retryResult.partOfSpeech || firstResult.partOfSpeech,
    meaning: retryResult.meaning || firstResult.meaning,
    example: retryResult.example || firstResult.example,
    note: retryResult.note || firstResult.note,
  };
}

export async function generateWordQuizByAi(input: QuizWordInput) {
  const word = sanitize(input.word);
  if (!word) throw new AppError("word is required", 400);
  if (!SUPPORTED_LANGUAGES.includes(input.language)) {
    throw new AppError("language must be en or jp", 400);
  }

  const client = getOpenAIClient();
  const completion = await client.chat.completions.create({
    model: DEFAULT_MODEL,
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
      model: DEFAULT_MODEL,
      feature: "word_quiz",
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
      totalTokens: usage?.total_tokens ?? 0,
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

  const client = getOpenAIClient();
  const completion = await client.chat.completions.create({
    model: DEFAULT_MODEL,
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
      model: DEFAULT_MODEL,
      feature: "expression_casual",
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
      totalTokens: usage?.total_tokens ?? 0,
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

  const client = getOpenAIClient();
  const completion = await client.chat.completions.create({
    model: DEFAULT_MODEL,
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
      model: DEFAULT_MODEL,
      feature: "expression_translate",
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
      totalTokens: usage?.total_tokens ?? 0,
    },
  });

  return safeParseExpressionTranslateJson(content);
}

export async function fillWordByAiAuto(wordInput: string, extended?: boolean) {
  const word = sanitize(wordInput);
  if (!word) throw new AppError("word is required", 400);
  const language = detectLanguageFromWord(word);
  const result = await fillWordByAi({ word, language, extended });
  return { ...result, language };
}

export async function getAiUsageSummary(days = 7) {
  const safeDays = Number.isFinite(days)
    ? Math.max(1, Math.min(90, Math.floor(days)))
    : 7;
  const since = new Date();
  since.setDate(since.getDate() - (safeDays - 1));
  since.setHours(0, 0, 0, 0);

  const logs = await prisma.aiUsageLog.findMany({
    where: { createdAt: { gte: since } },
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
    model: DEFAULT_MODEL,
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
