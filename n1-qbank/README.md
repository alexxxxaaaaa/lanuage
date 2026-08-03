# N1 真题题库（nadou.net qbank 103）

2010.07–2025.12 共 **31 套** JLPT N1 真题，**3207 题**、**437 篇**文章（阅读材料 379 + 听力原文 58），
含题干、选项、答案、中文翻译、逐选项解析。仅供自建站个人学习使用。

数据主体来自 nadou.net 题库 103（2010.07–2024.12，29 套）；**2025.07 / 2025.12 两套来自 mojidict**
（纳豆题库没有）。另有 3 题 + 1 篇文章因纳豆源站已删除，也从 mojidict 同卷补入。
凡非纳豆来源的条目，md 里都带 `- source: mojidict` 字段。

两个来源的听力形态不同，接入时要区分：

| | 纳豆（2010–2024） | mojidict（2025） |
|---|---|---|
| 听力音频 | **每题一个 mp3** → `audio/<年月>/聴解N-M.mp3`（聴解5 有缺口，已从 mojidict 补齐） | 同左（分段音频后补）+ 另有整卷 `full.mp3` |
| 听力原文 | 无 | **有**（日文原文 + 中文译文，作为 `PL<小节>-<题号>` 文章块） |
| 問題号 | 接口不返回，靠结构反推（见下） | 结构自带（按大题组织），直接用 |

## 目录

```
n1-qbank/
├── raw/                     原始 JSON 快照（入 git，重跑转换的唯一数据源）
│   ├── papers.json          试卷索引：116 份 = 29 年月 × 词汇/语法/阅读/听力
│   ├── <年月>/<部分>.json
│   └── <年月>/<部分>.patch.json   外部来源补的缺题（目前仅 2013.07/阅读）
├── markdown/                题库 md，每年月一个文件（入 git）
│   └── <YYYY>年<MM>月_N1_题库.md
├── images/                  情報検索等图片型材料（入 git，58 张）
├── audio/                   听力音频，**不入 git**（见下），本地跑脚本才有
│   ├── <年月>/聴解N-M.mp3    题库引用的就是这些，1041 个
│   ├── <年月>/材料N.mp3      纳豆按材料另存的一份，没有题引用（见下）
│   └── 2025.*/full.mp3      整卷录音（含指示语与作答间隔），也没有题引用
└── index.json               筛选索引，仅元数据不含正文（入 git，940 KB）
```

音频原本全量入 git（1073 个 mp3 / 1.8 GB），把仓库撑到 1.2 GB，已用 `git filter-repo`
从全部历史里剔除，`.gitignore` 现在忽略 `n1-qbank/audio/`。**唯一的线上副本是 R2**，
上传脚本见 `server/scripts/uploadQbankMedia.sh`，**传哪些以 `index.json` 为准**
（被题目引用的 1041 个），`材料N.mp3`、`full.mp3` 这类没人引用的不传。
md 里的 `- audio:` 路径没变，`importQbank.ts` 的解析契约也没变。

本地要重新拿到音频，跑一遍下面「从零重跑」里的 `fetch_audio.py` /
`fetch_moji_segments.py` / `fetch_moji_audio_patch.py` 三步；抓下来别再提交。

## 听力音频是怎么补齐的

1071 道听力题现在**全部有音频**，来路有三条：

| 来源 | 数量 | 说明 |
|---|---|---|
| 纳豆每题一段 | 958 | `stemMedia.mediaUri`，`fetch_audio.py` 下的 |
| mojidict 分段（2025 两套） | 60 | 材料自带 `mediaId`，`fetch_moji_segments.py`，不需要 token |
| mojidict 补纳豆的缺口 | 53 | 見下，`fetch_moji_audio_patch.py` |

