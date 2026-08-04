/**
 * 入口：扫描 n1-qbank/audio，逐条转成 Hyperaudio Lite 的词级 hypertranscript。
 *
 * 每条音频走一遍 gpt-transcribe（文本）+ whisper-1（时间轴）→ LCS 对齐 →
 * kuromoji 形态素切分 → 输出 json / html。已有结果默认跳过，可断点续跑。
 *
 * 用法见 README.md，先试跑：npm start -- --exam 2025.07 --limit 3 --preview
 */

import OpenAI from 'openai'
import { mkdir, readdir, readFile, writeFile, rm, access } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { loadConfig, resolvePath, type Config } from './config.ts'
import { probeDuration, prepareAudio, splitAudio } from './audio.ts'
import { transcribeText, transcribeTimings, transcribeTimingsChunked } from './transcribe.ts'
import { alignTimings, expandWordsToChars } from './align.ts'
import { normalize } from './normalize.ts'
import { getTokenizer, tokenizeWithTimings } from './tokenize.ts'
import { renderHypertranscript, renderPreview, type TranscriptResult } from './render.ts'

const REPO_ROOT = resolve(resolvePath('.'), '..')

type Job = {
  exam: string
  question: string
  audioPath: string
}

type Options = {
  configPath?: string
  exams: string[]
  limit?: number
  force: boolean
  dryRun: boolean
  renderOnly: boolean
  /** 只重跑已有输出里命中率低于此值的条目 */
  redoBelow?: number
  concurrency?: number
  preview: boolean
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    exams: [],
    force: false,
    dryRun: false,
    renderOnly: false,
    preview: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case '--config':
        options.configPath = argv[++i]
        break
      case '--exam':
        options.exams.push(argv[++i])
        break
      case '--limit':
        options.limit = Number.parseInt(argv[++i], 10)
        break
      case '--concurrency':
        options.concurrency = Number.parseInt(argv[++i], 10)
        break
      case '--force':
        options.force = true
        break
      case '--dry-run':
        options.dryRun = true
        break
      case '--render-only':
        options.renderOnly = true
        break
      case '--redo-below':
        options.redoBelow = Number.parseFloat(argv[++i])
        break
      case '--preview':
        options.preview = true
        break
      case '--help':
      case '-h':
        printHelp()
        process.exit(0)
        break
      default:
        if (arg.startsWith('--')) {
          console.error(`未知参数：${arg}\n`)
          printHelp()
          process.exit(1)
        }
    }
  }

  return options
}

function printHelp(): void {
  console.log(`
把 n1-qbank 的听力音频转成 Hyperaudio Lite 词级 hypertranscript。

用法
  npm start -- [选项]

选项
  --config <path>      指定配置文件，默认 ./config.json
  --exam <name>        只处理该考期，可重复，如 --exam 2025.07 --exam 2025.12
  --limit <n>          最多处理 n 条，用于试跑
  --concurrency <n>    并发数，覆盖配置文件
  --force              忽略已有输出，全部重跑
  --dry-run            只列出待处理文件和预估成本，不调 API
  --render-only        拿已有的 json 重新渲染 html/预览页，不调 API
  --redo-below <rate>  只重跑已有输出里命中率低于该值的条目，如 --redo-below 0.6
  --preview            额外生成带播放器的独立预览页
  -h, --help           显示本帮助

示例
  npm start -- --dry-run
  npm start -- --exam 2025.07 --limit 3 --preview
  npm start -- --exam 2025.07
  npm start -- --render-only --preview      # 改完样式重出页面，不花钱
  npm start -- --redo-below 0.6 --preview   # 只补对齐崩掉的那些
`)
}

