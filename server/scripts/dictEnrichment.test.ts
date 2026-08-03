import assert from 'node:assert/strict'
import test from 'node:test'
import {
  enrichZhWiktionarySenses,
  getJapaneseTokenizer,
  inferJapaneseReading,
  splitPosPrefix,
} from './dictEnrichment'

test('extracts only anchored POS labels', () => {
  assert.deepEqual(splitPosPrefix('名?他サ 爱护。'), { pos: '名·他サ', rest: '爱护。' })
  assert.deepEqual(splitPosPrefix('名·形动'), { pos: '名·形动', rest: '' })
  assert.deepEqual(splitPosPrefix('他下一 托付保管。'), { pos: '他下一', rest: '托付保管。' })
  assert.deepEqual(splitPosPrefix('?自サ 参半。'), { pos: '自サ', rest: '参半。' })
  assert.deepEqual(splitPosPrefix('[名] 物品。'), { pos: '名', rest: '物品。' })
  assert.equal(splitPosPrefix('副极带气候。'), null)
  assert.equal(splitPosPrefix('形象学。'), null)
})

test('splits numbered senses, POS sections, and conservative example pairs', () => {
  const result = enrichZhWiktionarySenses('unknown', [{
    glosses: [
      '名',
      '1. (双方) 相对。',
      '相対ずく',
      '(不借助第三者)两人商量决定。',
      '2. 对等。',
      '名·自サ',
      '1. 二者相对。',
      '両軍が相対して陣をしいた',
      '两军相对布阵。',
      '2. 对立。',
    ],
  }], '相対')

  assert.equal(result.pos, '名 / 名·自サ')
  assert.deepEqual(result.senses, [
    {
      pos: '名',
      glosses: ['1. (双方) 相对。'],
      examples: [{ text: '相対ずく', translation: '(不借助第三者)两人商量决定。' }],
    },
    { pos: '名', glosses: ['2. 对等。'] },
    {
      pos: '名·自サ',
      glosses: ['1. 二者相对。'],
      examples: [{ text: '両軍が相対して陣をしいた', translation: '两军相对布阵。' }],
    },
    { pos: '名·自サ', glosses: ['2. 对立。'] },
  ])
})

test('keeps ambiguous unnumbered explanatory text as glosses', () => {
  const result = enrichZhWiktionarySenses('unknown', [{
    glosses: ['自五', '同「飽きる」，今多用于书面语和关西方言', '1. 满足，够。'],
  }])
  assert.deepEqual(result.senses, [{
    pos: '自五',
    glosses: ['同「飽きる」，今多用于书面语和关西方言', '1. 满足，够。'],
  }])
})

test('recognizes an all-kanji example when it contains the headword', () => {
  const result = enrichZhWiktionarySenses('unknown', [{
    glosses: ['名·他サ', '1. 精简。', '人員整理', '精简人员。'],
  }], '整理')
  assert.deepEqual(result.senses[0].examples, [
    { text: '人員整理', translation: '精简人员。' },
  ])
})

test('infers readings only for Japanese words known to IPADIC', async () => {
  const tokenizer = await getJapaneseTokenizer()
  assert.equal(inferJapaneseReading(tokenizer, '整理'), 'せいり')
  assert.equal(inferJapaneseReading(tokenizer, '食べ物'), 'たべもの')
  assert.equal(inferJapaneseReading(tokenizer, '哲'), '')
  assert.equal(inferJapaneseReading(tokenizer, '臭化ビスマス'), '')
  assert.equal(inferJapaneseReading(tokenizer, '氦之类'), '')
  assert.equal(inferJapaneseReading(tokenizer, '4WD'), '')
})
