# N1 真题题库（nadou.net qbank 103）

2010.07–2025.12 共 **31 套** JLPT N1 真题，**3207 题**、**437 篇**文章（阅读材料 379 + 听力原文 58），
含题干、选项、答案、中文翻译、逐选项解析。仅供自建站个人学习使用。

数据主体来自 nadou.net 题库 103（2010.07–2024.12，29 套）；**2025.07 / 2025.12 两套来自 mojidict**
（纳豆题库没有）。另有 3 题 + 1 篇文章因纳豆源站已删除，也从 mojidict 同卷补入。
凡非纳豆来源的条目，md 里都带 `- source: mojidict` 字段。

两个来源的听力形态不同，接入时要区分：

| | 纳豆（2010–2024） | mojidict（2025） |
|---|---|---|
| 听力音频 | **每题一个 mp3** → `audio/<年月>/聴解N-M.mp3` | **整卷一个 mp3** → `audio/<年月>/full.mp3` |
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
├── audio/                   听力音频，每题一个 mp3（**不入 git**，见 .gitignore）
│   └── <年月>/<聴解N-M>.mp3
└── index.json               筛选索引，仅元数据不含正文（入 git，881 KB）
```

音频不入 git 的原因与 `client/public/exam-media` 一致：单文件超限、体积大，走 R2 托管。

## markdown 格式

与 [`server/scripts/importExam.ts`](../server/scripts/importExam.ts) 的解析契约完全一致，
可直接 `npm run import:exam -- --file ...` 导入 `ExamPaper`/`ExamPassage`/`ExamQuestion`。

```markdown
## Q1                          ← 笔试题；听力题是 ## 聴解1-1
- section: 文字·語彙            ← 文字·語彙 / 文法 / 読解 / 聴解
- mondai: 1                    ← 問題号 1–13；听力用 listening + mondai_no
- type: 漢字読み
- stem_jp: …**強調語**…        ← 原文的下划线/加粗转成 **
- options:
  1. …
- answer: 2                    ← 1-based（接口是 0-based，转换时已 +1）
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
answer / passage / audio`，四个维度都能直接筛：

```python
import json
Q = json.load(open('n1-qbank/index.json'))['questions']
[q for q in Q if q['section'] == '読解' and q['mondai'] == '13']        # 全库情報検索
[q for q in Q if q['year'] == 2020 and q['month'] == 12]               # 某一场考试
[q for q in Q if q['mondai'] == '聴解4']                                # 即時応答
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

新增年份时改 `fetch_moji_exam.py` 的 `EXAMS` 列表（examId 取自
`test.mojidict.com/paper/<examId>` 的 URL —— 站内没有可用的列表接口，
`Exam` / `ExamV2` 两个 class 明确拒绝 find 权限）。

**mojidict 的字段坑**（都已处理，改脚本时别踩回去）：

- 听力材料的正文在 `subtitle`（日文原文），`title` 是空的；`translation` 是中文译文
- 每个听力材料另有自己的 `mediaId`，即该题的音频片段（当前只下了整卷 `full.mp3`，
  分段音频的地址在 raw JSON 里，需要时可再下）
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

## 答案分歧（两来源不一致，需以官方答案为准）

补 2013.07 时顺带用 mojidict 校准了答案基准（两家同为 0-based），6 道重叠题里 5 题吻合，
剩 1 题两家答案不同，已在 md 中以 `- dispute:` 字段标出：

| 题 | 纳豆 | mojidict | 备注 |
|---|---|---|---|
| 2013.07 問題9 第(1)篇第2题（纳豆 id 10307） | 4 | 2 | 争点在原文的「上書き」是否等同选项4 的「置き換わる」 |

分歧记录在 `raw/2013.07/阅读.patch.json` 的 `disputes` 段，新增分歧照此格式追加即可。

网站标称「31 套 3215 道」，索引接口实际只返回 29 套；差的 2 套是 2025 年的，尚未上架。
