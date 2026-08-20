/**
 * 把题库的解析 / 译文重新切回有结构的块。渲染见同目录的 ExplainText。
 *
 * 源 markdown 里 explain、stemZh 是 `- explain: …` 这样的**单行**字段
 * （见 server/scripts/importQbank.ts 的 kv 匹配），入库时换行全被压掉了：
 * 听力题的原文动辄两千字，说话人切换只剩一个半角空格，渲染出来密不透风。
 * CSS 那侧的 `white-space: pre-wrap` 帮不上忙 —— 文本里根本没有 \n。
 *
 * 压平后残存的结构只有「短标记 + 冒号」一种形态：
 *
 *   男：…  女2：…  Ｍ：…  店員：…       说话人，听力原文
 *   質問1：…  問：…  3番：…             設問，冒号常常缺席，只用空格分隔
 *   参考译文：…  知识点：…  正确排序：…   分节小标题
 *   1.ざらざら：粗糙  ~ほど：表示…        逐条词义，笔试题解析的主要形态
 *
 * 前三类靠一条通用规则一并认出来，設問另补一条兜住不带冒号的写法。全库 2959 条
 * 解析里 684 条认不出任何标记，那些原样成段，交给 pre-wrap 自己折行。
 *
 * 认错的代价只是多一次断行，不会丢字 —— 原文都还在某个块里，只是标记被提到了
 * 左列。所以宁可漏认也不硬认：规则一律要求标记前面有空白。
 */

/** 说话人 / 設問 / 词条，标记进左列。 */
export type MarkBlock = { kind: 'mark'; label: string; text: string }

export type Block =
  /** 认不出标记的散段。 */
  | { kind: 'text'; text: string }
  /** 分节小标题，标题独占一行，正文另起。 */
  | { kind: 'section'; label: string; text: string }
  | MarkBlock

/** 这些标记是「下面开始讲另一件事」，不是对话人，所以竖着排而不是并成两列。 */
const SECTION =
  /^(解析|解答|分析|说明|注意|补充|補充|原文|原文翻译|原文翻譯|参考译文|参考譯文|译文|譯文|翻译|翻譯|知识点|知識点|语法|語法|正确排序|正确的排序|排序|题目|题目是)$/

/** 半角与全角空格：压平的换行留下的正是这两种，标记只在它们后面认。 */
const SP = '[ \\u3000]'

/**
 * 前有空白、自身不含空白、跟一个冒号。中日文句内的冒号前一般没有空格，
 * 所以「前有空白」这一条挡掉了绝大部分句内误伤。
 */
const MARK = new RegExp(`(?:^|${SP})([^\\s:：]{1,20})[:：]`, 'g')

/**
 * 設問的冒号经常缺席（`質問1 女の人は…`），补一条规则兜住。必须带数字才认，
 * 否则「問題」「问题」这种日常词会被当成标记切开。
 */
const QUESTION = new RegExp(
  `(?:^|${SP})((?:質問|問題|问题|設問|设问|問|问)${SP}?[0-9０-９一二三四五六七八九]{1,2}` +
    `|[0-9０-９]{1,2}番)(?=${SP}|[:：])`,
  'g',
)

/**
 * 逐条列举的选项：`3.没有想到那些有社会经验的人会对美术史抱有浓厚的兴趣：符合文意`。
 * 这是笔试题解析的主力形态，条目常常长过 MARK 的 20 字上限，所以单开一条放宽到 40。
 * 放得开是因为「序号打头」这个前提已经足够严 —— 句子内部不会这么起头。
 */
const LISTED = new RegExp(`(?:^|${SP})([0-9０-９]{1,2}[.．、][^\\s:：]{1,40})[:：]`, 'g')

/** 一处切口：at 是标记起点，len 是标记连同冒号占的长度。 */
type Cut = { at: number; label: string; len: number }

function cutsOf(text: string): Cut[] {
  const found: Cut[] = []

  for (const re of [MARK, LISTED]) {
    for (const m of text.matchAll(re)) {
      const label = m[1]
      const at = m.index + m[0].length - label.length - 1
      // `10：00-18：00`、`（1）8：00` 这类时间不是标记。数字结尾且冒号后还是数字就放过。
      if (/\d$/.test(label) && /^\d/.test(text.slice(at + label.length + 1))) continue
      found.push({ at, label, len: label.length + 1 })
    }
  }

  for (const m of text.matchAll(QUESTION)) {
    const label = m[1]
    const at = m.index + m[0].length - label.length
    const hasColon = /^[:：]/.test(text.slice(at + label.length))
    found.push({ at, label, len: label.length + (hasColon ? 1 : 0) })
  }

  // 两条规则会在同一处重复命中（`質問1：`），也会互相嵌套（`问题 1：` 里通用规则
  // 命中的是 `1：`，落在設問规则的命中范围内）。按起点排、长的优先，
  // 后来者落进前一个标记里就丢掉。
  found.sort((a, b) => a.at - b.at || b.len - a.len)
  const cuts: Cut[] = []
  for (const c of found) {
    const prev = cuts[cuts.length - 1]
    if (prev && c.at < prev.at + prev.len) continue
    cuts.push(c)
  }
  return cuts
}

export function parseExplain(text: string): Block[] {
  const src = text.trim()
  if (!src) return []

  const cuts = cutsOf(src)
  const blocks: Block[] = []
  const pushText = (raw: string) => {
    const t = raw.trim()
    if (t) blocks.push({ kind: 'text', text: t })
  }

  let last = 0
  cuts.forEach((c, i) => {
    pushText(src.slice(last, c.at))
    const end = cuts[i + 1]?.at ?? src.length
    // markdown 转义的残留：源文件里写作 `男\1.`。
    const label = c.label.replace(/\\/g, '').trim()
    blocks.push({
      kind: SECTION.test(label) ? 'section' : 'mark',
      label,
      text: src.slice(c.at + c.len, end).trim(),
    })
    last = end
  })
  pushText(src.slice(last))

  return blocks
}

/** 相邻的 mark 并成一组，同一组共用一个网格，左列才会对齐。 */
export type Group = { kind: 'marks'; items: MarkBlock[] } | { kind: 'block'; block: Block }

export function groupBlocks(blocks: Block[]): Group[] {
  const groups: Group[] = []
  for (const b of blocks) {
    const tail = groups[groups.length - 1]
    if (b.kind === 'mark' && tail?.kind === 'marks') tail.items.push(b)
    else if (b.kind === 'mark') groups.push({ kind: 'marks', items: [b] })
    else groups.push({ kind: 'block', block: b })
  }
  return groups
}
