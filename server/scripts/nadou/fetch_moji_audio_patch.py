#!/usr/bin/env python3
"""
纳豆缺的听力音频，从 mojidict 同卷同题借。

纳豆 2010–2024 每卷的 聴解5（統合理解）里，「質問1 / 質問2」那道双问题共用一段
录音，源站没给这段音频（接口里 stemMedia 是空的），全库 53 道题因此没声音；
另有 2022.07 那段虽然有文件，但只有 12 秒，是截断的残片（见 BROKEN）。
mojidict 有同一批卷子（快照已在 `n1-qbank/crosscheck/moji/`），每个听力材料带
自己的 `mediaId`，把对应那段下下来即可，一共 27 段。

（纳豆其实按材料另存过一份 `材料N.mp3`，内容与这段大体相同但各年份长短不一，
且从没被 md 引用过；这里统一走 mojidict，来源单一、时长稳定。）

    python3 fetch_moji_audio_patch.py --check    # 只报告匹配结果，不下载不改文件
    python3 fetch_moji_audio_patch.py            # 下载 + 写 patch
    python3 fetch_moji_audio_patch.py --only 2013.12

怎么保证借的是同一段：比**听力原文**。纳豆的 analysis 里带原文（还有译文和选项
解说），mojidict 的原文在材料的 subtitle 上，两边一比，命中项 0.62+、其余全在
0.1 以下 —— 26 组的领先幅度最小也有 9.4 倍，不存在模棱两可。所以要求
「最高分 ≥ MIN_TEXT_SIM 且甩开次高分 MARGIN 倍」，达不到就跳过并报出来。

不用选项文字当主判据是因为它在这类题上不可靠：2010.12 两边选项都是「1/2/3/4」
占位符，2023.12 一边写「光/月」另一边写「ひかり/つき」，都会误判。它只在原文缺失
时兜底。另外命中项在结构上也应该是「挂了 2 道题的材料」（質問1/質問2 共用一段），
对不上会一并报出来。

产物两处，raw 快照本身不动：
  * 音频 → `n1-qbank/audio/<年月>/聴解5-N.mp3`（N = 该组第一道题的题号）
  * 出处 → `raw/<年月>/听力.patch.json` 的 overrides 段，字段 `stemMedia`，
    to_markdown.py 照常读它写出 `- audio:`，改了什么、从哪借的都可查可回滚。
"""
import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from compare_sources import opts_text, sim, strip_html  # noqa: E402
from to_markdown import audio_group, classify_listening, mondai_of  # noqa: E402

OSS = "https://oss.mojidict.com/"
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
RAW = os.path.join(ROOT, "n1-qbank", "raw")
MOJI = os.path.join(ROOT, "n1-qbank", "crosscheck", "moji")
AUDIO = os.path.join(ROOT, "n1-qbank", "audio")
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
# 原文比对：命中项实测 0.62–0.98（纳豆的 analysis 混了译文，所以到不了 1.0），
# 非命中项全在 0.11 以下，两道门槛都留了足够余量。
MIN_TEXT_SIM = 0.50
MARGIN = 3.0
# 退路：原文缺失时才比选项，门槛给高些
MIN_OPTS_SIM = 0.75
MIN_BYTES = 10240
DELAY = 0.8

# 纳豆有音频、但文件本身是坏的，也照缺失处理。
# 2022.07 聴解5 那段只有 12 秒（同大题中位数 160 秒），明显是截断的残片；
# 全库 1041 个音频扫下来就这一个异常。
BROKEN = {("2022.07", "聴解5-2")}


def load_json(path: str):
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def alive(qs: list) -> list:
    return [q for q in (qs or []) if q.get("isExist", 1) not in (0, "0") and "stem" in q]


def silent_groups(d: dict, ym: str = "") -> list[dict]:
    """纳豆侧没有可用音频的组 → [{seq, ids, questions}]，seq 是组内第一道题的题号。"""
    qs = alive(d.get("questions"))
    mondais = mondai_of(qs) or classify_listening(qs, "")
    mats = {m["id"]: m for m in (d.get("materialItems") or [])}
    groups, order = {}, []
    cur, sub = None, 0
    for q, mondai in zip(qs, mondais):
        if mondai != cur:
            cur, sub = mondai, 0
        sub += 1
        g = audio_group(q)
        if g not in groups:
            groups[g] = {"seq": f"{mondai}-{sub}", "ids": [], "questions": [], "has_audio": False}
            order.append(g)
        grp = groups[g]
        grp["ids"].append(q.get("id"))
        grp["questions"].append(q)
        if (q.get("stemMedia") or {}).get("mediaUri"):
            grp["has_audio"] = True
        if (mats.get(q.get("parentId") or 0) or {}).get("mediaId"):
            grp["has_audio"] = True
    for g in order:
        if (ym, groups[g]["seq"]) in BROKEN:
            groups[g]["has_audio"] = False
    return [groups[g] for g in order if not groups[g]["has_audio"]]


def moji_candidates(mj: dict) -> list[dict]:
    """mojidict 侧按材料归组 → [{mediaId, script, questions}]，script 是听力原文。"""
    mats = {m["id"]: m for m in (mj.get("materialItems") or [])}
    groups, order = {}, []
    for q in alive(mj.get("questions")):
        pid = q.get("parentId")
        if pid not in groups:
            mat = mats.get(pid) or {}
            groups[pid] = {
                "mediaId": mat.get("mediaId") or "",
                "script": strip_html(mat.get("subtitle") or ""),
                "questions": [],
            }
            order.append(pid)
        groups[pid]["questions"].append(q)
    return [groups[p] for p in order if groups[p]["mediaId"]]