纳豆 2010–2024 每卷 聴解5 的「質問1 / 質問2」共用一段录音，源站没给（`stemMedia` 是空的），
53 道题因此没声音；另有 2022.07 那段虽有文件但只剩 12 秒，是截断的残片。这 27 段
从 mojidict 同卷同题借，**比听力原文**确认是同一段（命中项相似度 0.62+，次名全在 0.11 以下，
最小领先 9.4 倍）。借来的出处记在 `raw/<年月>/听力.patch.json` 的 overrides 里，
字段是 `stemMedia`，可查可回滚，raw 快照本身不动。

一段录音被多题共用时，文件按**该组第一道题的题号**命名，两道题的 `- audio:` 指向同一个文件
（全库 30 处，全部是 聴解5 的双问题项）。

> 纳豆其实还按材料另存过一份 `材料N.mp3`，内容与那段大体相同，但各年份长短不一
> （比 mojidict 的分段 -49s ~ +26s 不等），且从来没被 md 引用过。统一走 mojidict 是为了
> 来源单一、时长稳定；这些文件既不入 git 也不上传 R2，只在本地重跑脚本时会落盘。

## markdown 格式

与 [`server/scripts/importQbank.ts`](../server/scripts/importQbank.ts) 的解析契约完全一致，
`cd server && npm run import:qbank` 即可全量导入 `QbankPassage` / `QbankQuestion`
（网站的「JLPT 精练」板块用的就是这两张表，上线步骤见根目录 README）。

```markdown
## Q1                          ← 笔试题；听力题是 ## 聴解1-1
- section: 文字·語彙            ← 文字·語彙 / 文法 / 読解 / 聴解
- mondai: 1                    ← 問題号 1–13；听力用 listening + mondai_no
- type: 漢字読み
- stem_jp: …**強調語**…        ← 原文的下划线/加粗转成 **
- options:
  1. …
- answer: 2                    ← 1-based（接口是 0-based，转换时已 +1）
- alt_answer: 4                ← 仅分歧题有：另一来源的答案，站点两个都判对
- dispute_note: …              ← 仅分歧题有，且只有人工写过争点说明的那道才有
- stem_zh: …                   ← 中文翻译
- explain: …                   ← 逐选项解析
- passage: P8-1                ← 读解题引用的文章编号；听力题引用 PL<小节>-<题号>
- audio: audio/2020.12/聴解1-1.mp3
- source: mojidict             ← 仅非纳豆来源的条目才有

### 文章 P8-1（内容理解（短文））   ← 读解材料
### 文章 PL1-1（課題理解·聴解原文） ← 听力原文（日文原文 + 【中文译文】，仅 2025 两套）
```

## 筛选

`index.json` 的 `questions[]` 每条带 `year / month / section / mondai / mondai_no / seq / type /
answer / alt_answer / passage / audio`，四个维度都能直接筛：

```python
import json
Q = json.load(open('n1-qbank/index.json'))['questions']
[q for q in Q if q['section'] == '読解' and q['mondai'] == '13']        # 全库情報検索
[q for q in Q if q['year'] == 2020 and q['month'] == 12]               # 某一场考试
[q for q in Q if q['mondai'] == '聴解4']                                # 即時応答
[q for q in Q if q['alt_answer']]                                      # 全库答案分歧题
```

改了 markdown 后跑 `python3 server/scripts/nadou/build_index.py` 重建索引。

## 脚本

都在 [`server/scripts/nadou/`](../server/scripts/nadou/)，抓取类需要登录会话：

```bash
export NADOU_COOKIE='ixunke=<从浏览器 DevTools 复制>'   # 只走环境变量，不要写进文件

python3 server/scripts/nadou/fetch.py            # 抓题目 → raw/（限速，已抓的跳过）
python3 server/scripts/nadou/fetch_audio.py      # 抓听力音频 → audio/
python3 server/scripts/nadou/fetch_images.py     # 抓图片型材料 → images/
python3 server/scripts/nadou/to_markdown.py      # raw → markdown（可重复跑）
python3 server/scripts/nadou/build_index.py      # markdown → index.json
```

mojidict 侧（2025 两套整卷 + 补纳豆缺题）。它是 Parse Server，**不用 cookie**，
token 在 localStorage：

