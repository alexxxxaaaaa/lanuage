/**
 * 配置加载。config.json 缺省项由这里的默认值补齐，
 * apiKey 允许写成 "env:VAR_NAME" 从环境变量取，免得密钥落在磁盘上。
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** hypertranscript/ 目录本身，所有相对路径都以它为基准。 */
export const TOOL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export type Config = {
  openai: {
    apiKey: string
    baseURL?: string
    /** 出文本的模型，默认 gpt-transcribe */
    textModel: string
    /** 出词级时间戳的模型 —— 只有 whisper-1 支持 timestamp_granularities */
    timingModel: string
    language: string
    /** 给 textModel 的提示，引导术语和风格，对专有名词识别有帮助 */
    prompt?: string
    /**
     * 给 timingModel 的提示，默认不传 —— 一般也不该传。
     *
     * whisper-1 不是 LLM，prompt 对它只是「前文」，模型会顺着往下续写。
     * 碰上语音密度低的片段，它会退化成整段复读 prompt（实测传
     * 「日本語能力試験N1の聴解問題の音声です。」时，84/1042 条的输出变成
     * 「N1の聴解問題の音声」重复若干遍），时间轴直接报废。
     * 文本质量本来就由 textModel 负责，这里给空是更稳的选择。
     */
    timingPrompt?: string
    /** 单次请求超时（毫秒） */
    timeoutMs: number
  }
  input: {
    /** 音频根目录 */
    audioDir: string
    /** 文件名（不含扩展名）需匹配才处理 */
    includePattern: string
    /** 匹配则跳过，默认排除整卷音频 */
    excludePattern: string
    /** 只跑这些考期，空数组表示全部 */
    exams: string[]
  }
  output: {
    dir: string
    writeJson: boolean
    writeHtml: boolean
    writePreview: boolean
    /** 拼进 data-media-src 的前缀，对齐生产环境的音频 URL */
    mediaSrcPrefix: string
  }
  run: {
    concurrency: number
    maxRetries: number
    /** 已有输出则跳过，用 --force 覆盖 */
    skipExisting: boolean
    /** 超过此大小先转码降码率，OpenAI 上限是 25 MB */
    maxFileMB: number
    /** 命中率低于此值时在汇总里单独列出 */
    matchRateWarn: number
    /**
     * 命中率低于此值时触发分段救援 —— 切开音频重取时间轴。
     * 设 0 可以关掉救援。
     */
    rescueBelow: number
    /** 救援时把音频切成几段 */
    rescueChunks: number
  }
}

const DEFAULTS: Config = {
  openai: {
    apiKey: 'env:OPENAI_API_KEY',
    textModel: 'gpt-transcribe',
    timingModel: 'whisper-1',
    language: 'ja',
    timeoutMs: 180_000,
  },
  input: {
    audioDir: '../n1-qbank/audio',
    includePattern: '^聴解\\d+-\\d+$',
    excludePattern: '^(材料\\d+|full)$',
    exams: [],
  },
  output: {
    dir: './output',
    writeJson: true,
    writeHtml: true,
    writePreview: false,
    mediaSrcPrefix: '/exam-media',
  },
  run: {
    concurrency: 4,
    maxRetries: 4,
    skipExisting: true,
    maxFileMB: 24,
    matchRateWarn: 0.6,
    rescueBelow: 0.6,
    rescueChunks: 3,
  },
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 逐段浅合并，够用且行为好预测。 */
function merge(base: Config, override: Record<string, unknown>): Config {
  const result = { ...base }
  for (const key of Object.keys(base) as Array<keyof Config>) {
    const section = override[key]
    if (isPlainObject(section)) {
      result[key] = { ...base[key], ...section } as never
    }
  }
  return result
}

/** 解析 "env:VAR" 语法，其余原样返回。 */
function resolveSecret(value: string): string {
  if (!value.startsWith('env:')) return value
  return process.env[value.slice(4)] ?? ''
}

/** 把配置里的相对路径解析成绝对路径。 */
export function resolvePath(value: string): string {
  return isAbsolute(value) ? value : resolve(TOOL_ROOT, value)
}

export function loadConfig(configPath?: string, options?: { requireApiKey?: boolean }): Config {
  const file = configPath ? resolvePath(configPath) : resolve(TOOL_ROOT, 'config.json')

  if (!existsSync(file)) {
    // 不碰 API 的命令（export:r2、--render-only、--dry-run）拿默认值就能跑。
    // 换台机器只想导出/上传时，不该被逼着先 cp 一份配置。
    if (options?.requireApiKey === false) return structuredClone(DEFAULTS)

    throw new Error(
      `找不到配置文件 ${file}\n先复制一份模板：cp config.example.json config.json`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    throw new Error(`配置文件不是合法 JSON：${file}\n${(error as Error).message}`)
  }
  if (!isPlainObject(parsed)) throw new Error(`配置文件顶层必须是对象：${file}`)

  const config = merge(DEFAULTS, parsed)
  config.openai.apiKey = resolveSecret(config.openai.apiKey)

  // --dry-run 不发请求，没配 key 也该能跑通，所以校验是可选的。
  if (options?.requireApiKey !== false && !config.openai.apiKey) {
    throw new Error(
      '缺少 OpenAI API key。在 config.json 的 openai.apiKey 里直接填，' +
        '或保持 "env:OPENAI_API_KEY" 并设置同名环境变量。',
    )
  }

  // 词级时间戳只有 whisper-1 支持，配错了要等跑完一轮才发现，太亏。
  if (config.openai.timingModel !== 'whisper-1') {
    console.warn(
      `⚠️  timingModel 配成了 ${config.openai.timingModel}。` +
        'OpenAI 目前只有 whisper-1 支持 timestamp_granularities=["word"]，' +
        '其它模型会导致拿不到词级时间戳。',
    )
  }

  return config
}
