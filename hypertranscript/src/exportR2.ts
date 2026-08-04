/**
 * 把 output/ 的完整 json 压成前端要的精简格式，按 R2 对象名写进 dist-r2/。
 *
 * 完整 json 每条约 45 KB —— 里面的 reading / pos / 原文 / 对齐指标都是给
 * 后续入库和排查用的，播放器一个字节都用不上。精简后只剩 [文本, 起始, 时长]
 * 三元组，一条降到 10 KB 上下，gzip 后 3 KB 左右。
 *
 * 对象名跟着 audioKey 的规矩走 —— 去掉「聴解」保持纯 ASCII，省掉 URL 编码：
 *   output/2020.12/聴解1-1.json  →  dist-r2/transcript/2020.12/1-1.json
 *
 * 跑：npm run export:r2
 */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadConfig, resolvePath } from './config.ts'
import type { TranscriptResult } from './render.ts'

/** 一个词：[文本, 起始毫秒, 持续毫秒]。用元组而不是对象，省掉重复的键名。 */
type PackedToken = [string, number, number]

type PackedTranscript = {
  /** 秒 */
  duration: number
  tokens: PackedToken[]
  /** 每段起始的 token 下标，前端据此切 <p> */
  paragraphs: number[]
}

/** 一段最多放多少词 —— 与 render.ts 的分段口径保持一致。 */
const MAX_TOKENS_PER_PARAGRAPH = 60

function pack(result: TranscriptResult): PackedTranscript {
  const tokens: PackedToken[] = []
  const paragraphs: number[] = []
  let sinceBreak = 0

  result.tokens.forEach((token, index) => {
    if (sinceBreak === 0) paragraphs.push(index)
    tokens.push([token.text, token.m, token.d])
    sinceBreak++

    if (token.endsSentence || sinceBreak >= MAX_TOKENS_PER_PARAGRAPH) sinceBreak = 0
  })

  return { duration: Math.round(result.duration * 1000) / 1000, tokens, paragraphs }
}

/** 聴解1-1 → 1-1，与 server/scripts/importQbank.ts 的 audioKeyFor 一致。 */
function objectName(question: string): string {
  return question.replace(/^聴解(\d+)-(\d+)$/, '$1-$2')
}

async function main(): Promise<void> {
  const config = loadConfig(undefined, { requireApiKey: false })
  const outputDir = resolvePath(config.output.dir)
  const distDir = resolvePath('./dist-r2/transcript')

  const exams = await readdir(outputDir, { withFileTypes: true })
  let count = 0
  let bytes = 0

  for (const exam of exams.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!exam.isDirectory()) continue

    const targetDir = join(distDir, exam.name)
    await mkdir(targetDir, { recursive: true })

    for (const file of await readdir(join(outputDir, exam.name))) {
      if (!file.endsWith('.json')) continue

      const result = JSON.parse(
        await readFile(join(outputDir, exam.name, file), 'utf8'),
      ) as TranscriptResult
      const body = JSON.stringify(pack(result))

      await writeFile(join(targetDir, `${objectName(result.question)}.json`), body)
      count++
      bytes += Buffer.byteLength(body)
    }
  }

  console.log(`导出 ${count} 条 → ${distDir}`)
  console.log(`合计 ${(bytes / 1024 / 1024).toFixed(1)} MB，平均 ${(bytes / count / 1024).toFixed(1)} KB/条`)
  console.log(`\n上传到 R2：npm run upload:r2`)
}

main().catch((error) => {
  console.error(`\n${(error as Error).message}`)
  process.exit(1)
})
