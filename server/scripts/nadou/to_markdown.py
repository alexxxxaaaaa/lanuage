#!/usr/bin/env python3
"""
把 n1-qbank/raw/<年月>/*.json 转成题库 markdown，格式对齐 server/scripts/importExam.ts
的解析契约（`## Q<n>` 块 + `### 文章 P<code>` 块 + `- key: value` 字段）。

用法：
    python3 to_markdown.py                 # 转换全部年月
    python3 to_markdown.py --only 2020.12
    python3 to_markdown.py --check         # 只跑结构校验，不写文件

問題号推断规则（接口不返回 kind/kindId，type 一律是 '1'，只能从结构反推；
已用 2020.12 的人工整理版逐条校验：mondai / answer 各 0 处不一致）：

  文字·語彙  問題2 = 题干含全角括号（　　）；問題4 = 题干仅一个词且选项是长句；
             其余按顺序分到問題1（选项全假名）/ 問題3。29/29 年题数一致。
  文法      問題7 = 带 parentId（共用一篇文章）；問題6 = 题干含 ★；其余 = 問題5。
             29/29 年题数一致。
  読解      問題8 = 每篇只有 1 题的材料（标准 4 篇）；末尾 4 篇固定是問題10/11/12/13；
             中间全部是問題9。不依赖每篇题数 —— 2022.12 改革后問題9 由 3篇×3题
             变成 4篇×2题，写死题数的规则会整段错位。
             另有两处按题数纠偏：問題8 材料在源站不连续时退回「全局单题材料」；
             問題12(3–4题)/問題13(2题) 顺序放反时按题数改判。
  聴解      問題4 = 选项只有 3 个的连续段（唯一 3 选项题型，精确）；問題5 = 其后剩余；
             問題3 = 問題4 之前的连续「占位选项」段（概要理解在真卷上不印选项，
             27/29 年可精确定位）；問題1/2 按 SPLIT_12 的标准题数切。

読解题输出前会按問題号重排，因为源站个别年份题序错乱（2011.07 / 2021.07 的
問題8 材料排在最末），重排后 Q 编号与原卷 問題8→13 顺序一致。
"""
import argparse
import html
import json
import os
import re
import sys
from collections import OrderedDict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
RAW = os.path.join(ROOT, "n1-qbank", "raw")
OUT = os.path.join(ROOT, "n1-qbank", "markdown")

SECTIONS = ["词汇", "语法", "阅读", "听力"]
SEC_NAME = {"词汇": "文字·語彙", "语法": "文法", "阅读": "読解", "听力": "聴解"}

TYPE_BY_MONDAI = {
    "1": "漢字読み", "2": "文脈規定", "3": "言い換え類義", "4": "用法",
    "5": "文法形式の判断", "6": "文の組み立て（句子重组·星标★）", "7": "文章の文法（文章语法·完形）",
    "8": "内容理解（短文）", "9": "内容理解（中文）", "10": "内容理解（長文）",
    "11": "統合理解", "12": "主張理解（長文）", "13": "情報検索",
    "聴解1": "課題理解", "聴解2": "ポイント理解", "聴解3": "概要理解",
    "聴解4": "即時応答", "聴解5": "統合理解",
}
# 聴解 問題1/2/3 的题数无法从数据结构区分（都是 4 选项、时长重叠），按标准配置切。
# 个别年份不同的，在这里按 "YYYY.MM" 覆盖。
LISTENING_SPLIT_DEFAULT = (6, 7, 6)
LISTENING_SPLIT = {}


# ---------- HTML → 文本 ----------

IMG_TAG = re.compile(r'<img[^>]*\bsrc="([^"]+)"[^>]*>', re.I)
_CUR_YM = ""  # build() 期间的年月，供 to_text 生成图片的本地相对路径


def img_local(url: str, ym: str) -> str:
    """远端图片 → 仓库内相对路径。命名规则与 fetch_images.py 必须一致。"""
    name = url.split("/")[-1].split("?")[0]
    return f"images/{ym}/{name}"


