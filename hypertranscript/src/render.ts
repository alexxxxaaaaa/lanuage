/**
 * 输出三种产物：
 *   .json  —— 带读音词性的结构化中间产物，后续入库直接读它
 *   .html  —— Hyperaudio Lite 的 hypertranscript 片段，供前端组件内嵌
 *   .preview.html —— 带播放器的独立页面，双击就能验证对齐效果
 */

import type { TimedToken } from './tokenize.ts'

/** 一条音频的完整转写结果。 */
export type TranscriptResult = {
  /** 考期目录名，如 2025.07 */
  exam: string
  /** 题号，如 聴解1-1 */
  question: string
  /** 相对仓库根的音频路径 */
  audioPath: string
  /** 播放器实际要用的 src，由 config.output.mediaSrcPrefix 拼出 */
  mediaSrc: string
  /** 秒 */
  duration: number
  /** gpt-transcribe 的原始文本 */
  text: string
  models: { text: string; timing: string }
  /** LCS 命中率，用来筛可疑结果 */
  matchRate: number
  /** 走过分段救援时的记录，正常条目上不存在 */
  rescue?: { chunks: number; before: number; after: number }
  tokens: TimedToken[]
}

/** 一段里最多放多少词 —— 没有句末标点的长独白也不至于挤成一坨。 */
const MAX_TOKENS_PER_PARAGRAPH = 60

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 按句末标点切段，顺带兜一个长度上限。 */
function splitParagraphs(tokens: TimedToken[]): TimedToken[][] {
  const paragraphs: TimedToken[][] = []
  let current: TimedToken[] = []

  for (const token of tokens) {
    current.push(token)
    if (token.endsSentence || current.length >= MAX_TOKENS_PER_PARAGRAPH) {
      paragraphs.push(current)
      current = []
    }
  }
  if (current.length > 0) paragraphs.push(current)

  return paragraphs
}

/**
 * 渲染 hypertranscript 片段。
 *
 * 外层刻意不带 `<div id="hypertranscript">` —— 那个 id 归宿主页面所有，
 * 前端组件把这段塞进自己的容器即可。结构其余部分（article > section > p > span）
 * 与 Hyperaudio Lite 官方 demo 一致。
 */
export function renderHypertranscript(result: TranscriptResult): string {
  const paragraphs = splitParagraphs(result.tokens)

  const body = paragraphs
    .map((paragraph) => {
      const spans = paragraph
        .map(
          (token) =>
            `<span data-m="${token.m}" data-d="${token.d}">${escapeHtml(token.text)}</span>`,
        )
        .join('')
      return `    <p>${spans}</p>`
    })
    .join('\n')

  return [
    '<article>',
    `  <section data-media-src="${escapeHtml(result.mediaSrc)}">`,
    body,
    '  </section>',
    '</article>',
    '',
  ].join('\n')
}

/**
 * 渲染带播放器的独立预览页。
 *
 * 只用于本地肉眼验证对齐质量，不参与生产。音频走相对路径引用 n1-qbank 下的
 * 原始文件，所以这个页面得留在 output 目录里打开才能出声。
 */
export function renderPreview(result: TranscriptResult, relativeAudioSrc: string): string {
  const transcript = renderHypertranscript(result)
  const quality = (result.matchRate * 100).toFixed(1)

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(result.exam)} ${escapeHtml(result.question)}</title>
<style>
/* 色值照搬 client/src/theme.css 的语义变量，这样预览页里看到的效果
   就是接进 client 之后的效果。预览页是独立 HTML、拿不到 HeroUI 的变量，
   所以在这里重新声明一遍；接进 client 时换成 var(--foreground) 那套即可。 */
