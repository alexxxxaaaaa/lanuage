# 日中 / 中日 词库

由 [`server/scripts/buildDict.ts`](../../scripts/buildDict.ts) 从 Wiktextract 抽取基础词库，
并可用 [`server/scripts/mergeDict.ts`](../../scripts/mergeDict.ts) 合并其他词典来源。

```bash
npm run build:dict          # 抽取 → 本目录 *.jsonl.gz + client/public/dict/*.idx
npm run merge:dict -- --input-dir "/path/to/output" # 同源清洗合并 + 重建索引
                            # --input-dir 里的 .jsonl / .jsonl.gz 都能读
npm run merge:dict -- --in-place # 原地重跑词性/例句/读音增强，不加入新来源
npm run import:dict         # 灌本地 SQLite
npm run import:dict -- --d1 # 生成 D1 分片 SQL → server/d1_dict/
bash d1_dict/apply.sh       # 打到线上 D1
```

源 dump 下载到 gitignore 的 `server/.dictcache/`，可随时重新拉取。

## 文件

| 文件 | 方向 | 词条数 | 原始 | gzip | 读音覆盖 |
|---|---|---|---|---|---|
| `ja-zh.jsonl.gz` | 日 → 中 | 462,366 | 165.4 MB | 36.6 MB | 96.9%（假名） |
| `zh-ja.jsonl.gz` | 中 → 日 | 109,753 | 39.0 MB | 8.4 MB | 99.9%（拼音） |

**落盘是 gzip 的**，读写都走 [`scripts/dictFile.ts`](../../scripts/dictFile.ts)。
原因是 Git LFS：未压缩的两个文件合计 204 MB，GitHub 免费 LFS 只有 1 GB 存储 +
1 GB 月带宽、且按账号跨所有仓库共享，很快就撞配额。压完 42.9 MB，当普通 git blob
提交即可，离 GitHub 50 MB 的单文件警告线还有一半余量，也不必分片。

命令行直接看内容：`gzip -dc ja-zh.jsonl.gz | head`。

每行一个 JSON 对象：

```jsonc
{
  "word": "勉強",
  "reading": "べんきょう",   // 日中为假名；中日为官話拼音
  "romaji": "benkyō",       // 仅日中
  "pos": "unknown",
  "senses": [{ "pos": "名·他サ", "glosses": ["学习。"], "examples": [{ "text": "…", "translation": "…" }] }],
  "direction": "ja-zh",
  "source": "zhwiktionary",
  "sortKey": "へんきよう"    // 五十音順 / 拼音序，见下
}
```

## 索引文件

同时产出 `client/public/dict/<direction>.idx`，随前端发布，供查词页右侧的索引栏用。
每行三列 `sortKey \t 词头 \t 读音`，已按 `sortKey` 排好序：

| 文件 | 行数 | 原始 | gzip |
|---|---|---|---|
| `ja-zh.idx` | 302,960 | 13.2 MB | — |
| `zh-ja.idx` | 87,175 | 2.3 MB | — |

排序键的算法在 [`shared/dictSort.ts`](../../../shared/dictSort.ts) —— 构建脚本用它定序，
客户端用同一份归一化用户输入后做二分定位，所以两边必须是同一份实现。

- **日中**按五十音順。平假名的 Unicode 码位顺序本身就是五十音順（か→が→き→ぎ
  依次相邻），所以片假名折成平假名后直接按码位比较即可。长音符按辞書順展开成
  前一个假名的母音（コーヒー → こおひい），否则 `ー` 会排到 `ん` 之后，外来语整体错位。
- **中日**按拼音字母序，去声调、`ü` 折成 `v`（好让 lü 排在 lu 之后）。
- 无读音的条目用 `￿` 起头沉到末尾，组内仍按词头有序。

## 数据来源

所有数据都取自**原生支持该方向**的词典，没有做跨语言桥接：

- **日中** ← 中文维基词典里的日语词条（kaikki.org `zh-extract`，`lang_code === "ja"`）
- **中日** ← 日语维基词典里的中文词条（kaikki.org `ja-extract`，`lang_code === "zh"`）
- **日中** ← `shinjidai-jc`、`shinseiki-jc`、`moji`
- **中日** ← `baishuishe-cj`

合并时以 `source` 为严格边界：不同来源即使内容相同也全部保留；只在同一来源内
合并词头、读音、罗马字和词性均相同的记录，并对义项、例句做精确去重。

**JMdict 未采用**：其 218,290 条词条里只有 293 条带中文 gloss（0.13%，且多为零星词源标注），
释义语言实际是英/德/荷/匈/俄/西/法/斯洛文尼亚/瑞典，不是原生日中词典。

## 已知限制

- 中文维基来源原有 73,964 条 `pos: unknown`。构建期会抽取释义段落里的词性标记
  （包括 `名·他サ`、`名?他サ` 等源数据变体），目前能可靠恢复 5,528 条；其余多数是
  没有任何词性标记的技术词，不能根据词尾臆测。一个词条内切换词性时同时写入
  `senses[].pos`，条目级 `pos` 保存去重后的汇总。
- 中日的拼音只有 33.9% 来自日语维基词典本身（源头 46,841 条里 30,166 条没有 sounds
  字段），其余在构建期用 `pinyin-pro` 补齐，按词组消歧多音字。它是 server 的
  devDependency，只在构建期跑，拼音直接烤进数据，运行时没有这个依赖。
- 中日的 `sounds` 混有粤语/客家/闽南/中古音/上古音，脚本只取官話拼音。
- 日中缺读音从 21,406 条降到 14,474 条（覆盖率 96.9%）。Kuromoji 只补中文维基来源，
  且会拒绝未知汉字、姓名和单汉字 token；剩余条目宁可留空，避免给被误标成日语的
  汉语词或多音词烤入错误读音。
- 中文维基的压缩段落会按编号拆成义项；只有相邻且脚本特征明确的日文／中文行，或
  含完整词头的全汉字日文行，才组成 `examples[]`。无法可靠判断的行继续保留在 gloss。

## 许可与署名

维基词典（Wiktionary）部分采用 **CC BY-SA 4.0** 许可，可自由使用与再分发，
惟须署名并以相同方式共享。其他来源沿用各自的许可与使用条件，发布前须另行确认。

- 日中：中文维基词典 https://zh.wiktionary.org — © Wiktionary 贡献者，CC BY-SA 4.0
- 中日：日语维基词典 https://ja.wiktionary.org — © Wiktionary 贡献者，CC BY-SA 4.0
- 结构化抽取：Wiktextract / kaikki.org（Tatu Ylonen），https://kaikki.org

在任何对外展示词库内容的界面上保留以上署名，并声明衍生作品同样以 CC BY-SA 4.0 提供。