def to_text(s: str, keep_para: bool = False) -> str:
    """去标签。下划线/加粗转 **强调**，<img> 转 markdown 图片；keep_para 时段落保留换行。"""
    if not s:
        return ""
    # 情報検索（問題13）等材料整篇就是一张表格图，去标签会变空 —— 必须先转成图片语法
    s = IMG_TAG.sub(lambda m: f"\n![]({img_local(m.group(1), _CUR_YM)})\n", s)
    s = re.sub(r"<u[^>]*>(.*?)</u>", r"**\1**", s, flags=re.S | re.I)
    s = re.sub(
        r'<span[^>]*text-decoration\s*:\s*underline[^>]*>(.*?)</span>',
        r"**\1**", s, flags=re.S | re.I,
    )
    s = re.sub(r"<(b|strong)[^>]*>(.*?)</\1>", r"**\2**", s, flags=re.S | re.I)
    s = re.sub(r"<br\s*/?>", "\n", s, flags=re.I)
    s = re.sub(r"</p\s*>", "\n", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s)
    s = s.replace("　", " ").replace("\xa0", " ")
    s = re.sub(r"\*\*\s*\*\*", "", s)          # 空强调
    lines = [ln.strip() for ln in s.split("\n")]
    if keep_para:
        out, blank = [], False
        for ln in lines:
            if ln:
                out.append(ln); blank = False
            elif not blank and out:
                out.append(""); blank = True
        return "\n".join(out).strip()
    return re.sub(r"\s+", " ", " ".join(x for x in lines if x)).strip()


def split_analysis(a: str) -> tuple[str, str]:
    """纳豆的 analysis：第一段是设问/题干的中文翻译，其余是逐选项解析。"""
    if not a:
        return "", ""
    paras = [p for p in (to_text(x) for x in re.split(r"</p\s*>|<br\s*/?>", a, flags=re.I)) if p]
    if not paras:
        return "", ""
    return paras[0], " ".join(paras[1:]).strip()


def answer_of(q: dict) -> int:
    """接口的 answer 是 0-based 下标数组；md 里用 1-based。多选时用 + 连接。"""
    a = q.get("answer") or []
    if not isinstance(a, list) or not a:
        return 0
    try:
        return int(a[0]) + 1
    except (TypeError, ValueError):
        return 0


# ---------- 問題号推断 ----------

FULLWIDTH_PAREN = re.compile(r"[（(][\s　]*[）)]")
KANA_ONLY = re.compile(r"^[぀-ヿー\s]+$")


def classify_vocab(qs: list) -> list:
    """文字·語彙 → 問題1/2/3/4"""
    feats = []
    for q in qs:
        stem = to_text(q["stem"])
        opts = [to_text(o) for o in q["options"]]
        avg = sum(len(o) for o in opts) / max(len(opts), 1)
        feats.append({
            "paren": bool(FULLWIDTH_PAREN.search(stem)),
            "usage": len(stem) <= 6 and avg > 12,          # 問題4：题干是词、选项是句
            "kana": bool(opts) and all(KANA_ONLY.match(o) for o in opts),
        })
    n = len(qs)
    # 問題4 从第一个 usage 特征开始，到结尾
    i4 = next((i for i, f in enumerate(feats) if f["usage"]), n)
    # 問題2 是含括号的连续段
    parens = [i for i, f in enumerate(feats[:i4]) if f["paren"]]
    i2, e2 = (parens[0], parens[-1] + 1) if parens else (0, 0)
    out = []
    for i in range(n):
        if i >= i4:
            out.append("4")
        elif i2 <= i < e2:
            out.append("2")
        elif i < i2:
            out.append("1")
        else:
            out.append("3")
    return out


def mondai_of(qs: list):
    """mojidict 抓来的卷子按大题组织，問題号是结构自带的（_mondai），直接用，
    不必走下面那套为纳豆写的特征反推。全部题都带才算数，否则返回 None。"""
    if qs and all(q.get("_mondai") for q in qs):
        return [q["_mondai"] for q in qs]
    return None


def reading_from_mondai(qs: list) -> tuple[list, dict, str]:
    """已知 _mondai 时的読解分组：按 parentId 归materialitem，编号规则与反推版一致。"""
    mat_info, seen = {}, {}
    for q in qs:
        pid = q.get("parentId") or 0
        if pid in mat_info:
            continue
        m = q["_mondai"]
        seen[m] = seen.get(m, 0) + 1
        i = seen[m]
        if m == "8":
            code = f"P8-{i}"
        elif m == "9":
            code = f"P9-{chr(ord('a') + i - 1)}"
        elif m == "11" and i > 1:
            code = f"P11-{'AB'[min(i - 1, 1)]}"
        else:
            code = f"P{m}"
        mat_info[pid] = (m, code)
    return [q["_mondai"] for q in qs], mat_info, ""


