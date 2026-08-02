#!/usr/bin/env python3
"""
从纳豆题库拉取 N1 真题原始 JSON，落到 N1/raw/ 下。

需要登录会话（题目接口匿名返回「需要登录」）。从浏览器 DevTools 里复制
nadou.net 的 ixunke cookie，放进环境变量，不要写进任何文件：

    export NADOU_COOKIE='ixunke=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'

用法：
    python3 fetch.py --index              # 只刷新试卷索引 papers.json
    python3 fetch.py                      # 抓全部（已抓过的自动跳过）
    python3 fetch.py --only 2020.12       # 只抓某一年月的四份
    python3 fetch.py --only 2020.12 --section 词汇
    python3 fetch.py --force              # 忽略已有文件重抓

对第三方站点限速：默认每请求间隔 2.5s ± 抖动，失败退避重试。
"""
import argparse
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://www.nadou.net"
QBANK_ID = 103
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
RAW = os.path.join(ROOT, "n1-qbank", "raw")
INDEX_FILE = os.path.join(RAW, "papers.json")

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
DELAY = 2.5          # 请求间隔基准秒数
JITTER = 1.0         # 随机抖动上限
PAGE_SIZE = 50       # 接口单页上限


def cookie() -> str:
    ck = os.environ.get("NADOU_COOKIE", "").strip()
    if not ck:
        sys.exit(
            "缺少 NADOU_COOKIE。\n"
            "  1) Chrome 打开 nadou.net 并保持登录\n"
            "  2) DevTools → Application → Cookies → https://www.nadou.net → 复制 ixunke 的值\n"
            "  3) export NADOU_COOKIE='ixunke=<值>'"
        )
    return ck if "=" in ck else f"ixunke={ck}"


def get(path: str, params: dict, tries: int = 4) -> dict:
    url = f"{BASE}{path}?{urllib.parse.urlencode(params)}"
    last = None
    for attempt in range(tries):
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": UA,
                "Cookie": cookie(),
                "Referer": f"{BASE}/practise/practise",
                "Accept": "application/json, text/plain, */*",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = json.loads(resp.read().decode("utf-8"))
            if body.get("errno") == 0:
                return body
            # 需要登录 / 无权限：重试没有意义，直接报
            if body.get("errno") in (100143, 100144):
                sys.exit(f"会话失效或无权限：{body.get('errmsg')}\n请重新导出 NADOU_COOKIE。")
            last = f"errno={body.get('errno')} {body.get('errmsg')}"
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            last = repr(e)
        back = DELAY * (2 ** attempt) + random.random()
        print(f"    重试 {attempt + 1}/{tries}（{last}），{back:.1f}s 后…", flush=True)
        time.sleep(back)
    raise RuntimeError(f"请求失败 {url}：{last}")


def nap():
    time.sleep(DELAY + random.random() * JITTER)


def fetch_index() -> list:
    """试卷索引。匿名可取，但一并走同一条路径。"""
    body = get("/api/paper/search_by_qbank", {"qBankId": QBANK_ID, "page": 1, "pageSize": 10000})
    papers = body["data"]
    os.makedirs(RAW, exist_ok=True)
    with open(INDEX_FILE, "w", encoding="utf-8") as f:
        json.dump(papers, f, ensure_ascii=False, indent=1)
    print(f"试卷索引：{len(papers)} 份 → {os.path.relpath(INDEX_FILE, ROOT)}")
    return papers


def load_index() -> list:
    if not os.path.exists(INDEX_FILE):
        return fetch_index()
    with open(INDEX_FILE, encoding="utf-8") as f:
        return json.load(f)


def parse_name(name: str):
    """「2020.12 词汇」→ ('2020.12', '词汇')；解析不出来返回 (None, None)。"""
    m = re.match(r"\s*(\d{4})[.\-年/](\d{1,2})\s*月?\s*(\S+)", name or "")
    if not m:
        return None, None
    return f"{m.group(1)}.{int(m.group(2)):02d}", m.group(3).strip()


def fetch_paper(paper: dict, force: bool) -> str | None:
    """抓一份试卷的全部题目，写 N1/raw/<年月>/<部分>.json。返回写入路径。"""
    ym, section = parse_name(paper.get("name", ""))
    if not ym:
        print(f"  跳过（名称无法解析）：{paper.get('name')!r}")
        return None

    outdir = os.path.join(RAW, ym)
    outfile = os.path.join(outdir, f"{section}.json")
    if os.path.exists(outfile) and not force:
        print(f"  跳过（已存在）：{ym}/{section}")
        return outfile

    # 用「考试模式」接口一次取整卷：/api/question 的练习模式会写练习记录且对
    # 部分卷子 500，search_paper 是只读的，一次返回全部 items + materialItems。
    body = get("/api/paper/search_paper", {"id": paper["id"], "flat": "true"})
    data = body["data"]
    items = data.get("items") or data.get("questions") or []
    materials = data.get("materialItems") or []

    os.makedirs(outdir, exist_ok=True)
    with open(outfile, "w", encoding="utf-8") as f:
        json.dump(
            {
                "paper": {
                    "id": paper["id"],
                    "name": paper.get("name"),
                    "yearMonth": ym,
                    "section": section,
                    "itemCount": paper.get("itemCount"),
                    "score": paper.get("score"),
                    "limitedTime": paper.get("limitedTime"),
                },
                "meta": {k: v for k, v in data.items() if k not in ("items", "questions", "materialItems")},
                "materialItems": materials,
                "questions": items,
            },
            f,
            ensure_ascii=False,
            indent=1,
        )
    got, want = len(items), paper.get("itemCount") or 0
    flag = "✅" if not want or got == want else "⚠"
    print(f"  {flag} {ym}/{section}：{got} 题" + (f"（索引称 {want}）" if want and got != want else "")
          + (f"，材料 {len(materials)} 篇" if materials else "")
          + f" → {os.path.relpath(outfile, ROOT)}")
    return outfile


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--index", action="store_true", help="只刷新试卷索引")
    ap.add_argument("--only", help="只抓某年月，如 2020.12")
    ap.add_argument("--section", help="只抓某部分：词汇/语法/阅读/听力")
    ap.add_argument("--force", action="store_true", help="忽略已有文件重抓")
    ap.add_argument("--limit", type=int, help="最多抓几份（试跑用）")
    args = ap.parse_args()

    if args.index:
        fetch_index()
        return

    papers = load_index()
    todo = []
    for p in papers:
        ym, sec = parse_name(p.get("name", ""))
        if not ym:
            continue
        if args.only and ym != args.only:
            continue
        if args.section and sec != args.section:
            continue
        todo.append(p)
    # 从早到晚，稳定顺序
    todo.sort(key=lambda p: (parse_name(p["name"])[0], p["id"]))
    if args.limit:
        todo = todo[: args.limit]

    print(f"待抓 {len(todo)} 份试卷\n")
    done = 0
    for i, p in enumerate(todo, 1):
        print(f"[{i}/{len(todo)}] {p['name']}（chapterId={p['id']}）")
        try:
            if fetch_paper(p, args.force):
                done += 1
        except RuntimeError as e:
            print(f"  ❌ {e}")
        nap()
    print(f"\n完成 {done}/{len(todo)} 份，原始 JSON 在 {os.path.relpath(RAW, ROOT)}/")


if __name__ == "__main__":
    main()