```bash
# 在 test.mojidict.com 的 DevTools Console 里取：
#   JSON.parse(localStorage['Parse/o435nmjFY8O8WxcWbRUM2/currentUser']).sessionToken
export MOJI_TOKEN='r:xxxxxxxx'

python3 server/scripts/nadou/fetch_moji_exam.py    # 2025 整卷（题目+听力原文+整卷音频）
python3 server/scripts/nadou/fetch_moji_patch.py   # 补纳豆缺题 → <部分>.patch.json
python3 server/scripts/nadou/to_markdown.py        # 重跑即自动合并
```

听力音频那两个脚本**不需要 MOJI_TOKEN**（OSS 上是公开对象，raw JSON 和 moji 快照
也都在 git 里，clone 下来就能重跑）：

```bash
# 2025 两套的分段音频（58 段）
python3 server/scripts/nadou/fetch_moji_segments.py --check    # 只报告缺哪些
python3 server/scripts/nadou/fetch_moji_segments.py

# 纳豆 聴解5 的缺口（27 段，靠原文比对确认是同一段）
python3 server/scripts/nadou/fetch_moji_audio_patch.py --check # 只报告匹配结果
python3 server/scripts/nadou/fetch_moji_audio_patch.py

python3 server/scripts/nadou/to_markdown.py                    # 把 - audio: 写进 md
python3 server/scripts/nadou/build_index.py
```

新增年份时改 `fetch_moji_exam.py` 的 `EXAMS` 列表（examId 取自
`test.mojidict.com/paper/<examId>` 的 URL —— 站内没有可用的列表接口，
`Exam` / `ExamV2` 两个 class 明确拒绝 find 权限）。

**mojidict 的字段坑**（都已处理，改脚本时别踩回去）：

- 听力材料的正文在 `subtitle`（日文原文），`title` 是空的；`translation` 是中文译文
- 每个听力材料另有自己的 `mediaId`，即该题的音频片段；整卷 `full.mp3` 在 `exam.mediaId` 上。
  分段已由 `fetch_moji_segments.py` 全部下下来，题库引用的是分段而不是整卷
- 材料的 `subtitle` 里每行带 `data-starttime`，是**相对该分段**的时间戳
  （聴解1-1 分段 94 秒，末行 01:28，对得上），将来要做原文跟读可以直接用
- 情報検索（問題13）材料的正文是 `<MOJiTest_URL>` 占位符，真内容在 `imageId`
- 请求不带 `User-Agent` 会 403
- 大题标题里的「問題N」**不可信** —— 2025.07 第 12、13 个大题标题都写着「問題12」，
  所以問題号按大题位置定（前 13 个笔试、后 5 个听力）

音频 URL 带 `?key=` 签名，失效后重跑 `fetch.py` 刷新 `raw/` 再下。

## 問題号是推断出来的

接口不返回問題号（`kind`/`kindId` 全空、`type` 一律是 `'1'`），只能从结构反推。
规则和依据写在 [`to_markdown.py`](../server/scripts/nadou/to_markdown.py) 的 docstring 里，要点：

| 部分 | 判据 | 可靠度 |
|---|---|---|
| 文字·語彙 | 問題2 题干含（　　）；問題4 题干是单词、选项是长句；問題1 选项全假名 | 29/29 年题数一致 |
| 文法 | 問題7 带 `parentId`；問題6 题干含 ★；其余問題5 | 29/29 年题数一致 |
| 読解 | 問題8 = 每篇 1 题的材料；末尾 4 篇固定 問題10/11/12/13；中间全是問題9 | 不依赖每篇题数，2022.12 改革后仍成立 |
| 聴解 | 問題4 = 3 选项段；問題3 = 其前的连续「占位选项」段（概要理解不印选项）；問題1/2 按标准题数切 | 27/29 年可精确定位 |

**2020.12 与人工整理版逐题比对：mondai 0 处不一致、answer 0 处不一致。**