def classify_grammar(qs: list) -> list:
    out = []
    for q in qs:
        if q.get("parentId"):
            out.append("7")
        elif "★" in to_text(q["stem"]):
            out.append("6")
        else:
            out.append("5")
    return out


def classify_reading(qs: list, materials: list) -> tuple[list, dict]:
    """按材料出现顺序分組 → 問題8..13；返回 (每题 mondai, 材料id→(mondai, 文章编号))"""
    order, counts = [], {}
    for q in qs:
        pid = q.get("parentId") or 0
        if pid not in counts:
            counts[pid] = 0
            order.append(pid)
        counts[pid] += 1

    groups = [(pid, counts[pid]) for pid in order]
    n = len(groups)
    warn = ""

    # 問題8 = 每篇只有 1 题的材料（标准 4 篇）。正常情况它们连在开头，但源站个别
    # 年份题序错乱（2011.07、2021.07），此时退回「全局所有单题材料」并报警。
    head = 0
    while head < n and groups[head][1] == 1:
        head += 1
    singles = [i for i, (_, c) in enumerate(groups) if c == 1]
    if head == 4:
        idx8 = set(range(4))
    elif len(singles) == 4:
        idx8 = set(singles)
        warn = f"問題8 的 4 篇材料在源站不连续（位置 {singles}），已按单题特征归组"
    else:
        idx8 = set(range(head))
        warn = f"問題8 篇数异常（开头连续单题 {head} 篇、全卷单题 {len(singles)} 篇）"

    # 末尾 4 篇固定是問題10/11/12/13（各 1 篇），中间全部是問題9。
    # 这个约束不依赖每篇题数 —— 2022.12 改革后問題9 由 3篇×3题 变成 4篇×2题。
    rest = [i for i in range(n) if i not in idx8]
    n9 = len(rest) - 4
    if n9 < 0:
        warn = f"{warn}；" if warn else ""
        warn += f"読解材料仅 {n} 篇，不足以切出問題9–13"
        n9 = max(len(rest), 0)

    mat_info, c8, c9 = {}, 0, 0
    for idx, (pid, _) in enumerate(groups):
        if idx in idx8:
            c8 += 1
            mondai, code = "8", f"P8-{c8}"
        elif rest.index(idx) < n9:
            mondai, code = "9", f"P9-{chr(ord('a') + c9)}"
            c9 += 1
        else:
            m = 10 + rest.index(idx) - n9
            mondai, code = str(m), f"P{m}"
        mat_info[pid] = (mondai, code)

    # 問題12 主張理解固定 3–4 题、問題13 情報検索固定 2 题。源站个别年份（2012.12）
    # 把这两篇的先后放反了 —— 按题数纠正，比照位置硬套可靠。
    p12 = [pid for pid, (m, _) in mat_info.items() if m == "12"]
    p13 = [pid for pid, (m, _) in mat_info.items() if m == "13"]
    if len(p12) == 1 and len(p13) == 1:
        c12, c13 = counts[p12[0]], counts[p13[0]]
        if c12 <= 2 < c13:
            mat_info[p12[0]] = ("13", "P13")
            mat_info[p13[0]] = ("12", "P12")
            warn = (warn + "；" if warn else "") + (
                f"源站末两篇顺序与常规相反（{c12}题 在 {c13}题 之前），已按题数改判为 問題13→問題12"
            )

    return [mat_info.get(q.get("parentId") or 0, ("?", ""))[0] for q in qs], mat_info, warn


def is_placeholder(q: dict) -> bool:
    """真实试卷上不印选项的题（問題3 概要理解、問題4 即時応答、問題5 第1题），
    接口里的 options 是 "1"/"2"/"3" 之类的占位符。"""
    opts = [to_text(o) for o in (q.get("options") or [])]
    return bool(opts) and max(len(o) for o in opts) <= 2


