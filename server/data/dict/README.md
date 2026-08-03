# 日中 / 中日 词库

由 [`server/scripts/buildDict.ts`](../../scripts/buildDict.ts) 从 Wiktextract 抽取生成。
重新生成：`npm run build:dict`（源 dump 会下载到 gitignore 的 `server/.dictcache/`）。

## 文件

| 文件 | 方向 | 词条数 | 大小 | 读音覆盖 |
|---|---|---|---|---|
| `ja-zh.jsonl` | 日 → 中 | 115,428 | 23.2 MB | 84.0% |
| `zh-ja.jsonl` | 中 → 日 | 46,841 | 8.1 MB | 33.9%（拼音） |

每行一个 JSON 对象：

```jsonc
{
  "word": "勉強",
  "reading": "べんきょう",   // 日中为假名；中日为官話拼音
  "romaji": "benkyō",       // 仅日中
  "pos": "unknown",
  "senses": [{ "glosses": ["学习。"], "examples": [{ "text": "…", "translation": "…" }] }],
  "direction": "ja-zh",
  "source": "zhwiktionary"
}
```

## 数据来源

两个方向都取自**原生支持该方向**的词典，没有做跨语言桥接：

- **日中** ← 中文维基词典里的日语词条（kaikki.org `zh-extract`，`lang_code === "ja"`）
- **中日** ← 日语维基词典里的中文词条（kaikki.org `ja-extract`，`lang_code === "zh"`）

**JMdict 未采用**：其 218,290 条词条里只有 293 条带中文 gloss（0.13%，且多为零星词源标注），
释义语言实际是英/德/荷/匈/俄/西/法/斯洛文尼亚/瑞典，不是原生日中词典。

## 已知限制

- `pos` 有 73,973 条为 `unknown` —— 中文维基词典把整个词条段落压进单个 gloss 字段，
  没有独立标注词性。词性信息通常在释义首行（如 `名·他サ`）。
- 中日方向拼音覆盖只有 33.9%：源头 46,841 条里有 30,166 条在日语维基词典本身就没有
  读音数据。已抽出的占「有 sounds 字段」条目的 95%，这是源数据上限。
- 中日的 `sounds` 混有粤语/客家/闽南/中古音/上古音，脚本只取官話拼音。
- 释义按行拆分后未再区分「定义行」与「例句行」—— 强行切分会误伤，交由使用方按
  `^\d+\.` 等模式自行判断。

## 许可与署名

内容来自维基词典（Wiktionary），采用 **CC BY-SA 4.0** 许可，可自由使用与再分发，
惟须署名并以相同方式共享。

- 日中：中文维基词典 https://zh.wiktionary.org — © Wiktionary 贡献者，CC BY-SA 4.0
- 中日：日语维基词典 https://ja.wiktionary.org — © Wiktionary 贡献者，CC BY-SA 4.0
- 结构化抽取：Wiktextract / kaikki.org（Tatu Ylonen），https://kaikki.org

在任何对外展示词库内容的界面上保留以上署名，并声明衍生作品同样以 CC BY-SA 4.0 提供。
