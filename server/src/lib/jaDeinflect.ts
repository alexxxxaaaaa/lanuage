/**
 * 日语活用形 → 辞書形候选。
 *
 * 查词框里输入的常常不是词头：「食べました」「行かなかった」「寒くて」。这里
 * 只做一件事 —— 把可能的原形列出来，纯字符串规则、不碰词库；哪个候选真实存在
 * 交给 dictEntryService.resolveJaHeadword 拿本地那三十万条日语词头去判。
 *
 * 规则表不带词性，所以宁可多列几个:「行った」同时给「行く」和「行う」，谁是
 * 真词头由词库裁决，谁更常用由候选顺序裁决。每条规则是一次后缀替换，逐层套用
 * 就能拆开复合活用：
 *   食べさせられなかった → 食べさせられない → 食べさせられる → 食べさせる → 食べる
 */

/**
 * 一条后缀替换。`stage` 标记产物只是中间形态（て形 / ます形 / た形）——
 * 照样往下拆，但它本身不作为辞書形候选交出去：「喜んでいる」拆到「喜んで」
 * 时不能停，那一步的落点是「喜ぶ」；偏偏「喜んで」自己也是词库收录的副词，
 * 不标出来就会被当成答案。
 */
type Rule = readonly [from: string, to: string, stage?: true]

/** 五段九行：[辞書形, 連用形, 未然形, 仮定形, 意向形, て形, た形] 的末尾。 */
const GODAN_ROWS = [
  ['う', 'い', 'わ', 'え', 'お', 'って', 'った'],
  ['く', 'き', 'か', 'け', 'こ', 'いて', 'いた'],
  ['ぐ', 'ぎ', 'が', 'げ', 'ご', 'いで', 'いだ'],
  ['す', 'し', 'さ', 'せ', 'そ', 'して', 'した'],
  ['つ', 'ち', 'た', 'て', 'と', 'って', 'った'],
  ['ぬ', 'に', 'な', 'ね', 'の', 'んで', 'んだ'],
  ['ぶ', 'び', 'ば', 'べ', 'ぼ', 'んで', 'んだ'],
  ['む', 'み', 'ま', 'め', 'も', 'んで', 'んだ'],
  ['る', 'り', 'ら', 'れ', 'ろ', 'って', 'った'],
] as const satisfies readonly (readonly string[])[]

/** て形上挂的补助动词。摘掉它们剩下て形，再由五段/一段规则还原。 */
const TE_AUXILIARIES = [
  'いる',
  'る',
  'おく',
  'ある',
  'しまう',
  'みる',
  'いく',
  'くる',
  'くれる',
  'もらう',
  'あげる',
  'ください',
] as const

/** サ変动词的活用后缀。「勉強しました」这类复合词全靠它们拆开。 */
const SURU_SUFFIXES = [
  'します',
  'した',
  'して',
  'しない',
  'せず',
  'される',
  'させる',
  'しよう',
  'すれば',
  'したい',
  'しながら',
  'しろ',
  'せよ',
] as const

/** サ変・カ変・行く。行く 的促音便不在五段那张表里，另外三行是全不規則。 */
const IRREGULAR_RULES: readonly Rule[] = [
  ['行って', '行く'],
  ['行った', '行く'],
  ['いって', 'いく'],
  ['いった', 'いく'],
  ['きます', 'くる'],
  ['きた', 'くる'],
  ['きて', 'くる'],
  ['こない', 'くる'],
  ['こよう', 'くる'],
  ['これば', 'くる'],
  ['こられる', 'くる'],
  ['こさせる', 'くる'],
  ['きたい', 'くる'],
  ['来ます', '来る'],
  ['来た', '来る'],
  ['来て', '来る'],
  ['来ない', '来る'],
  ['来よう', '来る'],
  ['来れば', '来る'],
  ['来られる', '来る'],
  ['来させる', '来る'],
  ['来たい', '来る'],
]

/** 一段：词干后面这些都换回「る」。 */
const ICHIDAN_SUFFIXES = [
  'ます',
  'た',
  'て',
  'ない',
  'ず',
  'られる',
  'させる',
  'れる',
  'よう',
  'れば',
  'たい',
  'ながら',
] as const

/**
 * い形容詞，以及な形容詞・名詞＋だ。
 * 一字后缀（く / さ / な / に）摆在最后：它们谁都能匹配上，排后面能让
 * 更有把握的候选先被词库认走。
 */