# 問題1+2 的总题数 → (問題1, 問題2)，JLPT 的标准配置
SPLIT_12 = {13: (6, 7), 12: (6, 6), 11: (5, 6), 10: (5, 5), 9: (4, 5)}
# 兜底：問題1+2+3 总数 → (問題1, 問題2, 問題3)
SPLIT_123 = {19: (6, 7, 6), 18: (6, 6, 6), 17: (6, 6, 5), 16: (5, 6, 5), 15: (5, 5, 5)}


def classify_listening(qs: list, ym: str) -> list:
    """聴解1..5。

    問題4 = 选项只有 3 个的连续段（唯一 3 选项题型，精确）
    問題5 = 問題4 之后的剩余题（精确）
    問題3 = 問題4 之前那段连续的「占位选项」题（概要理解不印选项，精确）
    問題1/2 = 剩下的按标准题数切（无结构信号可用）
    """
    n = len(qs)
    three = [i for i, q in enumerate(qs) if len(q.get("options") or []) == 3]
    i4, e4 = (three[0], three[-1] + 1) if three else (n, n)

    if ym in LISTENING_SPLIT:
        a, b, c = LISTENING_SPLIT[ym]
    else:
        # 問題3：从 問題4 前一题往回数连续占位段
        s3 = i4
        while s3 - 1 >= 0 and is_placeholder(qs[s3 - 1]):
            s3 -= 1
        n12 = s3
        if 0 < n12 and n12 in SPLIT_12:
            a, b = SPLIT_12[n12]
            c = i4 - n12
        else:
            # 整卷选项都占位（个别年份录入如此），退回按总数切
            a, b, c = SPLIT_123.get(i4, (i4 // 3, i4 - 2 * (i4 // 3), i4 // 3))

    out = []
    for i in range(n):
        if i4 <= i < e4:
            out.append("聴解4")
        elif i >= e4:
            out.append("聴解5")
        elif i < a:
            out.append("聴解1")
        elif i < a + b:
            out.append("聴解2")
        else:
            out.append("聴解3")
    return out


# ---------- 渲染 ----------

def render_question(seq: str, fields: "OrderedDict[str, str]", options: list) -> str:
    lines = [f"## {seq}"]
    for k, v in fields.items():
        if k == "options":
            lines.append("- options:")
            lines.extend(f"  {i + 1}. {o}" for i, o in enumerate(options))
        else:
            lines.append(f"- {k}: {v}")
    return "\n".join(lines)


def add_dispute(f, d, q):
    """答案分歧标注。三个部分（笔试/読解/聴解）都要挂 —— 分歧不止出现在読解。"""
    dp = (d.get("_disputes") or {}).get(q.get("id"))
    if dp:
        f["dispute"] = (
            f"纳豆={dp['nadou_answer']} / {dp['external_source']}={dp['external_answer']}"
            "（两来源答案不同，以官方答案为准）"
        )


def build(ym: str, data: dict) -> tuple[str, dict]:
    global _CUR_YM
    _CUR_YM = ym
    year, month = ym.split(".")
    parts, stats = [], {"questions": 0, "passages": 0, "bad_answer": [], "missing": [], "dropped": []}
    for name, d in data.items():
        for qid in d.get("_dropped") or []:
            stats["dropped"].append(f"{name}#{qid}")
        for qid in d.get("_patched") or []:
            stats.setdefault("patched", []).append(f"{name}#{qid}")

    parts.append(f"# 日语 N1 真题题库 · {year}年{int(month)}月\n")
    parts.append(
        f"> 来源：{year}年{int(month)}月 JLPT N1（题干·选项·答案·中文翻译·解析）\n"
        f"> 结构：每题一个 `## Q<题号>` 块，字段 section / mondai / type / stem_jp / options / answer / stem_zh / explain。\n"
        f"> 阅读题（問題8–13）文章统一为 `### 文章 P<编号>` 块，题目用 `- passage: P<编号>` 引用。\n"
        f"> 听力题为 `## 聴解<小节>-<题号>` 块，音频地址见 `- audio:` 字段。\n"
    )
    parts.append("\n---\n")

    qno = 0  # 笔试部分连续编号 Q1..Qn

    # ---- 文字·語彙 / 文法 ----
    for name, head in (("词汇", "一、言語知識（文字・語彙）"), ("语法", "二、言語知識（文法）")):
        d = data.get(name)
        if not d:
            stats["missing"].append(name)
            continue
        qs = d["questions"]
        mondais = mondai_of(qs) or (classify_vocab(qs) if name == "词汇" else classify_grammar(qs))
        rng = f"問題{mondais[0]}–{mondais[-1]}  Q{qno + 1}–Q{qno + len(qs)}"
        parts.append(f"\n## {head}  {rng}\n")

        # 語法 問題7 的共用文章
        for m in d.get("materialItems") or []:
            body = to_text(m["stem"], keep_para=True)
            if body:
                parts.append(f"\n### 文章 P7（文章の文法）\n\n{body}\n")
                stats["passages"] += 1

        for q, mondai in zip(qs, mondais):
            qno += 1
            zh, ex = split_analysis(q.get("analysis"))
            ans = answer_of(q)
            if not 1 <= ans <= len(q["options"]):
                stats["bad_answer"].append(f"Q{qno}")
            f = OrderedDict()
            f["section"] = SEC_NAME[name]
            f["mondai"] = mondai
            f["type"] = TYPE_BY_MONDAI.get(mondai, "")
            f["stem_jp"] = to_text(q["stem"])
            f["options"] = None
            f["answer"] = str(ans)
            f["stem_zh"] = zh
            f["explain"] = ex
            if q.get("parentId"):
                f["passage"] = "P7"
            add_dispute(f, d, q)
            parts.append("\n" + render_question(f"Q{qno}", f, [to_text(o) for o in q["options"]]) + "\n")
            stats["questions"] += 1

    # ---- 読解 ----
    d = data.get("阅读")
    if d:
        qs = d["questions"]
        if mondai_of(qs):
            mondais, mat_info, warn = reading_from_mondai(qs)
        else:
            mondais, mat_info, warn = classify_reading(qs, d.get("materialItems") or [])
        if warn:
            stats["reading_warn"] = warn
        # 源站个别年份题序错乱（2011.07 / 2021.07 的問題8 材料排在最末），按問題号重排，
        # 让 Q 编号与原卷 問題8→13 的顺序一致；同一問題内保持源站原顺序。
        paired = sorted(enumerate(zip(qs, mondais)), key=lambda x: (int(x[1][1]), x[0]))
        qs = [p[1][0] for p in paired]
        mondais = [p[1][1] for p in paired]
        parts.append(f"\n## 三、読解  問題8–13  Q{qno + 1}–Q{qno + len(qs)}\n")
        mats = {m["id"]: m for m in (d.get("materialItems") or [])}
        emitted = set()
        for q, mondai in zip(qs, mondais):
            pid = q.get("parentId") or 0
            if pid in mat_info and pid not in emitted:
                emitted.add(pid)
                _, code = mat_info[pid]
                mat = mats.get(pid) or {}
                body = to_text(mat.get("stem", ""), keep_para=True)
                src = f"（来源：{mat['_source']}）" if mat.get("_source") else ""
                parts.append(f"\n### 文章 {code}（{TYPE_BY_MONDAI.get(mondai, '')}）{src}\n\n{body}\n")
                stats["passages"] += 1
            qno += 1
            zh, ex = split_analysis(q.get("analysis"))
            ans = answer_of(q)
            if not 1 <= ans <= len(q["options"]):
                stats["bad_answer"].append(f"Q{qno}")
            f = OrderedDict()
            f["section"] = "読解"
            f["mondai"] = mondai
            f["type"] = TYPE_BY_MONDAI.get(mondai, "")
            f["stem_jp"] = to_text(q["stem"])
            f["options"] = None
            f["answer"] = str(ans)
            f["stem_zh"] = zh
            f["explain"] = ex
            if pid in mat_info:
                f["passage"] = mat_info[pid][1]
            # 从别处补来的题标出来源，免得日后分不清哪几题不是纳豆的
            if q.get("_source"):
                f["source"] = q["_source"]
            add_dispute(f, d, q)
            parts.append("\n" + render_question(f"Q{qno}", f, [to_text(o) for o in q["options"]]) + "\n")
            stats["questions"] += 1
    else:
        stats["missing"].append("阅读")

    # ---- 聴解 ----
    d = data.get("听力")
    if d:
        qs = d["questions"]
        mondais = mondai_of(qs) or classify_listening(qs, ym)
        parts.append("\n## 四、聴解  聴解1–5\n")
        whole = (d.get("paper") or {}).get("audioUrl") or ""
        if whole:
            parts.append(f"\n> 整卷听力音频：`{whole}`（本卷音频为整卷一个文件，非每题一段）\n")
        # 听力原文：mojidict 的听力材料把日文原文放在 subtitle、译文放在 translation。
        # 原文有几百字，塞进单行 `- key: value` 会破坏 importExam.ts 的解析契约，
        # 所以和阅读一样走文章块，题用 passage 引用。
        lmats = {m["id"]: m for m in (d.get("materialItems") or [])}
        emitted_l, emitted_codes = set(), {}
        cur, sub = None, 0
        for q, mondai in zip(qs, mondais):
            if mondai != cur:
                cur, sub = mondai, 0
                parts.append(f"\n### {mondai}（{TYPE_BY_MONDAI.get(mondai, '')}）\n")
            sub += 1
            pid = q.get("parentId") or 0
            mat = lmats.get(pid)
            pcode = ""
            if mat and (to_text(mat.get("subtitle")) or to_text(mat.get("translation"))):
                pcode = f"PL{mondai.replace('聴解', '')}-{sub}"
                if pid not in emitted_l:
                    emitted_l.add(pid)
                    emitted_codes[pid] = pcode
                    script = to_text(mat.get("subtitle"), keep_para=True)
                    zh = to_text(mat.get("translation"), keep_para=True)
                    body = script
                    if zh:
                        body = f"{body}\n\n【中文译文】\n{zh}" if body else f"【中文译文】\n{zh}"
                    parts.append(f"\n### 文章 {pcode}（{TYPE_BY_MONDAI.get(mondai, '')}·聴解原文）\n\n{body}\n")
                    stats["passages"] += 1
                else:
                    # 同一段音频被多题共用（聴解5 的 質問1/質問2），指回首次输出的编号
                    pcode = next(c for i, c in emitted_codes.items() if i == pid)
            zh, ex = split_analysis(q.get("analysis"))
            ans = answer_of(q)
            seq = f"{mondai}-{sub}"
            if not 1 <= ans <= len(q["options"]):
                stats["bad_answer"].append(seq)
            media = (q.get("stemMedia") or {}).get("mediaUri") or ""
            f = OrderedDict()
            f["section"] = "聴解"
            f["listening"] = mondai
            f["mondai_no"] = str(sub)
            f["type"] = TYPE_BY_MONDAI.get(mondai, "")
            f["stem_jp"] = to_text(q["stem"])
            f["options"] = None
            f["answer"] = str(ans)
            f["stem_zh"] = zh
            f["explain"] = ex
            if media:
                f["audio"] = f"audio/{ym}/{seq}.mp3"
            if pcode:
                f["passage"] = pcode
            add_dispute(f, d, q)
            parts.append("\n" + render_question(seq, f, [to_text(o) for o in q["options"]]) + "\n")
            stats["questions"] += 1
    else:
        stats["missing"].append("听力")

    return "\n".join(parts).replace("\n\n\n", "\n\n") + "\n", stats


def load_ym(ym: str) -> dict:
    """读取一个年月的四份原始 JSON。纳豆侧已下架的题（isExist=0）只有 id、没有
    题干选项，这里剔除掉并记在 _dropped 上，由调用方汇报。

    若同目录存在 <部分>.patch.json（fetch_moji_patch.py 从别的来源补的缺题），
    按 id 合并进来：能填回原位的按 id 替换，其余追加。补来的条目带 _source。"""
    d = {}
    for name in SECTIONS:
        p = os.path.join(RAW, ym, f"{name}.json")
        if not os.path.exists(p):
            continue
        with open(p, encoding="utf-8") as f:
            j = json.load(f)
        qs = j.get("questions") or []
        alive = [q for q in qs if q.get("isExist", 1) and "stem" in q]
        dropped = [q for q in qs if q not in alive]

        patch_path = os.path.join(RAW, ym, f"{name}.patch.json")
        patched = []
        if os.path.exists(patch_path):
            with open(patch_path, encoding="utf-8") as f:
                patch = json.load(f)
            by_id = {q.get("id"): q for q in patch.get("questions") or []}
            # 按原始 id 插回被删的位置，保持卷内顺序
            merged = []
            for q in qs:
                if q in alive:
                    merged.append(q)
                elif q.get("id") in by_id:
                    merged.append(by_id.pop(q["id"]))
                    patched.append(q["id"])
            merged.extend(by_id.values())          # 原卷里没有对应壳的，追加到末尾
            patched.extend(by_id)
            alive = merged
            j["_disputes"] = {d["id"]: d for d in patch.get("disputes") or []}
            # 交叉比对择优的结果（compare_sources.py 生成）。raw 保持原始快照不动，
            # 覆盖只发生在这里，改了什么、为什么改都在 patch 里可查、可回滚。
            ov = {}
            for o in patch.get("overrides") or []:
                ov.setdefault(o["id"], []).append(o)
            if ov:
                for q in qs:
                    for o in ov.get(q.get("id"), []):
                        q[o["field"]] = o["value"]
                        q.setdefault("_overridden", []).append(o["field"])
                j["_overrides"] = sum(len(v) for v in ov.values())
            pmats = patch.get("materialItems") or []
            j["materialItems"] = (j.get("materialItems") or []) + pmats
            # 被删条目里如果是「材料」，patch 走 materialItems 补，同样算已补
            done = set(patched) | {m.get("id") for m in pmats}
            patched.extend(m["id"] for m in pmats if m.get("id") in {q.get("id") for q in dropped})
            dropped = [q for q in dropped if q.get("id") not in done]

        j["_dropped"] = [q.get("id") for q in dropped]
        j["_patched"] = patched
        j["questions"] = alive
        d[name] = j
    return d


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="只转某年月，如 2020.12")
    ap.add_argument("--check", action="store_true", help="只校验不写文件")
    args = ap.parse_args()

    yms = sorted(x for x in os.listdir(RAW) if os.path.isdir(os.path.join(RAW, x)))
    if args.only:
        yms = [x for x in yms if x == args.only]
    if not yms:
        sys.exit("没有可转换的原始数据，先跑 fetch.py")

    os.makedirs(OUT, exist_ok=True)
    total_q = total_p = 0
    problems = []
    for ym in yms:
        data = load_ym(ym)
        if not data:
            continue
        md, st = build(ym, data)
        year, month = ym.split(".")
        out = os.path.join(OUT, f"{year}年{int(month):02d}月_N1_题库.md")
        if not args.check:
            with open(out, "w", encoding="utf-8") as f:
                f.write(md)
        total_q += st["questions"]
        total_p += st["passages"]
        flag = ""
        if st["missing"]:
            flag += f" ⚠缺{'/'.join(st['missing'])}"
            problems.append(f"{ym} 缺 {st['missing']}")
        if st["bad_answer"]:
            flag += f" ⚠答案异常 {len(st['bad_answer'])} 题"
            problems.append(f"{ym} 答案异常: {st['bad_answer'][:8]}")
        if st["dropped"]:
            flag += f" ⚠源站已下架 {len(st['dropped'])} 条"
            problems.append(
                f"{ym} 源站已下架(isExist=0，仅有 id): {st['dropped']}"
                "；按接口的「材料+其题」连号规律，其中通常含 1 篇文章")
        if st.get("patched"):
            flag += f" ✚补入 {len(st['patched'])} 条"
            problems.append(f"{ym} 已从外部来源补入: {st['patched']}（md 里带 source 字段）")
        if st.get("reading_warn"):
            flag += " ⚠読解分组"
            problems.append(f"{ym} {st['reading_warn']}")
        print(f"  {ym}: {st['questions']:3d} 题, {st['passages']:2d} 篇文章{flag}")

    print(f"\n合计 {total_q} 题 / {total_p} 篇文章，{len(yms)} 个年月")
    if problems:
        print("\n需要人工确认：")
        for p in problems:
            print("  -", p)
    if not args.check:
        print(f"\n输出目录：{os.path.relpath(OUT, ROOT)}/")


if __name__ == "__main__":
    main()