那份人工整理版（`N1/整理/2020年12月_N1_题库.md`）已从工作区删除 —— 本库覆盖且更全
（它的听力选项全是「原卷选项，缺」，本库有 15 题真选项）。但它是唯一的**独立来源**基准，
改了推断规则后想重跑回归，从 git 里取出来即可，不必恢复文件：

```bash
git show ff2dbf1:"N1/整理/2020年12月_N1_题库.md" > /tmp/baseline.md
# 再与 markdown/2020年12月_N1_题库.md 逐题比对 mondai / answer
```

## 已知数据缺口（源站问题，非抓取失败）

跑 `to_markdown.py` 会重新报出这 4 条：

- **2013.07 阅读（已补齐）** id 10313–10316 在纳豆侧标记 `isExist=0`，只有 id 没有内容
  （单题接口 `/api/question?id=10313` 返回 `errno:1001 题目不存在`）。按接口里
  「材料(type 6) + 它的题(type 1)」的连号规律，缺的是 **問題9 第三篇文章 + 它的 3 道题**
  （该卷 `itemCount=25`，剔除后仅剩 22 题）。
  已从 mojidict 同卷（`examId=1wt6DaECIz`）补入，存于 `raw/2013.07/阅读.patch.json`，
  转换时按原始 id 填回原位，md 中带 `- source: mojidict`。
  **确认是同一套卷子的依据**：mojidict 的問題9 三篇与纳豆现存两篇做文本相似度比对，
  两篇命中 0.965 / 0.966，第三篇对两者都只有 0.03 —— 即纳豆缺的那篇。
- **2011.07 / 2021.07** 問題8 的 4 篇材料在源站题序里不连续（2021.07 甚至排在最末），
  已按「每篇 1 题」特征归组，题号顺序保持源站原样
- **2012.12** 末两篇题数为 問題12=2 题、問題13=4 题（常规是 4/2），源站顺序可能与常规相反

另：听力 問題3 概要理解、問題4 即時応答、問題5 第 1 题的选项在真实试卷上本就不印
（选项由音频念出），源站存的是 `"1"/"2"/"3"` 占位符，**不是数据缺失**。

## 答案分歧（两来源不一致，站点两个都判对）

全库交叉比对（`compare_sources.py`）跑下来，**11 道题两家答案不同**，分布在 8 套卷。
官方答案无从查证，所以两边都不改、也不选边：md 里出 `- alt_answer:`，
网站把 `answer` 和 `alt_answer` 都判作答对，做题人不该为源站的分歧背锅。

| 卷 | 题 | 纳豆 | mojidict |
|---|---|---|---|
| 2010.12 | Q50（読解） | 4 | 3 |
| 2013.07 | Q51（読解） | 4 | 2 |
| 2014.07 | Q22（文字·語彙） | 1 | 2 |
| 2015.12 | Q51（読解） | 3 | 1 |
| 2017.12 | Q37 / Q40（文法） | 4 / 2 | 3 / 3 |
| 2019.07 | Q40（文法） | 2 | 1 |
| 2021.07 | 聴解4-8 / 4-9 / 4-12 | 3 / 2 / 1 | 2 / 3 / 2 |
| 2023.07 | Q37（文法） | 3 | 1 |

只有 2013.07 Q51 写过人工争点说明（原文的「上書き」是否等同选项4 的「置き換わる」），
它会以 `- dispute_note:` 进 md 并显示在网站上；其余 10 道没有 —— 通用话术
（「纳豆=4 / mojidict=2」）由两个答案现算，**不存进数据**，免得多一份要跟着改的副本。

分歧记录在各年月 `raw/<年月>/<部分>.patch.json` 的 `disputes` 段
（`nadou_answer` / `external_answer` / `match_sim`）。重跑 `compare_sources.py` 会
按 id 合并、不覆盖已有条目，所以手写的 `note` 不会被冲掉；新增争点说明直接往那里加 `note` 即可。

网站标称「31 套 3215 道」，索引接口实际只返回 29 套；差的 2 套是 2025 年的，尚未上架。
