#!/usr/bin/env python3
"""
把 mojidict 的历年 N1 卷子抓成快照，供与纳豆数据交叉比对（compare_sources.py 用）。

落到 n1-qbank/crosscheck/moji/<年月>/<部分>.json —— **独立目录，不碰 raw/**，
因为 raw/ 里 2010–2024 的主数据来自纳豆，这里只是第二来源的对照组。
2025 两套的主数据本身就是 mojidict，无需对照，默认跳过。

卷子列表走 REST（Parse 的 Exam class 拒绝 find，但这个接口可以）：
    GET /app/mojitest/api/v1/exam/list?tag=N1&type=normal

用法：
    export MOJI_TOKEN='r:xxxxxxxx'
    python3 fetch_moji_all.py                 # 全部（已抓过的跳过）
    python3 fetch_moji_all.py --only 2013.07
    python3 fetch_moji_all.py --list          # 只打印卷子列表
"""
import argparse
import json
import os
import random
import re
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_moji_exam import UA, flatten, post  # noqa: E402  复用鉴权与拍平逻辑

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
OUT = os.path.join(ROOT, "n1-qbank", "crosscheck", "moji")
LIST_API = "https://api.mojidict.com/app/mojitest/api/v1/exam/list?tag=N1&type=normal"
SKIP = {"2025.07", "2025.12"}          # 主数据即 mojidict，无需对照
SECTION_OF_MONDAI = {
    **{i: "词汇" for i in range(1, 5)},
    **{i: "语法" for i in range(5, 8)},
    **{i: "阅读" for i in range(8, 14)},
}
DELAY = 1.2


def exam_list() -> list:
    req = urllib.request.Request(LIST_API, headers={
        "User-Agent": UA,
        "Origin": "https://test.mojidict.com",
        "Referer": "https://test.mojidict.com/",
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.loads(r.read().decode())
    out = []
    for x in d.get("list") or []:
        m = re.match(r"(\d{4})年(\d{1,2})月", x.get("title") or "")
        if m:
            out.append({"ym": f"{m.group(1)}.{int(m.group(2)):02d}",
                        "exam_id": x["objectId"], "title": x["title"]})
    out.sort(key=lambda x: x["ym"])
    return out


def fetch_one(cfg: dict):
    ym, exam_id = cfg["ym"], cfg["exam_id"]
    exam = post("examV2-fetchExamWithFirstLayer", {"objectId": exam_id})
    larges = exam.get("items") or []
    buckets = {k: [] for k in ("词汇", "语法", "阅读", "听力")}
    mats = {k: [] for k in ("词汇", "语法", "阅读", "听力")}

    for idx, lg in enumerate(larges):
        detail = post("examV2-fetchStructuredQuestion", {"objectId": lg["objectId"]})
        if idx < 13:
            mondai, section = str(idx + 1), SECTION_OF_MONDAI[idx + 1]
        else:
            mondai, section = f"聴解{idx - 12}", "听力"
        qs, ms = [], []
        flatten(detail, mondai, qs, ms)
        buckets[section].extend(qs)
        mats[section].extend(ms)
        time.sleep(DELAY + random.random() * 0.4)

    d = os.path.join(OUT, ym)
    os.makedirs(d, exist_ok=True)
    for section in ("词汇", "语法", "阅读", "听力"):
        with open(os.path.join(d, f"{section}.json"), "w", encoding="utf-8") as f:
            json.dump({
                "paper": {"id": exam_id, "yearMonth": ym, "section": section,
                          "itemCount": len(buckets[section])},
                "meta": {"title": exam.get("title"), "mediaId": exam.get("mediaId")},
                "_source": "mojidict",
                "materialItems": mats[section],
                "questions": buckets[section],
            }, f, ensure_ascii=False, indent=1)
    n = sum(len(v) for v in buckets.values())
    print(f"  ✅ {ym}: {n} 题（{'/'.join(str(len(buckets[s])) for s in ('词汇','语法','阅读','听力'))}）"
          f" 大题 {len(larges)} 个", flush=True)
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    exams = exam_list()
    if args.list:
        for e in exams:
            print(f"  {e['ym']}  {e['exam_id']}  {e['title']}")
        return

    todo = [e for e in exams if e["ym"] not in SKIP]
    if args.only:
        todo = [e for e in todo if e["ym"] == args.only]
    if not args.force:
        todo = [e for e in todo if not os.path.exists(os.path.join(OUT, e["ym"], "听力.json"))]

    print(f"待抓 {len(todo)} 套（每套 18 个大题，限速 {DELAY}s）\n")
    total = 0
    for i, cfg in enumerate(todo, 1):
        print(f"[{i}/{len(todo)}] {cfg['ym']} examId={cfg['exam_id']}", flush=True)
        try:
            total += fetch_one(cfg)
        except SystemExit as e:
            print(f"  ❌ {e}")
        except Exception as e:  # noqa: BLE001
            print(f"  ❌ {e!r}")
    print(f"\n合计 {total} 题 → {os.path.relpath(OUT, ROOT)}/")


if __name__ == "__main__":
    main()
