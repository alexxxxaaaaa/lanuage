# hypertranscript

把 `n1-qbank/audio` 下的听力音频转成 [Hyperaudio Lite](https://github.com/hyperaudio/hyperaudio-lite) 能直接吃的**词级** hypertranscript，用于单题练习的「点词跳转 + 逐词高亮」。

## 为什么调两个模型

OpenAI 的词级时间戳只开给 `whisper-1`。官方 speech-to-text 文档原文：

> The `timestamp_granularities[]` parameter is only supported for `whisper-1`.

而 `whisper-1` 的日语转写质量明显不如 `gpt-transcribe`（长静音处偶发重复、汉字选词更差）。所以两边各取所长：

```
gpt-transcribe  ──▶ 「今日は会議の資料について」        文本准
whisper-1       ──▶ 今日[0-380] は[380-520] 会議[520-980]  时间准
                          │
                    归一化 + LCS 对齐
                          │
                    kuromoji 形态素重切
                          ▼
        <span data-m="0" data-d="380">今日</span>
        <span data-m="380" data-d="140">は</span>
```

两次调用并发发出，不额外增加墙钟时间。

## 处理范围

只转**单题音频** `聴解N-M.mp3`（1043 条）。整卷音频 `材料1.mp3` / `full.mp3`（30 条）按 `input.excludePattern` 跳过 —— 单题练习用不上。

## 配置

```bash
cp config.example.json config.json
export OPENAI_API_KEY=sk-...        # 或直接把 key 填进 config.json

# 也可以直接复用 server/.env 里已有的那把
export $(grep '^OPENAI_API_KEY=' ../server/.env | xargs)
```

`config.json` 各项说明：

| 字段 | 说明 |
| --- | --- |
| `openai.apiKey` | 写 `"env:OPENAI_API_KEY"` 从环境变量取，也可直接填 key |
| `openai.baseURL` | 走代理或中转时改这里 |
| `openai.textModel` | 出文本的模型，默认 `gpt-transcribe` |
| `openai.timingModel` | 出时间轴的模型，**只能是 `whisper-1`**，配别的会警告 |
| `openai.prompt` | 给 `textModel` 的提示，引导术语和风格 |
| `openai.timingPrompt` | 给 `timingModel` 的提示，**默认不传，一般也别传**（见下） |
| `input.audioDir` | 音频根目录，相对本目录 |
| `input.includePattern` | 文件名（不含扩展名）需匹配才处理 |
| `input.excludePattern` | 匹配则跳过，默认排除整卷音频 |
| `input.exams` | 只跑这些考期，空数组=全部 |
| `output.mediaSrcPrefix` | 拼进 `data-media-src` 的前缀，对齐生产音频 URL |
| `run.concurrency` | 并发条数，每条 2 次 API 调用 |
| `run.skipExisting` | 已有输出则跳过，支持断点续跑 |
| `run.matchRateWarn` | 对齐命中率低于此值的会在收尾汇总里单独列出 |
| `run.rescueBelow` | 命中率低于此值时自动切段重取时间轴，设 `0` 关掉 |
| `run.rescueChunks` | 救援时把音频切成几段，默认 3 |

`config.json` 已在 `.gitignore` 里，key 不会进版本库。

## 运行

```bash
# 看看会处理哪些、花多少钱，不调 API
npm run dry-run

# 先拿 3 条试跑，带预览页
npm start -- --exam 2025.07 --limit 3 --preview

# 跑一整个考期
npm start -- --exam 2025.07

# 全量（约 21.6 小时音频，估算 $14）
npm start
```

| 参数 | 说明 |
| --- | --- |
| `--config <path>` | 指定配置文件，默认 `./config.json` |
| `--exam <name>` | 只处理该考期，可重复 |
| `--limit <n>` | 最多处理 n 条 |
| `--concurrency <n>` | 覆盖配置里的并发数 |
| `--force` | 忽略已有输出，全部重跑 |
| `--dry-run` | 只列出待处理文件和预估成本 |
| `--render-only` | 拿已有的 json 重新渲染 html/预览页，**不调 API** |
| `--preview` | 额外生成带播放器的独立预览页 |

转写结果是花钱买来的，调样式改模板不该再付一次费：

```bash
npm start -- --render-only --preview
```

跑挂了直接重跑同一条命令即可 —— 已完成的会自动跳过，只补失败的。

## 输出

```
output/2025.07/
  聴解1-1.json          结构化数据，含读音和词性
  聴解1-1.html          hypertranscript 片段
  聴解1-1.preview.html  带播放器的预览页（--preview 时）
```

`.json` 长这样：

```json
{
  "exam": "2025.07",
  "question": "聴解1-1",
  "audioPath": "n1-qbank/audio/2025.07/聴解1-1.mp3",
  "mediaSrc": "/exam-media/2025.07/聴解1-1.mp3",
  "duration": 93.864,
  "text": "……",
  "models": { "text": "gpt-transcribe", "timing": "whisper-1" },
  "matchRate": 0.94,
  "tokens": [
    { "text": "今日", "surface": "今日", "reading": "キョウ", "pos": "名詞", "m": 0, "d": 380, "endsSentence": false }
  ]
}
```

`reading` / `pos` 是 kuromoji 顺带给的，可以直接接现有的词典功能。

`.html` 片段刻意**不带** `<div id="hypertranscript">` 外壳 —— 那个 id 归宿主页面所有：

```html
<article>
  <section data-media-src="/exam-media/2025.07/聴解1-1.mp3">
    <p><span data-m="0" data-d="380">今日</span><span data-m="380" data-d="140">は</span>…</p>
  </section>
</article>
```

前端接入时把这段塞进自己的容器：

```html
<audio id="hyperplayer" src="…" controls></audio>
<div id="hypertranscript" class="hyperaudio-transcript"><!-- 片段 --></div>
<script>
  new HyperaudioLite({
    transcript: 'hypertranscript',
    player: 'hyperplayer',
    autoScroll: true,
    playOnClick: true,
  })
</script>
```

## 送到前端（R2）

前端要的是精简格式，不是 `output/` 里那份完整 json —— 后者每条 45 KB，里面的读音、词性、原文、对齐指标播放器一个字节都用不上。

```bash
npm run export:r2      # output/*.json → dist-r2/transcript/，1043 条共 3.5 MB
npm run upload:r2      # 传到 R2（需要先 npx wrangler login）
```

**换一台机器传**：`dist-r2/` 没进 git（能从 `output/` 重新生成），所以要先导出一次：

```bash
git pull
npm install            # 在仓库根跑，wrangler 和 tsx 都装在这
npx wrangler login     # 一次性授权；注意是 npx —— wrangler 没有全局安装
cd hypertranscript
npm run export:r2      # 重新生成 dist-r2/
npm run upload:r2
```

这条路不需要 `config.json` —— 导出和上传都不碰 OpenAI API，配置缺失时会直接用默认值。

对象名跟着 `QbankQuestion.audioKey` 的规矩走，去掉「聴解」保持纯 ASCII：

```
output/2020.12/聴解1-1.json  →  qbank/transcript/2020.12/1-1.json
```

于是前端拿 `audioUrl` 换个前缀就得到转写地址，**后端不用出接口**：

```
…/qbank/audio/2020.12/1-1.mp3   ← 音频
…/qbank/transcript/2020.12/1-1.json  ← 转写
```

精简后的结构，词用元组省掉重复键名：

```json
{
  "duration": 93.864,
  "tokens": [["今日", 0, 380], ["は", 380, 140]],
  "paragraphs": [0, 2, 15]
}
```

`paragraphs` 是每段起始的 token 下标，前端据此切 `<p>`。平均 3.5 KB/条，gzip 后约 1 KB。

上传支持断点续传（记在 `.transcript-upload.log`），重跑自动跳过已传的。

### 样式

Hyperaudio Lite 在播放时给 span 挂三种 class：`unread`（未播，也是默认态）、`read`（已播）、`active`（当前词）。预览页的配色直接照搬了 `client/src/theme.css`，接进 client 时把字面色值换成语义变量就行：

```css
/* 靠明度递进表达进度，不用背景框：未播暗 → 已播亮 → 当前主题蓝加粗 */
.hyperaudio-transcript span {
  cursor: pointer;
  color: var(--muted);
  transition: color 0.14s ease-out;
}
.hyperaudio-transcript span.read {
  color: var(--foreground);
}
.hyperaudio-transcript span.active {
  color: var(--accent);
  font-weight: 700;
}
.hyperaudio-transcript span:hover {
  color: var(--foreground);
}
.hyperaudio-transcript span.active:hover {
  color: var(--accent);
}
```

`--accent` 明暗两套各有取值（深色下 L 提了一档），跟着 `.dark` 自动切，不用自己判断主题。

CJK 字形等宽，加粗不改字宽，所以 `active` 不会把后文推得抖动；行内半角数字有极轻微位移，可接受。

## 对齐质量

`matchRate` 是 LCS 命中的字符数 ÷ gpt 文本字符数，反映两版转写的一致程度：

- **> 0.9** — 两个模型基本转出同一段话，时间戳可信
- **0.6 ~ 0.9** — 局部有差异，未命中处靠线性插值兜底，通常仍可用
- **< 0.6** — 两版差太多，跑完会在汇总里单独列出，建议开预览页肉眼过一遍

命中率低的原因基本都是 whisper 幻觉。踩过两种：

**1. 复读 prompt（已修）**

给 `whisper-1` 传 prompt 会触发这个。whisper 不是 LLM，prompt 对它只是「前文」，模型顺着往下续写；碰上语音密度低的片段就整段复读 prompt：

```
whisper 输出: N1の聴解問題の音声 N1の聴解問題の音声 N1の聴解問題の音声 …
```

首次全量跑时 `prompt` 同时喂给了两个模型，**1042 条里 84 条中招**。改成 `timingPrompt` 独立配置、默认留空后，这 84 条重跑全部回到 93~100%。所以 `timingPrompt` 保持不设就好 —— 文本质量本来就由 `textModel` 负责。

**2. 重复循环（已自动救援）**

whisper 卡在一句话上反复输出，把后面的内容整个丢掉，跟 prompt 无关：

```
whisper 输出: 2人はどうやって…しましたか
             3人はどうやって…しましたか   ← 复读 ×6
```

这种卡死跟音频里的具体位置绑定，而且 `temperature=0` 下完全确定性 —— 同一条重试 3 次，输出一字不差都是那份烂结果。试过调高 temperature 也不行：0.4 照样复读，0.8 虽然跳出了循环但转成完全错误的内容，反而更糟。

有效的办法是**切开音频**：卡死点在整条里成立，在切段后就不成立了。实测那条 119 秒的音频，整条转只出 125 字，切 3 段后出 561 字，与 gpt 版的 529 字吻合。

所以命中率低于 `run.rescueBelow` 时会自动切成 `run.rescueChunks` 段重取时间轴，只在结果确实变好时才采纳。走过救援的条目会在 json 里留一条记录：

```json
"rescue": { "chunks": 3, "before": 0.19, "after": 0.97 }
```

顺带说一句，whisper 官方用来判幻觉的 `compression_ratio` 对这种情况**没用** —— 实测那条的各 segment 都在 0.95~1.07，远低于 2.4 的阈值，因为重复发生在 segment 之间而不是内部。用对齐命中率当触发条件更直接可靠。

### 容器与扩展名不符

`n1-qbank` 里存在名为 `.mp3`、内容其实是 WAV 的文件（`2020.12/聴解4-9`，12.2 MB / 33 秒）。OpenAI 按扩展名判定格式，直接喂进去会回 400 `Audio file might be corrupted or unsupported`。脚本会用 ffprobe 比对真实容器，不符就先转码，跑的时候会打印一行 `↻ … 先转码：容器与扩展名不符`。

## 依赖

- Node ≥ 24
- `ffprobe`（读时长）；只有单文件超过 `run.maxFileMB` 时才需要 `ffmpeg` 转码 —— 现有音频最大 12.2 MB，用不上
- `openai`、`@sglkc/kuromoji`、`tsx` 已在仓库根 `node_modules` 里，无需单独 `npm install`