def best_match(group: dict, candidates: list[dict]) -> dict:
    """挑出同一段录音。返回 {cand, score, second, by, ok, note}。

    主判据是听力原文，次判据（原文缺失时）是选项文字，两者都要求「够像」且
    「甩开次名」—— 单看绝对分不够：纳豆的 analysis 混着中文译文，命中项也只有
    0.6~0.9，而差异化恰恰体现在与次名的量级差上。
    """
    want_script = strip_html(group["questions"][0].get("analysis") or "")
    ranked, by = [], "transcript"
    if want_script:
        ranked = [(sim(want_script, c["script"]), c) for c in candidates if c["script"]]
    if not ranked:
        by = "options"
        want_opts = " || ".join(opts_text(q) for q in group["questions"])
        ranked = [
            (sim(want_opts, " || ".join(opts_text(q) for q in c["questions"])), c)
            for c in candidates
        ]
    if not ranked:
        return {"cand": None, "score": 0.0, "second": 0.0, "by": by, "ok": False,
                "note": "mojidict 侧没有可比对的材料"}

    ranked.sort(key=lambda x: -x[0])
    score, cand = ranked[0]
    second = ranked[1][0] if len(ranked) > 1 else 0.0
    floor = MIN_TEXT_SIM if by == "transcript" else MIN_OPTS_SIM
    ok = score >= floor and score >= MARGIN * second
    note = ""
    # 結構复核：質問1/質問2 在 mojidict 那边也该是同一个材料下的两道题
    if ok and len(cand["questions"]) != len(group["questions"]):
        note = f"⚠ 题数对不上（纳豆 {len(group['questions'])} / moji {len(cand['questions'])}）"
    return {"cand": cand, "score": score, "second": second, "by": by, "ok": ok, "note": note}


def download(media_id: str, dest: str) -> int:
    url = OSS + urllib.parse.quote(media_id)
    req = urllib.request.Request(
        url, headers={"User-Agent": UA, "Referer": "https://test.mojidict.com/"}
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        data = r.read()
    if len(data) < MIN_BYTES:
        raise ValueError(f"文件过小 {len(data)}B")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "wb") as f:
        f.write(data)
    return len(data)


def write_override(ym: str, qid, media_id: str, reason: str):
    """写进 听力.patch.json 的 overrides。键是 (id, field)，与 compare_sources.py
    的合并逻辑一致 —— 它重跑时会保留这些条目。"""
    path = os.path.join(RAW, ym, "听力.patch.json")
    cur = load_json(path) or {"disputes": [], "overrides": [], "_source": "mojidict"}
    cur.setdefault("overrides", [])
    cur.setdefault("_note", "compare_sources.py 生成的交叉比对结果")
    entry = {
        "id": qid,
        "field": "stemMedia",
        "value": {"mediaUri": OSS + urllib.parse.quote(media_id)},
        "reason": reason,
        "from": "mojidict",
    }
    cur["overrides"] = [o for o in cur["overrides"] if (o["id"], o["field"]) != (qid, "stemMedia")]
    cur["overrides"].append(entry)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(cur, f, ensure_ascii=False, indent=1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="只处理某年月")
    ap.add_argument("--check", action="store_true", help="只报告，不下载不写文件")
    args = ap.parse_args()

    yms = sorted(x for x in os.listdir(RAW) if os.path.isdir(os.path.join(RAW, x)))
    if args.only:
        yms = [y for y in yms if y == args.only]

    ok = skipped = failed = 0
    for ym in yms:
        nd = load_json(os.path.join(RAW, ym, "听力.json"))
        if not nd:
            continue
        groups = silent_groups(nd, ym)
        if not groups:
            continue
        mj = load_json(os.path.join(MOJI, ym, "听力.json"))
        if not mj:
            print(f"[{ym}] {len(groups)} 组没音频，但没有 mojidict 快照，跳过")
            skipped += len(groups)
            continue
        cands = moji_candidates(mj)
        for grp in groups:
            m = best_match(grp, cands)
            tag = f"[{ym}] {grp['seq']}（{len(grp['ids'])} 题 id={grp['ids']}）"
            evidence = (
                f"{'原文' if m['by'] == 'transcript' else '选项'}相似度 {m['score']:.3f}"
                f"（次名 {m['second']:.3f}）"
            )
            if not m["ok"]:
                print(f"  ✗ {tag} {evidence} {m['note']} —— 证据不足，跳过")
                skipped += 1
                continue
            cand = m["cand"]
            dest = os.path.join(AUDIO, ym, f"{grp['seq']}.mp3")
            if args.check:
                print(f"  · {tag} ← {os.path.basename(cand['mediaId'])[36:] or '…'} {evidence} {m['note']}")
                ok += 1
                continue
            try:
                if not (os.path.exists(dest) and os.path.getsize(dest) >= MIN_BYTES):
                    n = download(cand["mediaId"], dest)
                    print(f"  ✓ {tag} → {grp['seq']}.mp3  {n / 1048576:.1f} MB  {evidence}")
                    time.sleep(DELAY)
                else:
                    print(f"  = {tag} 音频已存在，只补 patch")
                write_override(
                    ym,
                    grp["ids"][0],
                    cand["mediaId"],
                    f"纳豆缺该题音频（聴解5 双问题项共用的那段），取 mojidict 同卷同题分段；{evidence}",
                )
                ok += 1
            except Exception as e:
                print(f"  ✗ {tag} 下载失败：{e}")
                failed += 1

    print(f"\n补上 {ok} 组，跳过 {skipped}，失败 {failed}")
    if ok and not args.check:
        print("接着跑：python3 to_markdown.py && python3 build_index.py")
        print("       cd server && npm run import:qbank")


if __name__ == "__main__":
    main()
