/**
 * 词库 JSONL 的读写 —— 落盘一律 gzip。
 *
 * 起因是 Git LFS：未压缩的 ja-zh.jsonl 有 164.8 MB，走 LFS 托管会撞 GitHub 的
 * 免费配额（1 GB 存储 + 1 GB 月带宽，且按账号跨仓库共享）。gzip 后 34.5 MB、
 * zh-ja 8.4 MB，当普通 git blob 提交即可，既不用 LFS 也不用分片，离 GitHub
 * 50 MB 的警告线还有一半余量。
 *
 * 没选 zstd（Node 22.15+ 内置，同数据能再小 31%）：省下的十几 MB 不值得把
 * 工具链钉死在特定 Node 版本，而 .gz 谁都能 `gzip -dc x.jsonl.gz | head` 直接看，
 * 对这种「唯一记录」性质的数据文件，可读性比体积重要。
 */
import { createReadStream, createWriteStream, existsSync, renameSync } from 'node:fs'
import { createGunzip, createGzip } from 'node:zlib'
import { createInterface, type Interface } from 'node:readline'
import { once } from 'node:events'
import { pipeline } from 'node:stream/promises'
import { join } from 'node:path'

/** 落盘文件名。写永远写压缩版，读见 resolveDictFile。 */
export function dictFileFor(dir: string, direction: string): string {
  return join(dir, `${direction}.jsonl.gz`)
}

/**
 * 在 dir 下找某个方向的词库，优先压缩版。
 *
 * 回落到未压缩的 .jsonl 是给 mergeDict 的 `--input-dir` 用的 —— 那是外部词典
 * 转换出来的输入，不归本仓库管，压不压缩都得能读。
 */
export function resolveDictFile(dir: string, direction: string): string {
  const gz = dictFileFor(dir, direction)
  if (existsSync(gz)) return gz
  const plain = join(dir, `${direction}.jsonl`)
  if (existsSync(plain)) return plain
  throw new Error(`找不到 ${direction} 的词库：${gz} 和 ${plain} 都不存在`)
}

/** 逐行读，压缩与否按扩展名判断。 */
export function readDictLines(file: string): Interface {
  const raw = createReadStream(file)
  const input = file.endsWith('.gz') ? raw.pipe(createGunzip()) : raw
  return createInterface({ input, crlfDelay: Infinity })
}

/**
 * gzip 写入器。先写 `<file>.tmp` 再 rename，中途崩了不会留下半个文件覆盖旧数据
 * —— 这份数据是外部词典合并的结果，build:dict 重跑不出来，损坏了只能从 git 找回。
 */
export function openDictWriter(file: string) {
  const tmp = `${file}.tmp`
  const gzip = createGzip({ level: 9 })
  const done = pipeline(gzip, createWriteStream(tmp))
  return {
    async write(line: string): Promise<void> {
      if (!gzip.write(line)) await once(gzip, 'drain')
    },
    async close(): Promise<void> {
      gzip.end()
      await done
      renameSync(tmp, file)
    },
  }
}
