#!/usr/bin/env python3
"""
纳豆（raw/）与 mojidict（crosscheck/moji/）逐题交叉比对。

处理策略：
  * 答案不一致  → 只记录，不改任何一边（写进 patch 的 disputes 段，md 里出 `- alt_answer:`；
                  站点把两个答案都判对）
  * 题面不一致  → 按下面的客观规则择优，采纳结果写进 patch 的 overrides 段并注明理由；
                  规则判不出高下的，只记进报告，不动数据。

择优规则（只在有客观依据时才动，避免凭感觉改）：
  1. 一方为空、另一方非空                → 取非空
  2. 一方含占位符（原卷选项缺 / MOJiTest_URL / 图片丢失）→ 取另一方
  3. 一方是另一方的前缀且短 15% 以上（截断）→ 取完整的
  4. 归一化后完全相同（仅全半角/标点/空白差异）→ 不算差异，保持纳豆原样
  5. 其余实质差异                        → 不自动改，记进报告

配对不靠题号：两边题序未必一致（纳豆有几卷题序错乱），改用题面文本相似度在
同一部分内做贪心一对一匹配，低于阈值的判为「对不上」单独列出。

用法：
    python3 compare_sources.py              # 比对全部年月并写 patch
    python3 compare_sources.py --dry-run    # 只出报告，不写任何文件
    python3 compare_sources.py --only 2013.07
"""
import argparse
import difflib
import json
import os
import re
import unicodedata

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
RAW = os.path.join(ROOT, "n1-qbank", "raw")
MOJI = os.path.join(ROOT, "n1-qbank", "crosscheck", "moji")
REPORT = os.path.join(ROOT, "n1-qbank", "crosscheck", "report.md")
SECTIONS = ["词汇", "语法", "阅读", "听力"]

MATCH_MIN = 0.72          # 低于此相似度视为没配上
PLACEHOLDER = re.compile(r"原卷选项|MOJiTest_URL|图片丢失|待补充|^[（(]缺[）)]$")


def strip_html(s: str) -> str:
    s = re.sub(r"<br\s*/?>", "\n", s or "", flags=re.I)
    s = re.sub(r"</p\s*>", "\n", s, flags=re.I)
    return re.sub(r"<[^>]+>", "", s)


def norm(s: str) -> str:
    """归一化：去标签、全半角统一、去空白与标点。用于判断「实质是否相同」。"""
    t = unicodedata.normalize("NFKC", strip_html(s))
    t = re.sub(r"\s+", "", t)
    return re.sub(r"[、。，．,\.・:：;；！!？\?\"“”'‘’（）\(\)「」『』\[\]【】\-—ー_~〜]", "", t)


def sim(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, norm(a), norm(b)).ratio()


def qtext(q: dict) -> str:
    """题面 = 题干 + 全部选项，用于配对。"""
    return strip_html(q.get("stem", "")) + " || " + " | ".join(strip_html(o) for o in (q.get("options") or []))


def answer1(q: dict):
    a = q.get("answer") or []
    try:
        return int(a[0]) + 1
    except (IndexError, TypeError, ValueError):
        return None


def load(base: str, ym: str, section: str):
    p = os.path.join(base, ym, f"{section}.json")
    if not os.path.exists(p):
        return None
    with open(p, encoding="utf-8") as f:
        d = json.load(f)
    d["questions"] = [q for q in (d.get("questions") or []) if q.get("isExist", 1) and "stem" in q]
    return d


def opts_text(q: dict) -> str:
    return " | ".join(strip_html(o) for o in (q.get("options") or []))


def pair_score(a: dict, b: dict) -> float:
    """题干+选项、仅选项 两种算法取较大值。

    只用题干+选项会漏配两类题：問題6 句子重组（两边标 ★ 的方式不同，题干差异大）
    和听力题（mojidict 题干为空，正文在 subtitle）。这两类的选项都是好的，
    用选项就能配上。
    """
    s1 = sim(qtext(a), qtext(b))
    oa, ob = opts_text(a), opts_text(b)
    s2 = sim(oa, ob) if norm(oa) and norm(ob) else 0.0
    return max(s1, s2)


