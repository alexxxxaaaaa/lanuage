import { useId, useRef, useState } from 'react'
import { Button } from '@heroui/react'

/**
 * 字幕输入：以「选文件」为主，粘贴为备选。
 *
 * 原来的做法是一个 <input type="file"> 配一个大 textarea，两者绑同一个 state。
 * 问题是选完文件之后，几千行 SRT 原文会整个灌进 textarea —— 没人需要读它，
 * 却占掉半屏，还让人以为「是不是该自己往里粘点什么」。
 *
 * 现在：没选文件时只有一个按钮；选完显示「文件名 · N 条字幕」。真要手敲的
 * 人点一下「手动粘贴」才展开文本框。
 */

/** 和服务端 subtitleParser 的时间轴正则一致 —— 用来数这份字幕有几条。 */
const TS_RE = /\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}\s*-->/g

function countCues(text: string): number {
  return text.match(TS_RE)?.length ?? 0
}

type Props = {
  label: string
  value: string
  onChange: (value: string) => void
  /** 选填项在标题后面缀一句说明。 */
  hint?: string
}

export function SubtitleFileInput({ label, value, onChange, hint }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [showPaste, setShowPaste] = useState(false)
  const pasteId = useId()

  const cues = value.trim() ? countCues(value) : 0

  const pickFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // 同一个文件连选两次也要触发 change，所以读完就清空 input 的值。
    event.target.value = ''
    if (!file) return
    const text = await file.text()
    setFileName(file.name)
    setShowPaste(false)
    onChange(text)
  }

  const clear = () => {
    setFileName(null)
    onChange('')
  }

  return (
    <div className="grid gap-2">
      <span className="muted text-[13px]">
        {label}
        {hint ? <span className="ml-1 opacity-70">{hint}</span> : null}
      </span>

      <input
        ref={fileRef}
        type="file"
        accept=".srt,.vtt,text/plain"
        className="hidden"
        onChange={(e) => void pickFile(e)}
      />

      {value.trim() ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-success/25 bg-success-soft px-3 py-2 text-[13px]">
          <span className="font-medium text-success-soft-foreground">
            {fileName ?? '已粘贴字幕'}
          </span>
          <span className="muted">
            {/* 0 条是真·出事了：文件选了但一条时间轴都没解析出来（格式不对、
                或者选错了文件）。与其等导入时报错，不如这里就说清楚。 */}
            {cues > 0 ? `${cues} 条字幕` : '⚠ 没解析出时间轴，可能不是字幕文件'}
          </span>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" type="button" onPress={() => fileRef.current?.click()}>
              重新选择
            </Button>
            <Button size="sm" variant="outline" type="button" onPress={clear}>
              清空
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" type="button" onPress={() => fileRef.current?.click()}>
            选择 .srt / .vtt 文件
          </Button>
          <button
            type="button"
            className="cursor-pointer border-none bg-transparent p-0 text-[13px] text-accent underline-offset-2 hover:underline"
            onClick={() => setShowPaste((prev) => !prev)}
          >
            {showPaste ? '收起' : '或手动粘贴'}
          </button>
        </div>
      )}

      {showPaste && !value.trim() ? (
        <textarea
          id={pasteId}
          rows={4}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="把 .srt 或 .vtt 的内容粘到这里"
          className="w-full resize-y rounded-lg border border-field-border bg-field px-2 py-1.5 font-mono text-xs focus:border-accent focus:outline-none"
        />
      ) : null}
    </div>
  )
}
