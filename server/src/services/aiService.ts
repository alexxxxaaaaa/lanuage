import { prisma } from "../lib/prisma";
import {
  assertWithinDailyBudget,
  completeJson,
  completeJsonOrThrow,
  getDefaultModel,
  parseModelJsonObject,
  sanitize,
} from "../lib/aiClient";
import { estimateCallCostUsd, getModelRates } from "../config/aiPricing";
import { AppError } from "../errors/AppError";
import {
  AI_SOURCE,
  aiCacheWord,
  aiResultToDictEntryData,
  dictEntryRowToFillResult,
  directionForLanguage,
} from "../lib/aiDictEntry";
import { resolveJaHeadword } from "./dictEntryService";

type SupportedLanguage = "en" | "jp";
type SourceLanguage = SupportedLanguage | "zh";

type FillWordInput = {
  word: string;
  /** The language the user typed. */
  sourceLanguage: SourceLanguage;
  /** Only meaningful when source=zh — what language to translate INTO. */
  targetLanguage?: SupportedLanguage;
  extended?: boolean;
  /** Force regeneration even when a cached AI dict row exists. */
  refresh?: boolean;
  /**
   * 日语活用形是否直接校准到辞書形（默认 true）。
   *
   * 加词页 / 批量加词要 true —— 词单里存「食べました」是实打实的坏数据。
   * 查词页传 false：那边在结果第一行给辞書形建议，改不改由用户点，输入框里的
   * 词绝不背着人换掉。
   */
  normalize?: boolean;
  /**
   * 划词加词时，选中文本所在的那整句。传了它就切到「按语境查词」模式：
   * AI 额外还原原形（baseForm）、按句中的实际义项给释义、并翻译整句
   * （sentenceZh），同时不再生成自造例句 —— 例句用原句本身。
   * 不传则行为与从前完全一致（加词页手输那条路）。
   */
  context?: string;
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
  /**
   * 辞書形/原形。词头真的被换掉时才有值 —— 划词加词的语境模式（字幕里划到
   * 「食べました」，这里给「食べる」），以及 normalize 生效的手输查词。
   * 词头和输入一致时恒为 undefined，`word` 本身就是最终词头。
   */
  baseForm?: string;
  /** input.context 那句话的简体中文翻译。只有语境模式有值。 */
  sentenceZh?: string;
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
const MAX_OUTPUT_TOKENS = 180;
const MAX_OUTPUT_TOKENS_EXTENDED = 400;
/** 语境模式：比常规略宽（多一个整句翻译），但省掉了两行自造例句。 */
const MAX_OUTPUT_TOKENS_CONTEXT = 260;
const MAX_EXPRESSION_OUTPUT_TOKENS = 200;

/**
 * 手输查词时这个词的词形处置，由 fillWordByAi 判定后传进来。两个字段互斥，
 * 都只在日语侧出现。
 */
type WordFormHint = {
  /** 词库判不了这是不是活用形，让模型自己还原（输出多一个 baseForm 字段）。 */
  askBaseForm?: boolean;
  /** 用户执意查活用形时，它的辞書形 —— 告诉模型比让它自己猜强。 */
  inflectedOf?: string | null;
};

function buildPrompt(
  word: string,
  language: SupportedLanguage,
  form: WordFormHint = {},
) {
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
    `Return JSON only: word,language,${form.askBaseForm ? "baseForm," : ""}reading,partOfSpeech,meaning,example,note.`,
    `language="${language}", ${languageHint}.`,
    form.askBaseForm
      ? "baseForm: word 若是动词/形容词的活用形，给出辞書形（食べました→食べる、寒かった→寒い、行かなければ→行く）；本身已是辞書形或其它词性则与 word 相同。reading/partOfSpeech/meaning/example 一律描述 baseForm。"
      : "",
    form.inflectedOf
      ? `「${word}」是「${form.inflectedOf}」的活用形：word 原样保留，reading 给「${word}」这个形的读音，meaning 给「${form.inflectedOf}」的义项，note 开头点明这是哪种活用（如「${form.inflectedOf}」的ます形过去）。`
      : "",
    "meaning: 简体中文, 按词性分行(如 n./v.).",
    exampleStyle,
    noteHint,
    "Keep concise: meaning<=140 chars, example<=260 chars, note<=60 chars.",
    `word: ${word}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * 语境模式的 prompt —— 播客/字幕里划词加词走这条。
 *
 * 和 buildPrompt 的三点不同：
 * 1. 要 baseForm。字幕里出现的是活用形（食べました / 寒かった / running），
 *    但词单里该记原形，否则同一个词会以各种变形存成好几条。
 * 2. 释义按句中义项取。有整句在手，`かける` 这类多义词不该给一长串义项。
 * 3. 不要自造例句 —— 例句用字幕原句，AI 例句会被丢掉，生成它纯属浪费 token。
 *    换成 sentenceZh（整句的中文翻译），例句最终存成「原句｜译文」。
 */
function buildContextPrompt(
  word: string,
  language: SupportedLanguage,
  context: string,
) {
  const languageHint =
    language === "jp" ? "jp + kana reading" : "en + IPA reading";
  const baseFormHint =
    language === "jp"
      ? "baseForm: 若 selected 是动词/形容词的活用形，或带着附着的助词/接续（に/を/は/て/ながら…），给出剥离后的辞書形（食べました→食べる、寒かった→寒い、行かなければ→行く、復旧に→復旧）；本身已是辞書形或其它词性则与之相同。"
      : "baseForm: if `selected` is an inflected form, give the dictionary form (running→run, better→good, mice→mouse); otherwise repeat it unchanged.";
  return [
    "Return JSON only: word,language,baseForm,reading,partOfSpeech,meaning,note,sentenceZh.",
    `language="${language}", ${languageHint}.`,
    baseFormHint,
    "word: 与 baseForm 相同。reading/partOfSpeech/meaning/note 全部描述 baseForm，不描述 selected 的变形。",
    "meaning: 简体中文，只给该词在 sentence 里的实际义项（多义词不要罗列全部），按词性分行(如 v./n.)。",
    "note: 简短中文用法提示；日语动词标自他/一段五段，英语标不规则变化。没有就给空串。",
    "sentenceZh: sentence 的简体中文翻译，口语化、别逐字硬译。",
    "Do NOT invent example sentences — there is no example key in the output.",
    "Keep concise: meaning<=140 chars, note<=60 chars, sentenceZh<=120 chars.",
    `selected: ${word}`,
    `sentence: ${context}`,
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
    // baseForm/sentenceZh 只有语境模式的 prompt 会要求，别的模式解析出
    // undefined 就对了 —— 下游用 `?? word` 兜底，不影响老路径。
    const baseForm = sanitize(parsed.baseForm);
    const sentenceZh = sanitize(parsed.sentenceZh);
    const result: FillWordResult = {
      word: normalizedWord,
      language: parsed.language === "jp" ? "jp" : "en",
      reading: normalizedReading,
      partOfSpeech: sanitize(parsed.partOfSpeech),
      meaning: sanitize(parsed.meaning),
      example: sanitize(parsed.example),
      note: sanitize(parsed.note),
      ...(baseForm ? { baseForm } : {}),
      ...(sentenceZh ? { sentenceZh } : {}),
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

export async function fillWordByAi(
  input: FillWordInput,
): Promise<FillWordResult & { cached: boolean }> {
  const word = sanitize(input.word);
  const source = input.sourceLanguage;
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

  // 语境模式单独走一条，不共用下面的缓存 + 二次补全链路。理由见
  // fillWordInContext 的注释。
  if (input.context && !isTranslateMode) {
    return await fillWordInContext({
      word,
      language: target,
      context: input.context,
      userId: input.userId,
    });
  }

  // 日语词形判定。「食べました」照原样问下去，模型会照着活用形编读音和词性，
  // 缓存还会以活用形当词头写进 DictEntry —— 词典结果区和右侧索引栏跟着一起脏。
  const resolved =
    target === "jp" && !isTranslateMode
      ? await resolveJaHeadword(word)
      : ({ kind: "headword" } as const);
  const shouldNormalize = input.normalize !== false;
  // 校准后的词头：prompt、缓存键、返回的 word 全用它。顺带让「食べました」
  // 命中「食べる」已有的缓存行，零 token。
  let headword = shouldNormalize && resolved.kind === "base" ? resolved.word : word;
  // 用户执意查活用形（查词页只给建议、不改写）。结果照给，但见下面的 cache()。
  const inflectedOf = !shouldNormalize && resolved.kind === "base" ? resolved.word : null;
  // 候选一个都没被词库收录（生僻词/口语/复合表达），让模型自己还原。
  const askBaseForm = shouldNormalize && resolved.kind === "unknown";
  /**
   * 非辞書形不写词典缓存：DictEntry 是全局的、按词头存，写进一条「食べました」
   * 就会出现在词典结果区和右侧索引栏里。代价是这种查询每次都重新生成。
   */
  const cache = (result: FillWordResult) =>
    inflectedOf ? Promise.resolve() : writeAiDictCache(result);

  // Cache-first：非翻译模式先查 DictEntry 的 ai 行，命中零 token 直接返回。
  // extended 生成的内容更全，跳过缓存读但照样写（覆盖旧行）。zh 输入没法当
  // 缓存键（缓存按目标语词头存），恒生成，但结果照写 —— 之后直接查那个
  // 日语/英语词就能命中。活用形连读都跳过：那里躺着的只可能是这次修复之前
  // 写坏的行。
  if (!isTranslateMode && !input.refresh && !input.extended && !inflectedOf) {
    const row = await prisma.dictEntry.findFirst({
      where: {
        direction: directionForLanguage(target),
        word: aiCacheWord(headword, target),
        source: AI_SOURCE,
      },
    });
    if (row) {
      return {
        ...dictEntryRowToFillResult(row),
        ...(headword !== word ? { baseForm: headword } : {}),
        cached: true,
      };
    }
  }

  await assertWithinDailyBudget(input.userId);

  const usageLog = {
    word,
    language: target,
    feature: "word_fill",
    userId: input.userId,
  };

  const content = await completeJsonOrThrow({
    system:
      "You are a concise vocabulary assistant. Always return strict JSON object with requested keys.",
    user: isTranslateMode
      ? buildTranslatePrompt(word, target)
      : buildPrompt(headword, target, { askBaseForm, inflectedOf }),
    maxOutputTokens: tokenBudget,
    log: usageLog,
  });

  const firstResult = safeParseJson(content, headword);
  // 词库判不了、交给模型还原的那条路：以模型给的原形为准。
  if (askBaseForm && firstResult.baseForm) {
    headword = firstResult.baseForm;
  }
  // In translate mode, force-pin language to target — `safeParseJson` defaults
  // to 'en' when the AI omits the field, which would be wrong for zh→jp.
  if (isTranslateMode) {
    firstResult.language = target;
  }
  // 日语侧词头以校准结果为准：模型偶尔会把 word 回成别的写法，那会让缓存键和
  // 下次查询用的键对不上，同一个词每次都得重新生成。
  if (target === "jp" && !isTranslateMode) {
    firstResult.word = headword;
  }
  // 词头没被换掉就显式清空 baseForm：模型在 askBaseForm 那条路上会照样回一个
  // 和输入相同的原形，前端拿它当「已校准」提示就成了自说自话。
  const normalized =
    headword !== word ? { baseForm: headword } : { baseForm: undefined };
  firstResult.note = normalizeEnglishAdjectiveNote(firstResult);
  if (!isSparseFillWordResult(firstResult)) {
    await cache(firstResult);
    return { ...firstResult, ...normalized, cached: false };
  }

  // A second pass at the same prompt, sharpened. An empty reply here is not
  // fatal — the first result is already usable, just thin.
  const retryContent = await completeJson({
    system: "You are a concise vocabulary assistant. Return strict JSON only.",
    user: isTranslateMode
      ? buildTranslatePrompt(word, target) +
        "\n注意: 第一次返回有字段缺失,请确保 meaning 和 example 都不为空。"
      : buildPromptRetry(headword, target),
    maxOutputTokens: tokenBudget,
    log: usageLog,
  });
  if (!retryContent) {
    await cache(firstResult);
    return { ...firstResult, ...normalized, cached: false };
  }

  const retryResult = safeParseJson(retryContent, headword);
  retryResult.note = normalizeEnglishAdjectiveNote(retryResult);
  // In translate mode the result word is the translation (from AI), not the
  // Chinese input — don't clobber it. In definition mode the word stays.
  const merged: FillWordResult = {
    ...firstResult,
    ...retryResult,
    word: isTranslateMode
      ? retryResult.word || firstResult.word
      : headword,
    language: target,
    reading:
      retryResult.reading || firstResult.reading || (isTranslateMode ? '' : headword),
    partOfSpeech: retryResult.partOfSpeech || firstResult.partOfSpeech,
    meaning: retryResult.meaning || firstResult.meaning,
    example: retryResult.example || firstResult.example,
    note: retryResult.note || firstResult.note,
  };
  await cache(merged);
  return { ...merged, ...normalized, cached: false };
}

/**
 * 语境模式：划词加词。返回原形 + 该义项的释义 + 整句中文。
 *
 * 有意**不碰 DictEntry 缓存**，读写都不碰：
 * - 读不了：缓存按词头存，而原形要等 AI 回来才知道，划到的「食べました」当
 *   键查不中；拿选中原文去查还会把活用形当成词头污染。
 * - 不该写：这里的 meaning 是「该词在这句话里的义项」，窄于词典义；而且没有
 *   example（例句用字幕原句）。把这种行写进全局缓存，加词页以后查同一个词会
 *   命中一条义项不全、例句为空的行 —— 比没有缓存更糟。
 *
 * 代价是同一个词划两次就付两次 token。整句翻译本来就没法跨句缓存，这条路
 * 每次至少一个请求，所以省不下来；日预算按 260 token/次 算够划一百多个词。
 */
async function fillWordInContext(params: {
  word: string;
  language: SupportedLanguage;
  context: string;
  userId: string;
}): Promise<FillWordResult & { cached: boolean }> {
  const { word, language, context, userId } = params;
  await assertWithinDailyBudget(userId);

  const content = await completeJsonOrThrow({
    system:
      "You are a concise vocabulary assistant. Always return strict JSON object with requested keys.",
    user: buildContextPrompt(word, language, context),
    maxOutputTokens: MAX_OUTPUT_TOKENS_CONTEXT,
    log: { word, language, feature: "word_fill_context", userId },
  });

  const parsed = safeParseJson(content, word);
  // 原形取值顺序：AI 的 baseForm → AI 回的 word → 选中原文。三层兜底是因为
  // 词头一旦为空，前端那个弹框就没东西可存了。
  const baseForm = parsed.baseForm || parsed.word || word;
  const result: FillWordResult = {
    ...parsed,
    word: baseForm,
    language,
    baseForm,
    reading: parsed.reading || baseForm,
    // prompt 里就没要 example —— 例句由前端用字幕原句拼「原句｜译文」。
    example: "",
  };
  result.note = normalizeEnglishAdjectiveNote(result);
  return { ...result, cached: false };
}

/**
 * 生成成功后落 DictEntry 缓存（source='ai'，同 (direction, word) 全局一份）。
 * delete+create 非严格原子（D1 batch），最坏 delete 成功 create 失败 → 缓存行
 * 丢失，下次生成自愈；写失败不能丢掉用户已付 token 的生成结果，降级为仅日志。
 */
async function writeAiDictCache(result: FillWordResult) {
  try {
    const data = aiResultToDictEntryData(result);
    if (!data.word) return;
    await prisma.$transaction([
      prisma.dictEntry.deleteMany({
        where: { direction: data.direction, word: data.word, source: AI_SOURCE },
      }),
      prisma.dictEntry.create({ data }),
    ]);
  } catch (error) {
    console.warn("writeAiDictCache failed:", error);
  }
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

  const content = await completeJsonOrThrow({
    system: "You return strict JSON with only the requested key.",
    user: buildExampleOnlyPrompt({ ...input, word }),
    maxOutputTokens: MAX_EXAMPLE_ONLY_TOKENS,
    log: {
      word,
      language: input.language,
      feature: "example_only",
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

  const content = await completeJsonOrThrow({
    system: 'You are a Japanese N1 grammar assistant. Return strict JSON only.',
    user: buildGrammarPrompt(pattern),
    maxOutputTokens: MAX_GRAMMAR_FILL_TOKENS,
    log: {
      word: pattern,
      language: 'jp',
      feature: 'grammar_fill',
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
  /** 卷次 + 题号，只用于日志，如 2020.12 Q37。 */
  label: string
  /** 卷内题号（Q41），文章の文法要靠它在文章里定位空格。 */
  seq: string
  /** 題型名（「文の組み立て」等），決定这道题该往哪个方向讲。 */
  questionType: string
  stemJp: string
  /**
   * 题库自带的 stemZh。名字叫「中文」，装的东西却按題型各不相同，同一題型内
   * 也不统一（源站如此）：多数是题干中译，用法（問題4）是「词（读音）:释义」，
   * 文の組み立て（問題6）有 61/155 道存的是**填好空的日文完整句**，
   * 文章の文法（問題7）有些存的是整段解题说明。
   * 与其猜，不如把几种可能一起告诉模型，让它按内容认。
   */
  stemZh: string
  options: string[]
  answer: number
  /** 另一来源的答案，0 = 无分歧。非 0 时要求两个答案都给论据。 */
  altAnswer: number
  /** 読解题的文章正文，其余部分为空。 */
  passage: string
  /** 题库自带的解析，给 AI 当参考；全库 188 道笔试题没有。 */
  sourceExplain: string
  userId: string
}

export type QbankExplainResult = {
  summary: string
  /** 与选项一一对应，每条都有值。 */
  options: string[]
}

/**
 * 篇幅上限。要讲透「错在哪个词、哪条语法、与原文哪句冲突」，45 字是不够的，
 * 一句引用就占掉大半。四选一合计约 440 字。
 */
const QBANK_EXPLAIN_SUMMARY_CHARS = 120
const QBANK_EXPLAIN_OPTION_CHARS = 80
// 中文约 1–1.5 token/字，440 字连 JSON 结构一起给到 1100 有富余。
const MAX_QBANK_EXPLAIN_TOKENS = 1100
// 全库最长的文章 1385 字、最长的自带解析 1184 字，两个上限现有数据都碰不到，
// 纯粹是防脏数据把 prompt 撑爆。
const QBANK_PASSAGE_LIMIT = 2000
const QBANK_SOURCE_EXPLAIN_LIMIT = 1500

/** 文の組み立て（問題6）—— 全库唯一一个「选项全都要用上」的題型，见下面的排序题分支。 */
const ORDERING_TYPE = '文の組み立て'
/** 文章の文法（問題7）—— 空格在文章里，题干那个「（1）」指不到它，见下面的定位分支。 */
const CLOZE_TYPE = '文章の文法'

function buildQbankExplainPrompt(input: QbankExplainInput) {
  const count = input.options.length
  const optionList = input.options.map((o, i) => `${i + 1}. ${o}`).join('\n')
  const lines = [
    'Return strict JSON only with keys: summary, options.',
    `summary: 中文,<=${QBANK_EXPLAIN_SUMMARY_CHARS} 字。点出考点,并说明答案为何成立。`,
    `options: 长度正好 ${count} 的字符串数组,与选项 1..${count} 一一对应。`,
    // 逐选项才是这个功能的全部价值。模型很容易只写错项、跳过正解，或者干脆
    // 少给一条 —— 那样前端渲染出来就是缺一块，所以把「一条都不能少」写死。
    `  这 ${count} 条一条都不能少,也不能是空串;正确答案那条同样要写清它为何成立。`,
    `  每条中文 <=${QBANK_EXPLAIN_OPTION_CHARS} 字,说明该项为何对或为何错 ——`,
    '  错在哪个词、搭配不了哪条语法、与原文哪句冲突,要具体,不要只写「不符合语境」。',
    '引用日文时用「」括起,不要重复抄整句选项。不要写「选项1」这类编号,直接说理由。',
  ]
  if (input.questionType) lines.push('', `【題型】${input.questionType}`)
  if (input.passage) {
    lines.push('', `【文章】\n${input.passage.slice(0, QBANK_PASSAGE_LIMIT)}`)
  }
  if (input.stemJp) lines.push('', `【题干】\n${input.stemJp}`)
  if (input.questionType === CLOZE_TYPE) {
    // 要填的空在文章里，标的是卷内题号（41–45）；题干那个「（1）」是大題内序号，
    // 两套编号对不上（全库 144 道都如此），只给题干的话模型会去找错空。
    // 2025 两套更干脆，题干整个是空的。
    const no = input.seq.replace(/\D/g, '')
    lines.push(
      '',
      `【定位】这道题填的是文章里的一个空。本题卷内题号 ${input.seq}${
        no ? `，文章里对应的空多数标作「（ ${no} ）」` : ''
      }；题干里的「（1）」这类数字是大題内序号，与文章里的编号不是一套，别照它去找。`,
    )
  }
  if (input.stemZh) {
    lines.push(
      '',
      `【题干补充】题库自带，可能是题干中译、考查词释义、填好空的完整句、或一段解题说明，按内容自行判断：\n${input.stemZh}`,
    )
  }
  lines.push('', `【选项】\n${optionList}`)
  if (input.questionType === ORDERING_TYPE) {
    // 排序题的四个选项全都要用上，没有「错误选项」，答案数字指的是 ★ 那一空填谁。
    // 不说清楚，模型会照四选一的套路把另外三项判成错的 —— 那是彻头彻尾的错解析。
    lines.push(
      '',
      `【注意】这是排序题：${count} 个选项要全部填进句中的空，不存在「错误选项」，`,
      '下面【标准答案】的数字指的是 ★ 那一个空填哪一项。',
      'summary 要给出完整顺序(如「3→1→4→2」)并说明为什么这样接；',
      'options 的每一条讲这一项落在第几个空、为什么接在那里(接哪个词、构成哪条语法)，不要判对错。',
    )
  }
  if (input.sourceExplain) {
    // 题库自带的解析质量参差，有的只有一行。当线索用，别让模型照抄 ——
    // 用户要的是另一份独立的分析，抄一遍等于这个按钮白点。
    lines.push(
      '',
      `【参考解析】题库自带，可能不全或只讲了一部分，用作线索但要自己判断，不要照抄，逐选项那 ${count} 条必须是你自己的话：\n${input.sourceExplain.slice(0, QBANK_SOURCE_EXPLAIN_LIMIT)}`,
    )
  }
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

/** 一次调用 + 解析。长度对齐选项：少给的留空，多给的截掉。 */
async function requestQbankExplain(
  input: QbankExplainInput,
  user: string,
): Promise<QbankExplainResult> {
  const content = await completeJsonOrThrow({
    system:
      'You are a JLPT N1 exam tutor. Explain in Simplified Chinese, be concise and specific. Return strict JSON only.',
    user,
    maxOutputTokens: MAX_QBANK_EXPLAIN_TOKENS,
    log: {
      word: input.label,
      language: 'jp',
      feature: 'qbank_explain',
      userId: input.userId,
    },
  })

  const parsed = parseModelJsonObject<{ summary?: unknown; options?: unknown }>(content)
  const options = Array.isArray(parsed.options) ? parsed.options : []
  return {
    summary: sanitize(typeof parsed.summary === 'string' ? parsed.summary : ''),
    options: input.options.map((_, i) => {
      const v = options[i]
      return sanitize(typeof v === 'string' ? v : '')
    }),
  }
}

/**
 * 逐选项解析。题干为空的题（文法7 有 8 道，题干整个在文章里）靠 passage 立住，
 * 两个都没有才是真的没东西可讲。
 *
 * 缺条目就重来一次：缓存是全局的，一份缺了两条的解析会被之后每个点开这题的人
 * 看到，多花一次调用比留下残缺划算。第二次仍然缺就报错，让用户自己决定要不要再点。
 */
export async function explainQbankQuestionByAi(
  input: QbankExplainInput,
): Promise<QbankExplainResult> {
  const stem = sanitize(input.stemJp)
  const passage = sanitize(input.passage)
  if (!stem && !passage) throw new AppError('题干为空,无法生成解析', 400)
  if (input.options.length === 0) throw new AppError('这道题没有选项,无法生成解析', 400)

  await assertWithinDailyBudget(input.userId)

  const normalized = { ...input, stemJp: stem, passage }
  const prompt = buildQbankExplainPrompt(normalized)
  const first = await requestQbankExplain(normalized, prompt)
  if (first.summary && first.options.every(Boolean)) return first

  const missing = first.options
    .map((text, i) => (text ? 0 : i + 1))
    .filter(Boolean)
    .join('、')
  const retry = await requestQbankExplain(
    normalized,
    `${prompt}\n\n【重来】上一次的回答${
      missing ? `漏了选项 ${missing} 的条目` : 'summary 是空的'
    }。这次 summary 和全部 ${input.options.length} 条逐项解析都要给齐，一条都不能空。`,
  )
  // 两次各有各的缺口时按条目取并集，能凑齐就不必让用户重点一次。
  const merged: QbankExplainResult = {
    summary: retry.summary || first.summary,
    options: retry.options.map((text, i) => text || first.options[i]),
  }
  if (!merged.summary || merged.options.some((text) => !text)) {
    throw new AppError('AI 这次没给全逐项解析,请重试', 502)
  }
  return merged
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

  const content = await completeJsonOrThrow({
    system: "You output concise spoken expression JSON only.",
    user: buildExpressionCasualPrompt({ zhText, language }),
    maxOutputTokens: MAX_EXPRESSION_OUTPUT_TOKENS,
    log: {
      word: zhText,
      language: language ?? "multi",
      feature: "expression_casual",
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

  const content = await completeJsonOrThrow({
    system: "You output concise Chinese translation JSON only.",
    user: buildExpressionTranslatePrompt({ text, language: input.language }),
    maxOutputTokens: MAX_EXPRESSION_OUTPUT_TOKENS,
    log: {
      word: text,
      language: input.language,
      feature: "expression_translate",
      userId: input.userId,
    },
  });

  return safeParseExpressionTranslateJson(content);
}

export async function getAiUsageSummary(userId: string, days = 7) {
  const safeDays = Number.isFinite(days)
    ? Math.max(1, Math.min(90, Math.floor(days)))
    : 7;
  const since = new Date();
  since.setDate(since.getDate() - (safeDays - 1));
  since.setHours(0, 0, 0, 0);

  const where = { userId, createdAt: { gte: since } };

  // Two reads, on purpose. The ledger backs every total on the card, so it has
  // to span the whole window — a `take` here would quietly bill only the most
  // recent slice of a busy period. The call list is a display of recent
  // activity and stays paged. Dropping `word` from the wide read is what keeps
  // it cheap; it is the only long column and the ledger never shows it.
  const [ledger, logs] = await Promise.all([
    prisma.aiUsageLog.findMany({
      where,
      select: {
        model: true,
        feature: true,
        promptTokens: true,
        cachedTokens: true,
        cacheWriteTokens: true,
        completionTokens: true,
        totalTokens: true,
        createdAt: true,
      },
    }),
    prisma.aiUsageLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);

  const totals = {
    calls: 0,
    promptTokens: 0,
    cachedTokens: 0,
    cacheWriteTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    /** Calls on a model we hold no price for. Counted, never billed as zero. */
    unpricedCalls: 0,
  };
  const byDayMap = new Map<string, { calls: number; totalTokens: number }>();
  const byFeatureMap = new Map<string, { calls: number; totalTokens: number }>();

  for (const row of ledger) {
    totals.calls += 1;
    totals.promptTokens += row.promptTokens;
    totals.cachedTokens += row.cachedTokens;
    totals.cacheWriteTokens += row.cacheWriteTokens;
    totals.completionTokens += row.completionTokens;
    totals.totalTokens += row.totalTokens;

    // Priced per row rather than per model total: the rate card a request
    // lands on depends on that request's own prompt size.
    const cost = estimateCallCostUsd(row.model, row);
    if (cost === null) totals.unpricedCalls += 1;
    else totals.costUsd += cost;

    const day = row.createdAt.toISOString().slice(0, 10);
    const dayBucket = byDayMap.get(day) ?? { calls: 0, totalTokens: 0 };
    dayBucket.calls += 1;
    dayBucket.totalTokens += row.totalTokens;
    byDayMap.set(day, dayBucket);

    const feature = row.feature || "other";
    const featureBucket = byFeatureMap.get(feature) ?? { calls: 0, totalTokens: 0 };
    featureBucket.calls += 1;
    featureBucket.totalTokens += row.totalTokens;
    byFeatureMap.set(feature, featureBucket);
  }

  const byDay = Array.from(byDayMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, value]) => ({ date, ...value }));

  const byFeature = Array.from(byFeatureMap.entries())
    .sort((a, b) => b[1].totalTokens - a[1].totalTokens)
    .map(([feature, value]) => ({ feature, ...value }));

  const model = getDefaultModel();

  return {
    model,
    // Shipped alongside the numbers so the UI can print the rate card it was
    // billed at without keeping a second copy of the price table.
    rates: getModelRates(model),
    days: safeDays,
    totals,
    byDay,
    byFeature,
    logs: logs.map((item) => ({
      id: item.id,
      word: item.word,
      language: item.language,
      model: item.model,
      feature: item.feature,
      totalTokens: item.totalTokens,
      createdAt: item.createdAt,
    })),
  };
}