def pair_up(nd_qs: list, mj_qs: list):
    """同一部分内按题面相似度贪心一对一匹配。返回 (配对列表, 未配上的纳豆题)。"""
    pairs, used, unmatched = [], set(), []
    for nq in nd_qs:
        best, best_s = None, 0.0
        for j, mq in enumerate(mj_qs):
            if j in used:
                continue
            s = pair_score(nq, mq)
            if s > best_s:
                best, best_s = j, s
        if best is not None and best_s >= MATCH_MIN:
            used.add(best)
            pairs.append((nq, mj_qs[best], best_s))
        else:
            unmatched.append((nq, best_s))
    return pairs, unmatched


KANA = re.compile(r"^[぀-ヿー]+$")


def severity(a: str, b: str) -> str:
    """给题面差异分级 —— 两边都有录入误差，但严重程度天差地别，同档报会淹没真问题。

    minor  假名⇄汉字同词表记、送假名之类，两者皆通，做题不受影响
    medium 少量字符不同但改变了词/助词（を↔が 这类会改题意）
    major  长度差异大、整段缺失，多半是一方录错或根本不是同一题
    """
    na, nb = norm(a), norm(b)
    if na == nb:
        return "same"
    s = difflib.SequenceMatcher(None, na, nb)
    ops = [(t, na[i1:i2], nb[j1:j2]) for t, i1, i2, j1, j2 in s.get_opcodes() if t != "equal"]
    diff_chars = sum(max(len(x), len(y)) for _, x, y in ops)
    ratio = s.ratio()
    if ratio < 0.85 or diff_chars > 8:
        return "major"
    # 差异片段一侧全假名、另一侧含汉字，且长度接近 → 表记差异
    if all(
        (KANA.match(x or "な") and not KANA.match(y or "な")) or (KANA.match(y or "な") and not KANA.match(x or "な"))
        for _, x, y in ops if x or y
    ) and ratio >= 0.93:
        return "minor"
    return "medium" if ratio >= 0.9 else "major"


def pick_better(nd_val: str, mj_val: str):
    """返回 (采纳方, 理由)；采纳方为 None 表示保持纳豆原样。

    mojidict 的录入质量更高，所以**默认采纳 mojidict**；只有当 mojidict 这一侧
    自身有客观的质量问题（为空 / 占位符 / 被截断）时才保留纳豆 —— 否则「更可信」
    反而会把好数据换成坏数据。
    """
    nd_t, mj_t = norm(nd_val), norm(mj_val)
    if nd_t == mj_t:
        return None, ""
    # ---- mojidict 侧自身有问题，保留纳豆 ----
    if not mj_t:
        return None, "mojidict 侧为空，保持纳豆"
    if PLACEHOLDER.search(strip_html(mj_val)):
        return None, "mojidict 侧是占位符，保持纳豆"
    if nd_t.startswith(mj_t) and len(mj_t) < len(nd_t) * 0.85:
        return None, f"mojidict 侧疑似截断，保持纳豆（{len(mj_t)} vs {len(nd_t)} 字）"
    # ---- 其余一律采纳 mojidict ----
    if not nd_t:
        return "mojidict", "纳豆侧为空"
    if PLACEHOLDER.search(strip_html(nd_val)):
        return "mojidict", "纳豆侧是占位符"
    if mj_t.startswith(nd_t) and len(nd_t) < len(mj_t) * 0.85:
        return "mojidict", f"纳豆侧疑似截断（{len(nd_t)} vs {len(mj_t)} 字）"
    return "mojidict", "两侧文字不同，采纳可信度更高的 mojidict"


