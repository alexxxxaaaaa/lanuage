#!/usr/bin/env python3
"""
把 mojidict 卷子（2025.07 / 2025.12）的**分段听力音频**下下来。

fetch_moji_exam.py 当初只下了整卷 `full.mp3`，但每个听力材料在 raw JSON 里
都带自己的 `mediaId`，就是该题那一段。这个脚本读已经存在的 raw JSON 把它们
逐段取下来，落成和纳豆一样的每题一段：

    n1-qbank/audio/<年月>/聴解<小节>-<题号>.mp3

**不需要 MOJI_TOKEN** —— OSS 上的 mp3 是公开对象，raw JSON 也已经入 git，
所以任何人 clone 下来都能重跑。

    python3 fetch_moji_segments.py                # 全部
    python3 fetch_moji_segments.py --only 2025.07
    python3 fetch_moji_segments.py --check        # 只报告缺哪些，不下载

命名对齐说明：一段音频可能被多题共用（聴解5 的 質問1/質問2 是同一段录音），
文件按**该材料第一次出现时的题号**命名，与 to_markdown.py 里 PL 文章号的编号
规则完全一致，所以 md 里两道题会指向同一个 mp3。
"""
import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from to_markdown import mondai_of  # noqa: E402  同目录，复用問題号解析

OSS = "https://oss.mojidict.com/"
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
RAW = os.path.join(ROOT, "n1-qbank", "raw")
AUDIO = os.path.join(ROOT, "n1-qbank", "audio")
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
DELAY = 0.8
MIN_BYTES = 10240


def segments_of(ym: str) -> list[tuple[str, str]]:
    """→ [(文件名 聴解1-1.mp3, mediaId)]，按材料首次出现的题号命名。"""
    path = os.path.join(RAW, ym, "听力.json")
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        d = json.load(f)
    qs = d.get("questions") or []
    mondais = mondai_of(qs)
    if not mondais:
        # 纳豆卷子每题自带音频，不走这个脚本
        return []
    mats = {m["id"]: m for m in (d.get("materialItems") or [])}
    out, seen, cur, sub = [], set(), None, 0
    for q, mondai in zip(qs, mondais):
        if mondai != cur:
            cur, sub = mondai, 0
        sub += 1
        pid = q.get("parentId") or 0
        if pid in seen:
            continue  # 同一段录音的第二问，共用上面那个文件
        seen.add(pid)
        media_id = (mats.get(pid) or {}).get("mediaId") or ""
        if media_id:
            out.append((f"{mondai}-{sub}.mp3", media_id))
    return out


def download(media_id: str, dest: str) -> int:
    url = OSS + urllib.parse.quote(media_id)
    req = urllib.request.Request(
        url, headers={"User-Agent": UA, "Referer": "https://test.mojidict.com/"}
    )
    with urllib.request.urlopen(req, timeout=300) as r:
        data = r.read()
    if len(data) < MIN_BYTES:
        raise ValueError(f"文件过小 {len(data)}B，八成是错误页")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "wb") as f:
        f.write(data)
    return len(data)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="只处理某个年月，如 2025.07")
    ap.add_argument("--check", action="store_true", help="只报告，不下载")
    args = ap.parse_args()

    yms = sorted(d for d in os.listdir(RAW) if os.path.isdir(os.path.join(RAW, d)))
    if args.only:
        yms = [y for y in yms if y == args.only]

    total_new = total_have = total_fail = 0
    for ym in yms:
        segs = segments_of(ym)
        if not segs:
            continue
        print(f"[{ym}] {len(segs)} 段")
        for name, media_id in segs:
            dest = os.path.join(AUDIO, ym, name)
            if os.path.exists(dest) and os.path.getsize(dest) >= MIN_BYTES:
                total_have += 1
                continue
            if args.check:
                print(f"  缺 {name}")
                total_fail += 1
                continue
            try:
                n = download(media_id, dest)
                print(f"  ✓ {name}  {n / 1048576:.1f} MB")
                total_new += 1
            except Exception as e:  # 网络/签名问题，报出来后续重跑即可
                print(f"  ✗ {name}  {e}")
                total_fail += 1
            time.sleep(DELAY)

    print(f"\n新下 {total_new}，已有 {total_have}，失败/缺失 {total_fail}")
    if total_new:
        print("接着跑：python3 to_markdown.py && python3 build_index.py")
        print("       cd server && npm run import:qbank")


if __name__ == "__main__":
    main()
