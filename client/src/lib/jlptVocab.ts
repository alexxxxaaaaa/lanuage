/**
 * JLPT 词汇级别表。
 *
 * 数据由 server/scripts/buildJlptVocab.ts 从两份词表合成静态文件
 * client/public/dict/jlpt.tsv（每行 `词形 \t 级别数字串`，`#` 开头是署名），
 * 随前端一起发布。8.8 千行 / 95 KB，一个会话下载解析一次就够，缓存放模块级：
 * 右侧索引栏、查词结果、词单卡片三处共用同一份。
 *
 * 只按词形匹配，不看读音 —— 三处的读音口径本来就不一致（索引里片假名词的读音
 * 是平假名，用户自己填的读音还可能是空的），拿它当键只会漏标。代价是同形不同
 * 读音的词会把几个读音的级别都收进来（東 = ひがし N5 / あずま N1），和两份
 * 词表判得不一样的情况一样，都并排展示，不替谁挑一个。
 */
import { useCallback, useEffect, useState } from 'react'

export type JlptLevel = 'N1' | 'N2' | 'N3' | 'N4' | 'N5'

type JlptTable = Map<string, readonly JlptLevel[]>

const EMPTY: readonly JlptLevel[] = []

let table: JlptTable | null = null
let inflight: Promise<JlptTable> | null = null

function parse(text: string): JlptTable {
  // 级别组合只有十几种，同一串数字复用同一个数组：省下八千个小数组，
  // 引用也稳定，消费方可以直接按引用 memo。
  const interned = new Map<string, readonly JlptLevel[]>()
  const parsed: JlptTable = new Map()
  for (const line of text.split('\n')) {
    const tab = line.indexOf('\t')
    if (tab === -1) continue
    const digits = line.slice(tab + 1)
    let levels = interned.get(digits)
    if (!levels) {
      levels = [...digits].map((digit) => `N${digit}` as JlptLevel)
      interned.set(digits, levels)
    }
    parsed.set(line.slice(0, tab), levels)
  }
  return parsed
}

function loadTable(): Promise<JlptTable> {
  // 拿不到就当所有词都没有级别 —— 一张辅助标签表不该拖垮任何一个页面。
  inflight ??= fetch('/dict/jlpt.tsv')
    .then((response) => (response.ok ? response.text() : Promise.reject(response.status)))
    .then(parse)
    .catch(() => new Map() as JlptTable)
    .then((loaded) => (table = loaded))
  return inflight
}

/**
 * 取一个「词形 → JLPT 级别」的查询函数，第一次用到时才下载那张表。
 *
 * `enabled` 传 false（英语词单这种用不上的地方）就既不下载也不查，
 * 返回的函数恒为空数组。
 */
export function useJlptLevels(enabled = true) {
  const [loaded, setLoaded] = useState(table)

  useEffect(() => {
    if (!enabled || loaded) return
    let cancelled = false
    void loadTable().then((next) => {
      if (!cancelled) setLoaded(next)
    })
    return () => {
      cancelled = true
    }
  }, [enabled, loaded])

  return useCallback(
    (word: string) => (enabled && loaded ? (loaded.get(word) ?? EMPTY) : EMPTY),
    [enabled, loaded],
  )
}