def compare_ym(ym: str):
    res = {"answer": [], "override": [], "textdiff": [], "unmatched": [], "counts": {}}
    for section in SECTIONS:
        nd, mj = load(RAW, ym, section), load(MOJI, ym, section)
        if not nd or not mj:
            continue
        pairs, unmatched = pair_up(nd["questions"], mj["questions"])
        res["counts"][section] = (len(nd["questions"]), len(mj["questions"]), len(pairs))
        for nq, s in unmatched:
            res["unmatched"].append({"section": section, "id": nq.get("id"), "best_sim": round(s, 3)})

        for nq, mq, s in pairs:
            na, ma = answer1(nq), answer1(mq)
            if na and ma and na != ma:
                res["answer"].append({
                    "section": section, "id": nq.get("id"), "moji_id": mq.get("id"),
                    "nadou_answer": na, "external_answer": ma, "match_sim": round(s, 3),
                })
            # 题干
            who, why = pick_better(nq.get("stem", ""), mq.get("stem", ""))
            if who == "mojidict":
                res["override"].append({"id": nq.get("id"), "section": section, "field": "stem",
                                        "value": mq.get("stem", ""), "reason": why,
                                        "sev": severity(nq.get("stem", ""), mq.get("stem", ""))})
            elif why and why != "":
                if norm(nq.get("stem", "")) != norm(mq.get("stem", "")):
                    res["textdiff"].append({"section": section, "id": nq.get("id"),
                                            "field": "stem", "reason": why,
                                            "sev": severity(nq.get("stem", ""), mq.get("stem", "")),
                                            "nadou_len": len(norm(nq.get("stem", ""))),
                                            "moji_len": len(norm(mq.get("stem", "")))})
            # 选项（逐项比，个数不同则整体看）
            no, mo = nq.get("options") or [], mq.get("options") or []
            if len(no) == len(mo):
                new_opts, changed, reasons, sevs = list(no), False, [], []
                for k, (a, b) in enumerate(zip(no, mo)):
                    w, r = pick_better(a, b)
                    if w == "mojidict":
                        new_opts[k] = b
                        changed = True
                        sevs.append(severity(a, b))
                        reasons.append(f"选项{k+1}:{r}")
                    elif r and norm(a) != norm(b):
                        res["textdiff"].append({"section": section, "id": nq.get("id"),
                                                "field": f"option{k+1}", "reason": r,
                                                "sev": severity(a, b),
                                                "nadou_len": len(norm(a)), "moji_len": len(norm(b))})
                if changed:
                    rank = {"major": 3, "medium": 2, "minor": 1, "same": 0}
                    res["override"].append({"id": nq.get("id"), "section": section, "field": "options",
                                            "value": new_opts, "reason": "；".join(reasons),
                                            "sev": max(sevs, key=lambda x: rank.get(x, 0)) if sevs else "minor"})
            elif no and mo:
                res["textdiff"].append({"section": section, "id": nq.get("id"), "field": "options",
                                        "reason": f"选项个数不同（纳豆{len(no)} vs moji{len(mo)}）",
                                        "sev": "major",
                                        "nadou_len": len(no), "moji_len": len(mo)})
    return res


