#!/usr/bin/env python3
"""
用 mojidict 的同卷数据，补纳豆源站已删除的题（目前只有 2013.07 問題9 第三篇）。

产出 n1-qbank/raw/<年月>/<部分>.patch.json，由 to_markdown.py 自动合并。
patch 里的每条都带 _source: "mojidict"，md 输出会写 `- source:` 字段，
将来排查时能一眼看出哪几题不是纳豆来的。

鉴权：mojidict 是 Parse Server，不走 cookie，token 在 localStorage。
在 test.mojidict.com 的 DevTools Console 里取：
    JSON.parse(localStorage['Parse/o435nmjFY8O8WxcWbRUM2/currentUser']).sessionToken
然后：
    export MOJI_TOKEN='r:xxxxxxxx'
    python3 fetch_moji_patch.py

答案基准已用纳豆现存的同卷 6 题校准：mojidict 的 rightAnswer 与纳豆的 answer
同为 0-based（6 题中 5 题吻合，另 1 题两家答案本身就不同，见 README）。
"""
import argparse
import json
import os
import sys
import urllib.request

APP_ID = "o435nmjFY8O8WxcWbRUM2"
API = "https://api.mojidict.com/app/mojitest/parse/functions/"
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
RAW = os.path.join(ROOT, "n1-qbank", "raw")

# 要补的缺口：年月 / 部分 / mojidict 的卷 id / 大题 id / 该篇在纳豆里被删的 id
PATCHES = [{
    "ym": "2013.07",
    "section": "阅读",
    "exam_id": "1wt6DaECIz",
    "large_q": "Sw7qxuA56o",          # 問題9
    "material_id": "JXknoB3xuY",      # 纳豆缺的那一篇（已用文本相似度确认）
    "nadou_material_id": 10313,       # 源站删除的材料 id
    "nadou_question_ids": [10314, 10315, 10316],
    "note": "纳豆 isExist=0 缺失的 問題9 第三篇文章 + 3 题，取自 mojidict 同卷",
}]


def post(fn: str, payload: dict) -> dict:
    token = os.environ.get("MOJI_TOKEN", "").strip()
    if not token:
        sys.exit("缺少 MOJI_TOKEN，取法见本文件 docstring")
    body = dict(payload, _ApplicationId=APP_ID, g_os="PCWeb", _SessionToken=token)
    req = urllib.request.Request(
        API + fn,
        data=json.dumps(body).encode(),
        headers={
            "Content-Type": "application/json",
            "Origin": "https://test.mojidict.com",
            "Referer": "https://test.mojidict.com/",
            # 不带 UA 会被 403
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
            ),
        },
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.loads(r.read().decode())
    res = d.get("result") or {}
    if res.get("code") != 200:
        sys.exit(f"{fn} 失败：code={res.get('code')} {res.get('message')}")
    return res["result"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    for p in PATCHES:
        large = post("examV2-fetchStructuredQuestion", {"objectId": p["large_q"]})
        node = next((x for x in large.get("items") or [] if x["objectId"] == p["material_id"]), None)
        if not node:
            sys.exit(f"没找到材料 {p['material_id']}")

        qs = node.get("items") or []
        if len(qs) != len(p["nadou_question_ids"]):
            sys.exit(f"题数不符：mojidict {len(qs)} 题 vs 预期 {len(p['nadou_question_ids'])} 题")

        material = {
            "id": p["nadou_material_id"],
            "stem": node.get("title") or "",
            "translation": node.get("translation") or "",
            "type": "6",
            "isExist": 1,
            "_source": "mojidict",
            "_sourceId": node["objectId"],
        }
        questions = []
        for qid, q in zip(p["nadou_question_ids"], qs):
            opts = [o if isinstance(o, str) else (o.get("title") or "") for o in (q.get("options") or [])]
            ans = q.get("rightAnswer")
            questions.append({
                "id": qid,
                "parentId": p["nadou_material_id"],
                "stem": q.get("title") or "",
                "options": opts,
                # mojidict 的 rightAnswer 是 0-based 字符串，与纳豆 answer 数组同基准
                "answer": [int(ans)] if ans not in (None, "") else [],
                "analysis": q.get("analysis") or "",
                "type": "1",
                "isExist": 1,
                "_source": "mojidict",
                "_sourceId": q["objectId"],
            })

        out = {
            "_source": "mojidict",
            "_examId": p["exam_id"],
            "_note": p["note"],
            "materialItems": [material],
            "questions": questions,
        }
        dest = os.path.join(RAW, p["ym"], f"{p['section']}.patch.json")
        print(f"{p['ym']}/{p['section']}: 材料 1 篇（{len(material['stem'])} 字 HTML）+ {len(questions)} 题")
        for q in questions:
            print(f"    id={q['id']} 选项{len(q['options'])} answer={q['answer']} 解析{len(q['analysis'])}字")
        if args.dry_run:
            continue
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=1)
        print(f"  → {os.path.relpath(dest, ROOT)}")


if __name__ == "__main__":
    main()
