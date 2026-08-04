/**
 * 全链路验证，不调 API。
 *
 * 手造一份「gpt 文本 + whisper 词轴」，刻意让两边字面不一致
 * （whisper 把「今日」听成假名、把「資料」漏成別字），检验对齐能不能
 * 靠周围锚点把差异段插回正确位置。
 *
 * 跑：npm test
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalize } from './normalize.ts'
import { alignTimings, expandWordsToChars, type WhisperWord } from './align.ts'
import { tokenizeWithTimings } from './tokenize.ts'
import { renderHypertranscript } from './render.ts'

const GPT_TEXT = '今日は会議の資料について説明します。よろしくお願いします。'

/** whisper 的版本：「今日」写成假名，「資料」错成「調料」，词边界也不同。 */
const WHISPER_WORDS: WhisperWord[] = [
  { word: 'きょう', start: 0.0, end: 0.4 },
  { word: 'は', start: 0.4, end: 0.55 },
  { word: '会議', start: 0.55, end: 1.0 },
  { word: 'の', start: 1.0, end: 1.1 },
  { word: '調料', start: 1.1, end: 1.6 },
  { word: 'について', start: 1.6, end: 2.1 },
  { word: '説明', start: 2.1, end: 2.6 },
  { word: 'します', start: 2.6, end: 3.0 },
  { word: 'よろしく', start: 3.2, end: 3.9 },
  { word: 'お願い', start: 3.9, end: 4.4 },
  { word: 'します', start: 4.4, end: 4.9 },
]

const DURATION = 5.0

test('normalize 折叠片假名与全角，丢标点但保留长音符', () => {
  const chars = normalize('コーヒー、Ａ！')
  assert.equal(chars.map((c) => c.ch).join(''), 'こーひーa')

  // 每个归一化字符都记得自己在原文的位置
  assert.deepEqual(
    chars.map((c) => c.origIndex),
    [0, 1, 2, 3, 5],
  )
})

test('字面有差异时仍能对齐，未命中段落靠插值兜底', () => {
  const gptChars = normalize(GPT_TEXT)
  const whisperChars = expandWordsToChars(WHISPER_WORDS)
  const { spans, matchRate } = alignTimings(gptChars, whisperChars, DURATION)

  assert.equal(spans.length, gptChars.length)
  // 「今日」「資料」共 4 字对不上，其余应全中
  assert.ok(matchRate > 0.8, `命中率过低：${matchRate}`)

  // 每个字符都有时间，且不越界
  for (const span of spans) {
    assert.ok(Number.isFinite(span.start) && Number.isFinite(span.end))
    assert.ok(span.start >= 0 && span.end <= DURATION + 0.01)
    assert.ok(span.end >= span.start)
  }

  // 「会議」是双方都对得上的锚点，时间应该落在 whisper 给的 0.55~1.0
  const kaigiIndex = GPT_TEXT.indexOf('会議')
  const kaigi = spans[gptChars.findIndex((c) => c.origIndex === kaigiIndex)]
  assert.ok(kaigi.start >= 0.5 && kaigi.start <= 0.6, `会議 起点偏了：${kaigi.start}`)

  // 「資料」对不上，但夹在「の」(→1.1) 和「について」(1.6→) 之间，应被插值进这个窗口
  const shiryoIndex = GPT_TEXT.indexOf('資料')
  const shiryo = spans[gptChars.findIndex((c) => c.origIndex === shiryoIndex)]
  assert.ok(
    shiryo.start >= 1.0 && shiryo.start <= 1.7,
    `資料 没被插值到正确窗口：${shiryo.start}`,
  )
})

test('kuromoji 按形态素切分，时间单调不减', async () => {
  const gptChars = normalize(GPT_TEXT)
  const whisperChars = expandWordsToChars(WHISPER_WORDS)
  const { spans } = alignTimings(gptChars, whisperChars, DURATION)
  const tokens = await tokenizeWithTimings(GPT_TEXT, gptChars, spans)

  assert.ok(tokens.length > 0)

  // 切分粒度是词法级而非整句
  const surfaces = tokens.map((t) => t.surface)
  assert.ok(surfaces.includes('今日'), `没切出「今日」：${surfaces.join('/')}`)
  assert.ok(surfaces.includes('会議'), `没切出「会議」：${surfaces.join('/')}`)
  assert.ok(surfaces.includes('は'), `没切出助词「は」：${surfaces.join('/')}`)

  // 顺带拿到读音和词性
  const kyou = tokens.find((t) => t.surface === '今日')
  assert.equal(kyou?.reading, 'キョウ')
  assert.equal(kyou?.pos, '名詞')

  // Hyperaudio Lite 按顺序推进高亮，时间倒退会让高亮卡住
  let floor = -1
  for (const token of tokens) {
    assert.ok(token.m >= floor, `时间回退：${token.surface} m=${token.m} < ${floor}`)
    assert.ok(token.d >= 0)
    floor = token.m
  }

  // 标点不单独成 span，而是吸附到前一个词，拼起来要还原成原文
  assert.equal(tokens.map((t) => t.text).join(''), GPT_TEXT)

  // 句末标点被识别出来，供 render 分段
  assert.equal(tokens.filter((t) => t.endsSentence).length, 2)
})

test('渲染出 Hyperaudio Lite 认的结构', async () => {
  const gptChars = normalize(GPT_TEXT)
  const whisperChars = expandWordsToChars(WHISPER_WORDS)
  const { spans, matchRate } = alignTimings(gptChars, whisperChars, DURATION)
  const tokens = await tokenizeWithTimings(GPT_TEXT, gptChars, spans)

  const html = renderHypertranscript({
    exam: '2025.07',
    question: '聴解1-1',
    audioPath: 'n1-qbank/audio/2025.07/聴解1-1.mp3',
    mediaSrc: '/exam-media/2025.07/聴解1-1.mp3',
    duration: DURATION,
    text: GPT_TEXT,
    models: { text: 'gpt-transcribe', timing: 'whisper-1' },
    matchRate,
    tokens,
  })

  assert.match(html, /<article>/)
  assert.match(html, /<section data-media-src="\/exam-media\/2025\.07\/聴解1-1\.mp3">/)
  assert.match(html, /<span data-m="\d+" data-d="\d+">今日<\/span>/)

  // 两个句末标点 → 两段
  assert.equal(html.match(/<p>/g)?.length, 2)

  // span 文本拼起来仍是原文
  const spanTexts = [...html.matchAll(/<span data-m="\d+" data-d="\d+">([^<]*)<\/span>/g)]
    .map((m) => m[1])
    .join('')
  assert.equal(spanTexts, GPT_TEXT)
})

test('whisper 词轴缺失时退化成均分，不产生空值', () => {
  const gptChars = normalize(GPT_TEXT)
  const { spans, matchRate } = alignTimings(gptChars, [], DURATION)

  assert.equal(matchRate, 0)
  assert.equal(spans.length, gptChars.length)
  for (const span of spans) {
    assert.ok(Number.isFinite(span.start) && Number.isFinite(span.end))
  }
})
