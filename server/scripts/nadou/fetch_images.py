#!/usr/bin/env python3
"""
下载题目里的图片。情報検索（問題13）等材料整篇就是一张表格图，去掉 HTML 标签后
正文为空 —— 不下图那些题没法做。

落盘：n1-qbank/images/<年月>/<原文件名>，与 to_markdown.py 的 img_local() 命名一致。

用法：
    python3 fetch_images.py            # 全部（已存在的跳过）
    python3 fetch_images.py --dry-run
"""
import argparse
import glob
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from to_markdown import IMG_TAG, img_local  # noqa: E402  复用命名规则

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
RAW = os.path.join(ROOT, "n1-qbank", "raw")
QBANK = os.path.join(ROOT, "n1-qbank")
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


# 富文本编辑器塞进正文的占位素材，不是题目内容
SKIP_IMG = re.compile(r"(UEditor|/themes/default/images/|spacer\.gif)", re.I)


def collect() -> list:
    """扫全部原始 JSON，返回 [(年月, url, 目标路径)]，按 url 去重。"""
    seen, out = set(), []
    for p in sorted(glob.glob(os.path.join(RAW, "*", "*.json"))):
        if p.endswith("papers.json"):
            continue
        ym = os.path.basename(os.path.dirname(p))
        with open(p, encoding="utf-8") as f:
            d = json.load(f)
        blobs = []
        for q in d.get("questions") or []:
            blobs += [q.get("stem"), q.get("analysis")] + list(q.get("options") or [])
        for m in d.get("materialItems") or []:
            blobs += [m.get("stem"), m.get("analysis")]
        for b in blobs:
            for url in IMG_TAG.findall(b or ""):
                if url in seen or SKIP_IMG.search(url):
                    continue
                seen.add(url)
                out.append((ym, url, os.path.join(QBANK, img_local(url, ym))))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    tasks = collect()
    todo = [t for t in tasks if not os.path.exists(t[2])]
    print(f"图片合计 {len(tasks)} 张，待下载 {len(todo)} 张")
    if args.dry_run:
        for ym, url, dest in todo[:10]:
            print(f"  {ym}  {os.path.basename(dest)}")
        return

    ok = fail = 0
    for i, (ym, url, dest) in enumerate(todo, 1):
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": "https://www.nadou.net/"})
            with urllib.request.urlopen(req, timeout=45) as resp:
                data = resp.read()
            if len(data) < 512:
                raise ValueError(f"文件过小 {len(data)}B")
            with open(dest, "wb") as f:
                f.write(data)
            ok += 1
            print(f"  [{i}/{len(todo)}] {ym}/{os.path.basename(dest)}  {len(data) // 1024} KB", flush=True)
        except (urllib.error.URLError, TimeoutError, ValueError, OSError) as e:
            fail += 1
            print(f"  ❌ {ym} {url}: {e}")
        time.sleep(1.0 + random.random() * 0.5)

    print(f"\n完成 {ok} 张，失败 {fail} 张 → n1-qbank/images/")


if __name__ == "__main__":
    main()