/** 扫描音频目录，按配置的 include/exclude 过滤出待处理任务。 */
async function collectJobs(config: Config, options: Options): Promise<Job[]> {
  const audioDir = resolvePath(config.input.audioDir)
  const include = new RegExp(config.input.includePattern)
  const exclude = new RegExp(config.input.excludePattern)

  const wanted = options.exams.length > 0 ? options.exams : config.input.exams
  const entries = await readdir(audioDir, { withFileTypes: true })
  const jobs: Job[] = []

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue
    if (wanted.length > 0 && !wanted.includes(entry.name)) continue

    const files = await readdir(join(audioDir, entry.name))
    for (const file of files.sort((a, b) => a.localeCompare(b, 'ja', { numeric: true }))) {
      if (!file.endsWith('.mp3')) continue

      const question = file.slice(0, -4)
      if (exclude.test(question)) continue
      if (!include.test(question)) continue

      jobs.push({ exam: entry.name, question, audioPath: join(audioDir, entry.name, file) })
    }
  }

  return jobs
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** 跑完一条音频的全流程。 */
async function processJob(
  job: Job,
  client: OpenAI,
  config: Config,
  options: Options,
  tempDir: string,
): Promise<TranscriptResult> {
  const prepared = await prepareAudio(job.audioPath, config.run.maxFileMB, tempDir)
  if (prepared.reason) {
    console.log(`  ↻ ${job.exam}/${job.question} 先转码：${prepared.reason}`)
  }

  try {
    // 两个模型互不依赖，并发发出去，省掉一半等待。
    const [text, timing, probedDuration] = await Promise.all([
      transcribeText(client, prepared.path, config),
      transcribeTimings(client, prepared.path, config),
      probeDuration(job.audioPath),
    ])

    if (!text) throw new Error('gpt-transcribe 返回了空文本')

    const duration = probedDuration ?? timing.duration ?? 0
    const gptChars = normalize(text)
    let aligned = alignTimings(gptChars, expandWordsToChars(timing.words), duration)
    let rescue: TranscriptResult['rescue']

    // 命中率过低基本只有一个原因：whisper 卡进了重复循环，整段时间轴作废。
    // 切开重转能绕过卡死点，代价是那一条多花几次 whisper 调用。
    if (aligned.matchRate < config.run.rescueBelow && duration > 0) {
      const parts = config.run.rescueChunks
      console.log(
        `  ↻ ${job.exam}/${job.question} 命中率仅 ${(aligned.matchRate * 100).toFixed(0)}%，切 ${parts} 段重取时间轴`,
      )

      const chunks = await splitAudio(prepared.path, parts, duration, tempDir)
      try {
        const words = await transcribeTimingsChunked(client, chunks, config)
        const retried = alignTimings(gptChars, expandWordsToChars(words), duration)

        // 只在确实变好时采纳，避免救援反而把好结果替换掉。
        if (retried.matchRate > aligned.matchRate) {
          rescue = { chunks: parts, before: aligned.matchRate, after: retried.matchRate }
          aligned = retried
        }
      } finally {
        await Promise.all(chunks.map((chunk) => rm(chunk.path, { force: true })))
      }
    }

    const tokens = await tokenizeWithTimings(text, gptChars, aligned.spans)

    return {
      exam: job.exam,
      question: job.question,
      audioPath: relative(REPO_ROOT, job.audioPath),
      mediaSrc: `${config.output.mediaSrcPrefix.replace(/\/$/, '')}/${job.exam}/${job.question}.mp3`,
      duration,
      text,
      models: { text: config.openai.textModel, timing: config.openai.timingModel },
      matchRate: aligned.matchRate,
      rescue,
      tokens,
    }
  } finally {
    if (prepared.isTemp) await rm(prepared.path, { force: true })
  }
}

/** 写出该条的所有产物。 */
async function writeOutputs(
  result: TranscriptResult,
  config: Config,
  options: Options,
): Promise<void> {
  const dir = join(resolvePath(config.output.dir), result.exam)
  await mkdir(dir, { recursive: true })

  if (config.output.writeJson) {
    await writeFile(join(dir, `${result.question}.json`), `${JSON.stringify(result, null, 2)}\n`)
  }
  if (config.output.writeHtml) {
    await writeFile(join(dir, `${result.question}.html`), renderHypertranscript(result))
  }
  if (config.output.writePreview || options.preview) {
    // 预览页放在 output/<考期>/ 下，音频回指 n1-qbank 的原始文件。
    const relativeAudio = relative(dir, resolve(REPO_ROOT, result.audioPath))
    await writeFile(
      join(dir, `${result.question}.preview.html`),
      renderPreview(result, relativeAudio),
    )
  }
}

/**
 * 拿已有的 json 重新渲染 html / 预览页。
 *
 * 转写结果是花钱买来的，调样式、改模板不该再付一次费 —— 这条路径完全不碰 API。
 */
async function renderFromExisting(config: Config, options: Options): Promise<void> {
  const outputDir = resolvePath(config.output.dir)
  const wanted = options.exams.length > 0 ? options.exams : config.input.exams

  let entries: Dirent[]
  try {
    entries = await readdir(outputDir, { withFileTypes: true })
  } catch {
    console.log(`输出目录还不存在：${outputDir}`)
    return
  }

  let count = 0
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue
    if (wanted.length > 0 && !wanted.includes(entry.name)) continue

    const files = await readdir(join(outputDir, entry.name))
    for (const file of files.sort((a, b) => a.localeCompare(b, 'ja', { numeric: true }))) {
      if (!file.endsWith('.json')) continue
      if (options.limit !== undefined && count >= options.limit) break

      const raw = await readFile(join(outputDir, entry.name, file), 'utf8')
      const result = JSON.parse(raw) as TranscriptResult
      await writeOutputs(result, config, options)
      count++
    }
  }

  console.log(`重新渲染 ${count} 条`)
  console.log(`输出目录 ${outputDir}`)
}

