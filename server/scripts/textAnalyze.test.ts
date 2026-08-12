import assert from 'node:assert/strict'
import test from 'node:test'
import { alignTokens, splitSentences } from '../src/services/textAnalyzeService'

/**
 * 文解析里两个不靠模型自觉的不变量：
 *
 *  1. 切出来的句子拼回去等于原文（换行和空行除外 —— 那是排版，不是内容）
 *  2. 一句里所有 token 拼回去逐字符等于这句原文
 *
 * 第 2 条是渲染的地基：解析结果框画的是 token，画出来的东西必须就是用户贴进
 * 去的那段文字。模型漏一个助词、吞一个标点都会破坏它，所以对齐在服务端做，
 * 这里盯着它。
 */

test('切句：句末标点断句，换行也断句', () => {
  assert.deepEqual(splitSentences('今日は寒い。明日は暖かい。'), [
    '今日は寒い。',
    '明日は暖かい。',
  ])
  assert.deepEqual(splitSentences('一行目\n二行目'), ['一行目', '二行目'])
  // 连续的句末标点收进同一句，不切成两半。
  assert.deepEqual(splitSentences('本当に!?すごい。'), ['本当に!?', 'すごい。'])
})

test('切句：引号和括号里的句号不断句', () => {
  assert.deepEqual(splitSentences('彼は「そうだ。」と言った。次へ。'), [
    '彼は「そうだ。」と言った。',
    '次へ。',
  ])
  // 括号内的句号同样不断句，于是「（…。）続く。」整体算一句。故意如此：
  // 「」和（）里的句号到底是不是句子结尾，字符层面判不出来（引用后面多半还跟着
  // と/って，切开就把一句话腰斩了）。少切一刀只是让这一句的译文长一点，切错
  // 则会让译文对不上原句 —— 错的方向选安全那一侧。
  assert.deepEqual(splitSentences('今日は寒い。（明日は暖かいらしい。）'), [
    '今日は寒い。',
    '（明日は暖かいらしい。）',
  ])
})

test('切句：没有句末标点的一行也是一句，空行丢掉', () => {
  assert.deepEqual(splitSentences('こんにちは'), ['こんにちは'])
  assert.deepEqual(splitSentences('一行目\n\n\n二行目'), ['一行目', '二行目'])
  assert.deepEqual(splitSentences('   \n  '), [])
})

test('对齐：正常情况原样通过，base 与词形相同时收敛成空串', () => {
  const tokens = alignTokens('本を読む。', [
    { w: '本', p: '名詞', k: 'ほん', b: '本' },
    { w: 'を', p: '助詞', k: '', b: '' },
    { w: '読む', p: '動詞', k: 'よむ', b: '読む' },
    { w: '。', p: '記号', k: '', b: '' },
  ])
  assert.equal(tokens.map((token) => token.word).join(''), '本を読む。')
  assert.equal(tokens[0].base, '')
  assert.equal(tokens[2].kana, 'よむ')
})

test('对齐：模型漏掉的原文补成无词性 token，编出来的词丢掉', () => {
  // 「を」被漏掉，「※」是原文里没有的
  const tokens = alignTokens('本を読む', [
    { w: '本', p: '名詞', k: 'ほん', b: '' },
    { w: '※', p: '記号', k: '', b: '' },
    { w: '読む', p: '動詞', k: 'よむ', b: '' },
  ])
  assert.equal(tokens.map((token) => token.word).join(''), '本を読む')
  assert.equal(tokens[1].word, 'を')
  assert.equal(tokens[1].pos, '')
})

test('对齐：句尾被截断时剩下的原文补回来', () => {
  const tokens = alignTokens('走った。', [{ w: '走っ', p: '動詞', k: 'はし', b: '走る' }])
  assert.equal(tokens.map((token) => token.word).join(''), '走った。')
})

test('对齐：空白缺口按标点处理，不当成词', () => {
  const tokens = alignTokens('AI と 人間', [
    { w: 'AI', p: '名詞', k: '', b: '' },
    { w: 'と', p: '助詞', k: '', b: '' },
    { w: '人間', p: '名詞', k: 'にんげん', b: '' },
  ])
  assert.equal(tokens.map((token) => token.word).join(''), 'AI と 人間')
  assert.equal(tokens[1].word, ' ')
  assert.equal(tokens[1].pos, '記号')
})
