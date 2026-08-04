/**
 * 音频预处理：读时长，以及在必要时转码。
 *
 * 两种情况要转：
 *   1. 容器和扩展名对不上 —— n1-qbank 里存在名为 .mp3、内容其实是 WAV 的文件
 *      （2020.12/聴解4-9 就是，12.2 MB / 33 秒）。OpenAI 按扩展名判定格式，
 *      喂进去直接回 400 "Audio file might be corrupted or unsupported"。
 *   2. 超过 25 MB 的上限。
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { stat } from 'node:fs/promises'
import { join, basename, extname } from 'node:path'

const run = promisify(execFile)

/** 读音频时长（秒）。ffprobe 不可用或读失败时返回 null，由调用方回退。 */
export async function probeDuration(path: string): Promise<number | null> {
  const value = await probeField(path, 'format=duration')
  const duration = Number.parseFloat(value ?? '')
  return Number.isFinite(duration) ? duration : null
}

async function probeField(path: string, entries: string): Promise<string | null> {
  try {
    const { stdout } = await run('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      entries,
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      path,
    ])
    return stdout.trim()
  } catch {
    return null
  }
}

/**
 * 扩展名声称的格式和实际容器是否一致。
 *
 * ffprobe 的 format_name 可能是逗号分隔的一组别名（如 `mov,mp4,m4a,3gp,3g2,mj2`），
 * 所以按集合判断而不是全等。探测失败时返回 false —— 宁可原样上传让 API 去报错，
 * 也好过因为环境里没有 ffprobe 就把每个文件都转一遍。
 */
async function isContainerMismatched(path: string): Promise<boolean> {
  const formatName = await probeField(path, 'format=format_name')
  if (!formatName) return false

  const actual = new Set(formatName.split(',').map((name) => name.trim().toLowerCase()))
  const claimed = extname(path).slice(1).toLowerCase()
  if (!claimed) return false

  // mp3 的容器名就是 mp3；m4a 走 mov/mp4 那一族。
  if (claimed === 'm4a' || claimed === 'mp4') return !actual.has('mov') && !actual.has('mp4')
  return !actual.has(claimed)
}

/**
 * 把音频等分成若干段写进临时目录，用于绕开 whisper 的重复循环幻觉。
 *
 * whisper 偶尔会卡在某一句上反复输出，把后面的内容全丢掉。这种卡死跟具体的
 * 音频位置绑定，且 temperature=0 下完全确定性 —— 重试多少次都是同一份烂输出。
 * 但把音频切开、每段单独送进去，卡死点就不成立了（实测那条 119 秒的音频
 * 整条转只出 125 字，切 3 段后出 561 字，与 gpt 版的 529 字吻合）。
 *
 * 刻意不做重叠切分：边界上丢一两个字会被 LCS 对齐的插值兜住，
 * 而重叠带来的重复词反倒要额外去重。
 */
export async function splitAudio(
  path: string,
  parts: number,
  duration: number,
  tempDir: string,
): Promise<Array<{ path: string; offset: number }>> {
  const chunk = duration / parts
  const chunks: Array<{ path: string; offset: number }> = []

  for (let index = 0; index < parts; index++) {
    const offset = chunk * index
    const target = join(tempDir, `${basename(path, extname(path))}.part${index}.mp3`)

    await run('ffmpeg', [
      '-y',
      '-loglevel',
      'error',
      '-ss',
      String(offset),
      '-t',
      String(chunk),
      '-i',
      path,
      '-ac',
      '1',
      '-b:a',
      '128k',
      target,
    ])

    chunks.push({ path: target, offset })
  }

  return chunks
}

/**
 * 把文件整成可以直接上传的样子，必要时转码到临时目录。
 *
 * 语音识别不吃立体声和高码率，降下来对准确率基本无影响。
 *
 * @returns 实际该上传的文件路径，以及它是否是新生成的临时文件
 */
export async function prepareAudio(
  path: string,
  maxMB: number,
  tempDir: string,
): Promise<{ path: string; isTemp: boolean; reason?: string }> {
  const { size } = await stat(path)
  const tooBig = size > maxMB * 1024 * 1024
  const mismatched = await isContainerMismatched(path)

  if (!tooBig && !mismatched) return { path, isTemp: false }

  // 只是格式不符的文件通常不大，留高一点的码率；超限的才压到 64k。
  const bitrate = tooBig ? '64k' : '128k'
  const target = join(tempDir, `${basename(path, extname(path))}.prepared.mp3`)

  await run('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-i',
    path,
    '-ac',
    '1',
    '-b:a',
    bitrate,
    target,
  ])

  const converted = await stat(target)
  if (converted.size > maxMB * 1024 * 1024) {
    throw new Error(
      `${basename(path)} 转码后仍有 ${(converted.size / 1024 / 1024).toFixed(1)} MB，` +
        `超过 ${maxMB} MB 上限，需要先切分。`,
    )
  }

  return {
    path: target,
    isTemp: true,
    reason: mismatched ? '容器与扩展名不符' : '超过大小上限',
  }
}
