import { SpeakButton } from './SpeakButton'
import { useI18n } from '../i18n'
import type { DictEntry } from '../api/dict'

const NUMBERED = /^(\d+)[.、．]\s*(.*)$/

const SOURCE_LABEL: Record<string, string> = {
  zhwiktionary: 'wordSearch.sourceZhWiktionary',
  jawiktionary: 'wordSearch.sourceJaWiktionary',
  'shinjidai-jc': 'wordSearch.sourceShinjidai',
  'shinseiki-jc': 'wordSearch.sourceShinseiki',
  moji: 'wordSearch.sourceMoji',
  'baishuishe-cj': 'wordSearch.sourceBaishuishe',
}

const SOURCE_LINK: Record<string, { href: string; title: string }> = {
  zhwiktionary: {
    href: 'https://zh.wiktionary.org/',
    title: '中文维基词典 · CC BY-SA 4.0',
  },
  jawiktionary: {
    href: 'https://ja.wiktionary.org/',
    title: '日本語版ウィクショナリー · CC BY-SA 4.0',
  },
}

type Props = {
  entries: DictEntry[]
}

/**
 * 本地词库的查词结果。
 *
 * 同一个词头在两个方向、多个词性下会有多条记录，这里按「来源词典」分组，
 * 组内一条记录一张小卡 —— 和纸质辞书里同一词条下并列多个词典的排版一致。
 */
export function DictEntryResults({ entries }: Props) {
  const { t } = useI18n()

  // 按来源词典分组，保持接口返回的顺序（服务端已按 direction → pos 排好）。
  const groups = new Map<string, DictEntry[]>()
  for (const entry of entries) {
    const list = groups.get(entry.source)
    if (list) list.push(entry)
    else groups.set(entry.source, [entry])
  }

  return (
    <div className="grid gap-4">
      {[...groups].map(([source, items]) => (
        <section key={source} className="grid gap-2">
          <div className="flex items-center gap-2">
            {SOURCE_LINK[source] ? (
              <a
                className="rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-bold text-accent hover:underline"
                href={SOURCE_LINK[source].href}
                target="_blank"
                rel="noreferrer"
                title={SOURCE_LINK[source].title}
              >
                {t(SOURCE_LABEL[source] ?? source)} ↗
              </a>
            ) : (
              <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-xs font-bold text-accent">
                {t(SOURCE_LABEL[source] ?? source)}
              </span>
            )}
            <span className="muted text-[12px]">
              {items[0].direction === 'ja-zh'
                ? t('wordSearch.dirJaZh')
                : t('wordSearch.dirZhJa')}
            </span>
          </div>

          {items.map((entry) => (
            <DictEntryCard key={entry.id} entry={entry} />
          ))}
        </section>
      ))}
    </div>
  )
}

function DictEntryCard({ entry }: { entry: DictEntry }) {
  // 词库里日中的读音是假名、中日是拼音；发音只对日语有意义。
  const isJapanese = entry.direction === 'ja-zh'
  const sensePos = new Set(entry.senses.map((sense) => sense.pos).filter(Boolean))
  const showSensePos = sensePos.size > 1

  return (
    <div className="grid gap-2 rounded-xl border border-border bg-foreground/2 px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-[17px] text-foreground">{entry.word}</strong>
        {isJapanese ? (
          <SpeakButton text={entry.word} reading={entry.reading} lang="jp" size="sm" />
        ) : null}
        {entry.reading ? (
          <span className="muted text-[13px]">{entry.reading}</span>
        ) : null}
        {entry.romaji ? (
          <span className="muted text-[12px] italic">{entry.romaji}</span>
        ) : null}
        {entry.pos && entry.pos !== 'unknown' ? (
          <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted">
            {entry.pos}
          </span>
        ) : null}
      </div>

      {entry.senses.map((sense, senseIndex) => (
        <div key={senseIndex} className="grid gap-1">
          {showSensePos && sense.pos ? (
            <span className="w-fit rounded-full bg-foreground/5 px-2 py-0.5 text-[11px] text-muted">
              {sense.pos}
            </span>
          ) : null}

          {sense.glosses.map((gloss, glossIndex) => {
            const numbered = gloss.match(NUMBERED)
            return numbered ? (
              <div key={glossIndex} className="grid grid-cols-[1.5rem_1fr] gap-1 text-[14px]/[1.7] text-foreground">
                <span className="pt-px text-right font-semibold tabular-nums text-accent">
                  {numbered[1]}.
                </span>
                <p className="m-0 min-w-0">{numbered[2]}</p>
              </div>
            ) : (
              <p key={glossIndex} className="m-0 text-[14px]/[1.7] text-foreground">
                {gloss}
              </p>
            )
          })}

          {sense.examples?.map((example, exampleIndex) => (
            <div
              key={exampleIndex}
              className="grid gap-0.5 border-l-2 border-accent/25 pl-2.5"
            >
              <span className="text-[13px]/[1.6] text-foreground">{example.text}</span>
              {example.translation ? (
                <span className="muted text-[13px]/[1.6]">{example.translation}</span>
              ) : null}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
