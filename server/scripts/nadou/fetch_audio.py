#!/usr/bin/env python3
"""
下载听力音频。纳豆的听力是「每题一个 mp3」（stemMedia.mediaUri），不是整卷一个文件，
所以一套 N1 约 35 个音频，29 套合计约 1000 个。

落盘：n1-qbank/audio/<年月>/<聴解N-M>.mp3，与 to_markdown.py 写进 md 的
`- audio:` 字段一一对应。

用法：
    python3 fetch_audio.py                 # 全部（已存在的跳过）
    python3 fetch_audio.py --only 2020.12
    python3 fetch_audio.py --dry-run       # 只列清单和体积，不下载

媒体 URL 自带 ?key= 签名，抓取后尽快下载；签名失效时重跑 fetch.py 刷新原始 JSON。
"""
import argparse
import json
import os
import random
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from to_markdown import classify_listening  # noqa: E402  复用問題号推断，保证命名一致

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
RAW = os.path.join(ROOT, "n1-qbank", "raw")
AUDIO = os.path.join(ROOT, "n1-qbank", "audio")
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
DELAY = 1.2


def plan(ym: str) -> list:
    """返回 [(seq, url, 时长秒)]。"""
    p = os.path.join(RAW, ym, "听力.json")
    if not os.path.exists(p):
        return []
    with open(p, encoding="utf-8") as f:
        d = json.load(f)
    qs = d["questions"]
    mondais = classify_listening(qs, ym)
    out, cur, sub = [], None, 0
    for q, mondai in zip(qs, mondais):
        if mondai != cur:
            cur, sub = mondai, 0
        sub += 1
        sm = q.get("stemMedia") or {}
        uri = sm.get("mediaUri") or ""
        if uri:
            out.append((f"{mondai}-{sub}", uri, sm.get("mediaTime") or 0))
    # 部分年份把整段音频挂在 materialItems 上（統合理解共用音频）
    for i, m in enumerate(d.get("materialItems") or [], 1):
        uri = ((m.get("stemMedia") or {}).get("mediaUri")) or ""
        if uri:
            out.append((f"材料{i}", uri, (m.get("stemMedia") or {}).get("mediaTime") or 0))
    return out


def download(url: str, dest: str, tries: int = 3) -> int:
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": "https://www.nadou.net/"})
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = resp.read()
            if len(data) < 1024:
                raise ValueError(f"文件过小 {len(data)}B，可能是错误页")
            tmp = dest + ".part"
            with open(tmp, "wb") as f:
                f.write(data)
            os.replace(tmp, dest)
            return len(data)
        except (urllib.error.URLError, TimeoutError, ValueError) as e:
            if attempt == tries - 1:
                raise
            time.sleep(DELAY * (2 ** attempt) + random.random())
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="只下某年月")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    yms = sorted(x for x in os.listdir(RAW) if os.path.isdir(os.path.join(RAW, x)))
    if args.only:
        yms = [x for x in yms if x == args.only]

    tasks = []
    for ym in yms:
        for seq, url, dur in plan(ym):
            dest = os.path.join(AUDIO, ym, f"{seq}.mp3")
            tasks.append((ym, seq, url, dur, dest))

    todo = [t for t in tasks if not os.path.exists(t[4])]
    secs = sum(t[3] or 0 for t in tasks)
    print(f"音频合计 {len(tasks)} 个（总时长约 {secs // 60} 分钟），待下载 {len(todo)} 个")
    if args.dry_run:
        for ym in yms:
            n = sum(1 for t in tasks if t[0] == ym)
            print(f"  {ym}: {n} 个")
        return

    ok = fail = 0
    total = 0
    for i, (ym, seq, url, _dur, dest) in enumerate(todo, 1):
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        try:
            n = download(url, dest)
            total += n
            ok += 1
            if i % 25 == 0 or i == len(todo):
                print(f"  [{i}/{len(todo)}] {ym}/{seq} … 累计 {total / 1048576:.0f} MB", flush=True)
        except Exception as e:  # noqa: BLE001 逐个失败不该中断整批
            fail += 1
            print(f"  ❌ {ym}/{seq}: {e}")
        time.sleep(DELAY + random.random() * 0.6)

    print(f"\n完成 {ok} 个，失败 {fail} 个，合计 {total / 1048576:.0f} MB → {os.path.relpath(AUDIO, ROOT)}/")


if __name__ == "__main__":
    main()