/** 固定并发数的任务池。 */
async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      await worker(items[index], index)
    }
  })

  await Promise.all(runners)
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const offline = options.dryRun || options.renderOnly
  const config = loadConfig(options.configPath, { requireApiKey: !offline })
  const concurrency = options.concurrency ?? config.run.concurrency

  if (options.renderOnly) {
    await renderFromExisting(config, options)
    return
  }

  const allJobs = await collectJobs(config, options)
  const outputDir = resolvePath(config.output.dir)

  let jobs = allJobs
  if (options.redoBelow !== undefined) {
    // 定向重跑：挑出已有输出里对齐崩掉的，其余一律不动。
    const targets: Job[] = []
    for (const job of allJobs) {
      const file = join(outputDir, job.exam, `${job.question}.json`)
      if (!(await exists(file))) continue

      const previous = JSON.parse(await readFile(file, 'utf8')) as TranscriptResult
      if (previous.matchRate < options.redoBelow) targets.push(job)
    }
    jobs = targets
    console.log(
      `扫描到 ${allJobs.length} 条，其中 ${jobs.length} 条命中率低于 ` +
        `${(options.redoBelow * 100).toFixed(0)}%，本次重跑这些`,
    )
  } else {
    // 断点续传：已有 json 就认为这条跑过了。
    if (config.run.skipExisting && !options.force) {
      const pending: Job[] = []
      for (const job of allJobs) {
        const done = await exists(join(outputDir, job.exam, `${job.question}.json`))
        if (!done) pending.push(job)
      }
      jobs = pending
    }
    console.log(`扫描到 ${allJobs.length} 条待转音频，本次处理 ${jobs.length} 条`)
    if (allJobs.length > jobs.length && !options.limit) {
      console.log(`（已跳过 ${allJobs.length - jobs.length} 条已有输出，--force 可强制重跑）`)
    }
  }

  if (options.limit !== undefined) jobs = jobs.slice(0, options.limit)

  if (options.dryRun) {
    let seconds = 0
    for (const job of jobs) seconds += (await probeDuration(job.audioPath)) ?? 0

    const minutes = seconds / 60
    // gpt-transcribe $0.0045/min + whisper-1 $0.006/min
    console.log(`\n总时长 ${(minutes / 60).toFixed(1)} 小时`)
    console.log(`预估成本 $${(minutes * 0.0045 + minutes * 0.006).toFixed(2)}`)
    console.log(`  ${config.openai.textModel}  $${(minutes * 0.0045).toFixed(2)}`)
    console.log(`  ${config.openai.timingModel}  $${(minutes * 0.006).toFixed(2)}`)
    console.log('\n前 10 条：')
    for (const job of jobs.slice(0, 10)) console.log(`  ${job.exam}/${job.question}.mp3`)
    return
  }

  if (jobs.length === 0) {
    console.log('没有需要处理的音频。')
    return
  }

  const client = new OpenAI({
    apiKey: config.openai.apiKey,
    baseURL: config.openai.baseURL,
    timeout: config.openai.timeoutMs,
  })

  const tempDir = join(tmpdir(), 'hypertranscript')
  await mkdir(tempDir, { recursive: true })

  // 提前把 IPADIC 载好，避免并发首帧同时触发加载。
  process.stdout.write('加载 kuromoji 词典… ')
  await getTokenizer()
  console.log('完成\n')

  const failures: Array<{ job: Job; error: string }> = []
  const lowQuality: Array<{ job: Job; matchRate: number }> = []
  let completed = 0

  const startedAt = Date.now()

  await runPool(jobs, concurrency, async (job) => {
    const label = `${job.exam}/${job.question}`
    try {
      const result = await processJob(job, client, config, options, tempDir)
      await writeOutputs(result, config, options)

      completed++
      if (result.matchRate < config.run.matchRateWarn) {
        lowQuality.push({ job, matchRate: result.matchRate })
      }

      const rate = (result.matchRate * 100).toFixed(0)
      console.log(
        `[${completed}/${jobs.length}] ${label}  ${result.tokens.length} 词  命中率 ${rate}%`,
      )
    } catch (error) {
      failures.push({ job, error: (error as Error).message })
      console.error(`[!] ${label}  失败：${(error as Error).message}`)
    }
  })

  const elapsed = ((Date.now() - startedAt) / 1000 / 60).toFixed(1)
  console.log(`\n完成 ${completed}/${jobs.length}，耗时 ${elapsed} 分钟`)
  console.log(`输出目录 ${outputDir}`)

  if (lowQuality.length > 0) {
    console.log(
      `\n⚠️  ${lowQuality.length} 条对齐命中率低于 ${(config.run.matchRateWarn * 100).toFixed(0)}%，` +
        '建议抽查预览页：',
    )
    for (const item of lowQuality.slice(0, 20)) {
      console.log(`  ${item.job.exam}/${item.job.question}  ${(item.matchRate * 100).toFixed(0)}%`)
    }
  }

  if (failures.length > 0) {
    console.log(`\n❌ ${failures.length} 条失败，重跑本命令会自动只补这些：`)
    for (const item of failures) console.log(`  ${item.job.exam}/${item.job.question}  ${item.error}`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(`\n${(error as Error).message}`)
  process.exit(1)
})