const ADJECTIVE_RULES: readonly Rule[] = [
  ['かった', 'い'],
  ['くない', 'い'],
  ['くありませんでした', 'い'],
  ['くありません', 'い'],
  ['くて', 'い'],
  ['ければ', 'い'],
  ['すぎる', 'い'],
  ['そう', 'い'],
  ['ではありません', ''],
  ['じゃありません', ''],
  ['ではない', ''],
  ['じゃない', ''],
  ['でした', ''],
  ['だった', ''],
  ['です', ''],
  ['く', 'い'],
  ['さ', 'い'],
  ['な', ''],
  ['に', ''],
]

function buildRules(): Rule[] {
  const rules: Rule[] = []
  const add = (from: string, to: string, stage?: true) => {
    rules.push([from, to, stage])
  }

  // 丁寧体先收敛成「ます」。否则 ました/ません/ませんでした 各自到辞書形，
  // 五段九行每行都要再写一遍。
  for (const polite of ['ませんでした', 'ましょう', 'ました', 'ません', 'まして']) {
    add(polite, 'ます', true)
  }

  for (const aux of TE_AUXILIARIES) {
    add(`て${aux}`, 'て', true)
    add(`で${aux}`, 'で', true)
  }
  add('ちゃう', 'て', true)
  add('じゃう', 'で', true)

  // 〜たら / 〜たり 回到た形本身，剩下的交给た形规则。
  add('たら', 'た', true)
  add('だら', 'だ', true)
  add('たり', 'た', true)
  add('だり', 'だ', true)

  // 不規則排在五段前面：「行った」两边都讲得通（行く / 行う 都是词头），
  // 先给更常用的那个。
  for (const [from, to] of IRREGULAR_RULES) add(from, to)

  for (const suffix of SURU_SUFFIXES) add(suffix, 'する')

  for (const [u, i, a, e, o, te, ta] of GODAN_ROWS) {
    add(`${i}ます`, u)
    add(te, u)
    add(ta, u)
    add(`${a}ない`, u)
    add(`${a}ず`, u)
    add(`${a}れる`, u) // 受身
    add(`${a}せる`, u) // 使役
    add(`${e}る`, u) // 可能（る行这条同时管一段的ら抜き：食べれる→食べる）
    add(`${e}ば`, u)
    add(`${o}う`, u)
    add(`${i}たい`, u)
    add(`${i}ながら`, u)
  }

  for (const suffix of ICHIDAN_SUFFIXES) add(suffix, 'る')

  for (const [from, to] of ADJECTIVE_RULES) add(from, to)

  // サ変复合词退到词干名词：「勉強しました」→「勉強」。词库（Wiktextract）收的
  // 是名词那一头，する 复合词绝大多数查不到，所以这条退路是必要的。
  // 放在最末尾 —— 它比谁都松：「話させる」该先给五段的「話す」，轮不到「話」。
  for (const suffix of SURU_SUFFIXES) add(suffix, '')
  add('する', '')

  return rules
}

const RULES = buildRules()

/** 辞書形至少两个字（「する」「見る」），再短一定是切过头了。 */
const MIN_LENGTH = 2
/** 拆到第四层够到「食べさせられなかった」，再深就只剩噪音了。 */
const MAX_DEPTH = 4
/** 候选上限。词库那边是一条 IN 查询，不让它无限长。 */
const MAX_CANDIDATES = 60
/** 没有平假名就没有活用可拆 —— 纯汉字 / 片假名 / 罗马字的输入本身就是词头。 */
const HAS_HIRAGANA = /[ぁ-ゖ]/

/**
 * 列出 term 可能的辞書形，按「拆得越浅越靠前、同深度按规则顺序」排。
 * 返回空数组表示这串输入压根不像活用形，调用方不必再去查词库。
 */
export function deinflectJa(term: string): string[] {
  const source = term.trim()
  if (source.length < MIN_LENGTH || !HAS_HIRAGANA.test(source)) return []

  const seen = new Set([source])
  const candidates: string[] = []
  let frontier = [source]

  for (let depth = 0; depth < MAX_DEPTH && frontier.length > 0; depth += 1) {
    const next: string[] = []
    for (const word of frontier) {
      for (const [from, to, stage] of RULES) {
        if (!word.endsWith(from)) continue
        const base = word.slice(0, word.length - from.length) + to
        if (base.length < MIN_LENGTH || seen.has(base)) continue
        seen.add(base)
        next.push(base)
        if (stage) continue
        candidates.push(base)
        if (candidates.length >= MAX_CANDIDATES) return candidates
      }
    }
    frontier = next
  }

  return candidates
}