:root {
  --background: oklch(0.958 0.0028 265);
  --surface: oklch(0.999 0.0006 265);
  --foreground: oklch(0.2103 0.0059 285.89);
  --muted: oklch(0.552 0.009 275);
  --current: oklch(0.588 0.113 253);   /* --accent：主题蓝 */
  --hairline: oklch(0.2103 0.0059 285.89 / 0.08);
}
:root[data-theme="dark"] {
  --background: oklch(0.138 0.004 275);
  --surface: oklch(0.216 0.005 275);
  --foreground: oklch(0.9911 0 0);
  --muted: oklch(0.702 0.011 275);
  --current: oklch(0.662 0.106 253);   /* 深色下 L 提一档，否则同样的 chroma 会发平 */
  --hairline: oklch(0.9911 0 0 / 0.11);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --background: oklch(0.138 0.004 275);
    --surface: oklch(0.216 0.005 275);
    --foreground: oklch(0.9911 0 0);
    --muted: oklch(0.702 0.011 275);
    --current: oklch(0.662 0.106 253);
    --hairline: oklch(0.9911 0 0 / 0.11);
  }
}

* { box-sizing: border-box; }
body {
  font-family: "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif;
  max-width: 46rem;
  margin: 0 auto;
  padding: 2rem 1rem 6rem;
  background: var(--background);
  color: var(--foreground);
}
header { display: flex; gap: .75rem; align-items: baseline; flex-wrap: wrap; margin-bottom: 1rem; }
h1 { font-size: 1.05rem; margin: 0; font-weight: 600; }
.meta { color: var(--muted); font-size: .8rem; }
#theme-toggle {
  margin-left: auto; padding: .3rem .7rem; font: inherit; font-size: .75rem;
  color: var(--muted); background: var(--surface);
  border: 1px solid var(--hairline); border-radius: .625rem; cursor: pointer;
}

/* 播放器吸顶，长文本滚动时也够得着 */
.player {
  position: sticky; top: 0; z-index: 2;
  padding: .75rem 0 1rem; margin-bottom: .5rem;
  background: var(--background);
  border-bottom: 1px solid var(--hairline);
}
audio { width: 100%; display: block; }

#hypertranscript { font-size: 1.05rem; line-height: 2.1; }
#hypertranscript p { margin: 0 0 1.15rem; }

/* 三档状态，靠明度递进而不是背景框：
   未播（默认 / .unread）暗 → 已播（.read）亮 → 当前（.active）金色加粗。
   CJK 字形本身等宽，加粗不改变字宽，所以不会把后面的文字推得抖动；
   行内的半角数字会有极轻微位移，可接受。 */
#hypertranscript span {
  cursor: pointer;
  color: var(--muted);
  transition: color .14s ease-out;
}
#hypertranscript span.read { color: var(--foreground); }
#hypertranscript span.active {
  color: var(--current);
  font-weight: 700;
}
#hypertranscript span:hover { color: var(--foreground); }
#hypertranscript span.active:hover { color: var(--current); }

@media (prefers-reduced-motion: reduce) {
  #hypertranscript span { transition: none; }
}
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(result.exam)} ${escapeHtml(result.question)}</h1>
  <span class="meta">${result.duration.toFixed(1)}s · ${result.tokens.length} 词 · 对齐命中率 ${quality}%</span>
  <button id="theme-toggle" type="button">切换明暗</button>
</header>

<div class="player">
  <audio id="hyperplayer" src="${escapeHtml(relativeAudioSrc)}" controls preload="metadata"></audio>
</div>

<div id="hypertranscript" class="hyperaudio-transcript">
${transcript}</div>

<script src="https://cdn.jsdelivr.net/npm/hyperaudio-lite@2/js/hyperaudio-lite.js"></script>
<script>
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const root = document.documentElement;
    const dark = root.dataset.theme
      ? root.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
  });

  window.addEventListener('DOMContentLoaded', () => {
    if (typeof HyperaudioLite === 'undefined') {
      document.querySelector('.meta').textContent += ' · CDN 未加载，点词跳转不可用';
      return;
    }
    new HyperaudioLite({
      transcript: 'hypertranscript',
      player: 'hyperplayer',
      autoScroll: true,
      playOnClick: true,
    });
  });
</script>
</body>
</html>
`
}
