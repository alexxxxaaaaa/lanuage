import assert from 'node:assert/strict'
import test from 'node:test'
import { deinflectJa } from '../src/lib/jaDeinflect'

/**
 * 规则表没有词性信息，一次输入会给出一串候选，真正的裁决在词库那边
 * （resolveJaHeadword 取第一个被本地词头表收录的）。所以这里断言的是
 * 「正确的辞書形出现在候选里」，顺带盯住它别掉到列表末尾去。
 */
function assertResolves(surface: string, base: string, within = 12) {
  const candidates = deinflectJa(surface)
  const at = candidates.indexOf(base)
  assert.notEqual(at, -1, `${surface} → ${base} 没在候选里：${candidates.join('、')}`)
  assert.ok(at < within, `${surface} → ${base} 排到了第 ${at + 1} 位：${candidates.join('、')}`)
}

test('五段动词的各种活用', () => {
  assertResolves('書きます', '書く')
  assertResolves('書きました', '書く')
  assertResolves('書きませんでした', '書く')
  assertResolves('書いて', '書く')
  assertResolves('書いた', '書く')
  assertResolves('書かない', '書く')
  assertResolves('書かなかった', '書く')
  assertResolves('書かれる', '書く')
  assertResolves('書かせる', '書く')
  assertResolves('書ける', '書く')
  assertResolves('書けば', '書く')
  assertResolves('書こう', '書く')
  assertResolves('書きたい', '書く')
  assertResolves('書きたかった', '書く')
  assertResolves('泳いだ', '泳ぐ')
  assertResolves('話しました', '話す')
  assertResolves('待った', '待つ')
  assertResolves('死んだ', '死ぬ')
  assertResolves('遊んで', '遊ぶ')
  assertResolves('読んでいました', '読む')
  assertResolves('切った', '切る')
  assertResolves('言わなければ', '言う')
})

test('一段动词，含复合活用', () => {
  assertResolves('食べます', '食べる')
  assertResolves('食べました', '食べる')
  assertResolves('食べません', '食べる')
  assertResolves('食べて', '食べる')
  assertResolves('食べた', '食べる')
  assertResolves('食べない', '食べる')
  assertResolves('食べなかった', '食べる')
  assertResolves('食べたら', '食べる')
  assertResolves('食べている', '食べる')
  assertResolves('食べてる', '食べる')
  assertResolves('食べちゃった', '食べる')
  assertResolves('食べられる', '食べる')
  assertResolves('食べさせる', '食べる')
  assertResolves('食べさせられなかった', '食べる')
  assertResolves('食べれる', '食べる') // ら抜き
  assertResolves('教えてくれました', '教える')
})

test('サ変・カ変', () => {
  assertResolves('した', 'する')
  assertResolves('しました', 'する')
  assertResolves('勉強しました', '勉強する')
  assertResolves('勉強しなかった', '勉強する')
  assertResolves('されました', 'する')
  assertResolves('来ました', '来る')
  assertResolves('来なかった', '来る')
  assertResolves('きた', 'くる')
})

test('サ変复合词同时给出「〜する」和词干名词', () => {
  // 词库（Wiktextract）收「勉強」不收「勉強する」，两个落点都要有，
  // 且「〜する」排在前面：真收了 する 复合词的那些词条不该被名词抢走。
  for (const [surface, noun] of [
    ['勉強しました', '勉強'],
    ['説明しています', '説明'],
    ['注意しなければ', '注意'],
    ['確認したい', '確認'],
  ] as const) {
    const candidates = deinflectJa(surface)
    assert.ok(candidates.includes(noun), `${surface} 缺少词干候选「${noun}」`)
    assert.ok(
      candidates.indexOf(`${noun}する`) < candidates.indexOf(noun),
      `${surface}：「${noun}する」该排在「${noun}」前面`,
    )
  }
  // 同理，「引っ越させる」的落点是五段的「引っ越す」，不是切到词干的「引っ越」。
  const causative = deinflectJa('引っ越させる')
  assert.ok(
    causative.indexOf('引っ越す') < causative.indexOf('引っ越'),
    `引っ越させる：「引っ越す」该排在「引っ越」前面：${causative.join('、')}`,
  )
})

test('中间形态不作为候选交出去', () => {
  // 「喜んで」是词库收录的副词，可它在这里只是拆到一半的て形，停在它上面
  // 等于把答案给错了。ます形、た形同理。
  assert.ok(!deinflectJa('喜んでいる').includes('喜んで'))
  assert.ok(!deinflectJa('食べました').includes('食べます'))
  assert.ok(!deinflectJa('終わったら').includes('終わった'))
  assertResolves('喜んでいる', '喜ぶ')
  assertResolves('座ってください', '座る')
  assertResolves('覚えておく', '覚える')
})

test('形容词与名词＋だ', () => {
  assertResolves('寒かった', '寒い')
  assertResolves('寒くない', '寒い')
  assertResolves('寒くなかった', '寒い')
  assertResolves('寒くて', '寒い')
  assertResolves('寒ければ', '寒い')
  assertResolves('忙しくありません', '忙しい')
  assertResolves('よかった', 'よい')
  assertResolves('静かだった', '静か')
  assertResolves('静かに', '静か')
  assertResolves('静かじゃない', '静か')
  assertResolves('学生でした', '学生')
})

test('拆不动的输入不产生候选，也就不必去查词库', () => {
  for (const word of ['勉強', 'コーヒー', '見る', 'する', '', 'あ']) {
    assert.deepEqual(deinflectJa(word), [], `「${word}」不该有候选`)
  }
  // 反过来，「食べる」会被当成「食ぶ」的可能形而给出候选 —— 规则表没有词性，
  // 这种误判拦不住也不必拦：resolveJaHeadword 先查精确词头，输入自己是词头时
  // 一律原样返回，候选根本轮不到。
  assert.deepEqual(deinflectJa('食べる'), ['食ぶ'])
})

test('候选不会短到没法当词头', () => {
  for (const surface of ['した', 'きた', 'ない', 'そう', 'って', 'たら']) {
    for (const candidate of deinflectJa(surface)) {
      assert.ok(candidate.length >= 2, `${surface} 给出了过短的候选「${candidate}」`)
    }
  }
})