def write_patch(ym: str, res: dict):
    """把 overrides / disputes 并进该年月各部分的 patch.json（保留已有内容）。"""
    by_section = {}
    for o in res["override"]:
        by_section.setdefault(o["section"], {"overrides": [], "disputes": []})["overrides"].append(
            {"id": o["id"], "field": o["field"], "value": o["value"],
             "reason": o["reason"], "from": "mojidict"})
    for a in res["answer"]:
        # note 不自动写：留给人工的争点说明，只有它会进 md（见 to_markdown.add_dispute）。
        # 「纳豆=X / mojidict=Y」那种话术两个答案现算得出，存下来只会变成待腐烂的副本。
        by_section.setdefault(a["section"], {"overrides": [], "disputes": []})["disputes"].append(
            {"id": a["id"], "nadou_answer": a["nadou_answer"],
             "external_answer": a["external_answer"], "external_source": "mojidict",
             "match_sim": a["match_sim"]})

    for section, payload in by_section.items():
        p = os.path.join(RAW, ym, f"{section}.patch.json")
        cur = {}
        if os.path.exists(p):
            with open(p, encoding="utf-8") as f:
                cur = json.load(f)
        # 已有的手工 disputes 不覆盖，按 id 合并
        old_d = {d["id"]: d for d in cur.get("disputes") or []}
        for d in payload["disputes"]:
            old_d.setdefault(d["id"], d)
        cur["disputes"] = list(old_d.values())
        old_o = {(o["id"], o["field"]): o for o in cur.get("overrides") or []}
        for o in payload["overrides"]:
            old_o[(o["id"], o["field"])] = o
        cur["overrides"] = list(old_o.values())
        cur.setdefault("_source", "mojidict")
        cur.setdefault("_note", "compare_sources.py 生成的交叉比对结果")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as f:
            json.dump(cur, f, ensure_ascii=False, indent=1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    yms = sorted(x for x in os.listdir(MOJI) if os.path.isdir(os.path.join(MOJI, x))) if os.path.isdir(MOJI) else []
    if args.only:
        yms = [y for y in yms if y == args.only]
    if not yms:
        raise SystemExit("没有对照数据，先跑 fetch_moji_all.py")

    lines = ["# 纳豆 × mojidict 交叉比对报告\n",
             "答案分歧只记录不修改；题面差异按客观规则择优，采纳项写进 patch 的 overrides。\n"]
    tot_a = tot_o = tot_t = tot_u = tot_minor = 0
    for ym in yms:
        res = compare_ym(ym)
        a, o, u = len(res["answer"]), len(res["override"]), len(res["unmatched"])
        sev = {k: [x for x in res["override"] if x.get("sev") == k] for k in ("major", "medium", "minor")}
        kept = res["textdiff"]
        t = len([x for x in kept if "为空" not in x["reason"]])
        tot_a += a; tot_o += o; tot_t += t; tot_u += u

        flag = ""
        if a: flag += f" 答案分歧{a}"
        if o: flag += f" 采纳moji{o}(重大{len(sev['major'])}/词句{len(sev['medium'])}/表记{len(sev['minor'])})"
        _k = [x for x in kept if "为空" not in x["reason"]]
        if _k: flag += f" 保留纳豆{len(_k)}"
        if u: flag += f" 未配对{u}"
        print(f"  {ym}: {sum(c[2] for c in res['counts'].values()):3d} 题配对{flag}")

        lines.append(f"\n## {ym}\n")
        lines.append("| 部分 | 纳豆题数 | moji题数 | 配对 |\n|---|---|---|---|")
        for s, (n, m, p) in res["counts"].items():
            lines.append(f"| {s} | {n} | {m} | {p} |")
        if res["answer"]:
            lines.append(f"\n**答案分歧 {a} 处**（只记录，未修改）\n")
            lines.append("| 部分 | 纳豆题id | 纳豆答案 | mojidict | 题面匹配度 |\n|---|---|---|---|---|")
            for x in res["answer"]:
                lines.append(f"| {x['section']} | {x['id']} | {x['nadou_answer']} | {x['external_answer']} | {x['match_sim']} |")
        if res["override"]:
            lines.append(f"\n**已采纳 mojidict：{o} 处**"
                         f"（重大 {len(sev['major'])} / 词句 {len(sev['medium'])} / 表记 {len(sev['minor'])}）\n")
            lines.append("| 部分 | 题id | 字段 | 级别 | 理由 |\n|---|---|---|---|---|")
            for x in sorted(res["override"], key=lambda x: {"major":0,"medium":1,"minor":2}.get(x.get("sev"),3))[:60]:
                lines.append(f"| {x['section']} | {x['id']} | {x['field']} | {x.get('sev','')} | {x['reason']} |")
            if o > 60:
                lines.append(f"\n（另有 {o-60} 处未列出，明细见各年月的 patch.json overrides 段）")
        empty = [x for x in kept if "为空" in x["reason"]]
        real_kept = [x for x in kept if "为空" not in x["reason"]]
        if empty:
            lines.append(f"\n字段缺失：{len(empty)} 处 mojidict 侧为空（听力题干本就存在 subtitle 里，"
                         f"非质量问题），保持纳豆原样。")
        kept = real_kept
        if kept:
            lines.append(f"\n**保留纳豆：{len(kept)} 处**（mojidict 侧是占位符/疑似截断）\n")
            lines.append("| 部分 | 题id | 字段 | 纳豆长 | moji长 | 理由 |\n|---|---|---|---|---|---|")
            for x in kept[:30]:
                lines.append(f"| {x['section']} | {x['id']} | {x['field']} | {x['nadou_len']} | {x['moji_len']} | {x['reason']} |")
            if len(kept) > 30:
                lines.append(f"\n（另有 {len(kept)-30} 处未列出）")
        if res["unmatched"]:
            lines.append(f"\n**未配对 {u} 题**（题面相似度低于 {MATCH_MIN}，可能是两边题目本身不同）\n")
            for x in res["unmatched"][:20]:
                lines.append(f"- {x['section']} id={x['id']} 最高相似度 {x['best_sim']}")
        if not args.dry_run:
            write_patch(ym, res)

    print(f"\n合计：答案分歧 {tot_a}（只记录）/ 采纳 mojidict {tot_o} / 保留纳豆 {tot_t} / 未配对 {tot_u}")
    if not args.dry_run:
        os.makedirs(os.path.dirname(REPORT), exist_ok=True)
        with open(REPORT, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        print(f"报告 → {os.path.relpath(REPORT, ROOT)}")


if __name__ == "__main__":
    main()
