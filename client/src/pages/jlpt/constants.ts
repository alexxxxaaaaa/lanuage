/**
 * JLPT N1 的題型元数据。題型名和大題指示语由 (category, mondaiNo) 唯一决定，
 * 3207 道题里全都一样，所以放前端常量而不是每行存一份。
 * 数据侧只保留 category + mondaiNo 两个数字维度，见 server/prisma/schema.prisma。
 */

export type CategoryKey = 'vocab' | 'grammar' | 'reading' | 'listening'

export type Category = {
  key: CategoryKey
  label: string
  /** 日文分区名，跟真题卷面一致 */
  section: string
}

export const CATEGORIES: Category[] = [
  { key: 'vocab', label: '词汇', section: '文字・語彙' },
  { key: 'grammar', label: '语法', section: '文法' },
  { key: 'reading', label: '阅读', section: '読解' },
  { key: 'listening', label: '听力', section: '聴解' },
]

export type MondaiMeta = {
  /** 題型名，如「漢字読み」 */
  type: string
  /** 卷面上的大題指示语 */
  instruction: string
}

const MONDAI: Record<CategoryKey, Record<number, MondaiMeta>> = {
  vocab: {
    1: {
      type: '漢字読み',
      instruction: '＿＿の言葉の読み方として最もよいものを、1・2・3・4から一つ選びなさい。',
    },
    2: {
      type: '文脈規定',
      instruction: '（　）に入れるのに最もよいものを、1・2・3・4から一つ選びなさい。',
    },
    3: {
      type: '言い換え類義',
      instruction: '＿＿の言葉に意味が最も近いものを、1・2・3・4から一つ選びなさい。',
    },
    4: {
      type: '用法',
      instruction: '次の言葉の使い方として最もよいものを、1・2・3・4から一つ選びなさい。',
    },
  },
  grammar: {
    5: {
      type: '文法形式の判断',
      instruction: '次の文の（　）に入れるのに最もよいものを、1・2・3・4から一つ選びなさい。',
    },
    6: {
      type: '文の組み立て',
      instruction: '次の文の　★　に入る最もよいものを、1・2・3・4から一つ選びなさい。',
    },
    7: {
      type: '文章の文法',
      instruction:
        '次の文章を読んで、文章全体の趣旨を踏まえて、＿＿の中に入る最もよいものを、1・2・3・4から一つ選びなさい。',
    },
  },
  reading: {
    8: {
      type: '内容理解（短文）',
      instruction:
        '次の文章を読んで、後の問いに対する答えとして最もよいものを、1・2・3・4から一つ選びなさい。',
    },
    9: {
      type: '内容理解（中文）',
      instruction:
        '次の文章を読んで、後の問いに対する答えとして最もよいものを、1・2・3・4から一つ選びなさい。',
    },
    10: {
      type: '内容理解（長文）',
      instruction:
        '次の文章を読んで、後の問いに対する答えとして最もよいものを、1・2・3・4から一つ選びなさい。',
    },
    11: {
      type: '統合理解',
      instruction:
        '次のAとBの文章を読んで、後の問いに対する答えとして最もよいものを、1・2・3・4から一つ選びなさい。',
    },
    12: {
      type: '主張理解（長文）',
      instruction:
        '次の文章を読んで、後の問いに対する答えとして最もよいものを、1・2・3・4から一つ選びなさい。',
    },
    13: {
      type: '情報検索',
      instruction:
        '右のページを読んで、下の問いに対する答えとして最もよいものを、1・2・3・4から一つ選びなさい。',
    },
  },
  listening: {
    1: {
      type: '課題理解',
      instruction:
        'まず質問を聞いてください。それから話を聞いて、1から4の中から、最もよいものを一つ選んでください。',
    },
    2: {
      type: 'ポイント理解',
      instruction:
        'まず質問を聞いてください。そのあと、せんたくしを読んでください。それから話を聞いて、1から4の中から、最もよいものを一つ選んでください。',
    },
    3: {
      type: '概要理解',
      instruction:
        '全体としてどんな内容かを聞く問題です。話の前に質問はありません。話のあとの質問とせんたくしを聞いて、1から4の中から、最もよいものを一つ選んでください。',
    },
    4: {
      type: '即時応答',
      instruction:
        'まず文を聞いてください。それから、それに対する返事を聞いて、1から3の中から、最もよいものを一つ選んでください。',
    },
    5: {
      type: '統合理解',
      instruction: '長めの話を聞きます。問題用紙にメモをとってもかまいません。',
    },
  },
}

export function mondaiMeta(category: string, mondaiNo: number): MondaiMeta {
  return (
    MONDAI[category as CategoryKey]?.[mondaiNo] ?? {
      type: '',
      instruction: '',
    }
  )
}

/** 听力的大題号在卷面上写作「問題1」，但它和笔试的問題1 是两套编号。 */
export function mondaiLabel(category: string, mondaiNo: number): string {
  return category === 'listening' ? `聴解 問題${mondaiNo}` : `問題${mondaiNo}`
}

export function categoryLabel(category: string): string {
  return CATEGORIES.find((c) => c.key === category)?.label ?? category
}

export function paperLabel(year: number, month: number): string {
  return `${year}年${month}月`
}

/**
 * 模拟考试里答题卡跳题用的锚点 id。题 id 本身全库唯一（n1-202012-q1），
 * 同一套卷子也不会有两个页面实例同时挂着，不会撞。
 */
export function questionDomId(questionId: string): string {
  return `exam-q-${questionId}`
}

/** 即時応答（聴解4）等題型的选项卷面上本就不印，源数据存的是 "1"/"2"/"3" 占位符。 */
export function hasPlaceholderOptions(options: string[]): boolean {
  return options.length > 0 && options.every((o, i) => o.trim() === String(i + 1))
}

// ===== 模拟考试 =====

/** 官方成绩单的三个分区，与服务端 qbankExamService 的 SECTIONS 一一对应。 */
export const EXAM_SECTIONS: Record<string, string> = {
  language: '言語知識（文字・語彙・文法）',
  reading: '読解',
  listening: '聴解',
}

export const EXAM_MODES = [
  {
    value: 'strict',
    label: '严格',
    desc: '计时结束或录音播完立刻交卷，听力不能拖动进度条 —— 完全照真实考场。',
  },
  {
    value: 'self',
    label: '自我评估',
    desc: '超时和录音播完都不强制交卷，听力可以拖动进度条，自己掌握节奏。',
  },
] as const

export function examModeLabel(mode: string): string {
  return EXAM_MODES.find((m) => m.value === mode)?.label ?? mode
}

/** mm:ss / h:mm:ss，负数由调用方自己加「超时」前缀。 */
export function formatClock(ms: number): string {
  const total = Math.floor(Math.abs(ms) / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(h > 0 ? m : m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}
