#!/usr/bin/env python3
"""
从 mojidict 抓整套 N1 真题（纳豆题库没有的年份，目前是 2025.07 / 2025.12）。

产出与纳豆同构的 raw JSON，to_markdown.py 可以直接消费：
    n1-qbank/raw/<年月>/{词汇,语法,阅读,听力}.json
每条都带 _source: "mojidict"，题上还带 _mondai（mojidict 的卷子是按大题组织的，
問題号来自结构本身，不用像纳豆那样靠特征反推）。

听力音频是**整卷一个 mp3**（纳豆是每题一个），存 n1-qbank/audio/<年月>/full.mp3，
地址写进 paper.audioUrl，由 to_markdown 写到 md 头部。

鉴权同 fetch_moji_patch.py：
    export MOJI_TOKEN='r:xxxxxxxx'
    python3 fetch_moji_exam.py                 # 抓 EXAMS 里配置的全部
    python3 fetch_moji_exam.py --only 2025.07
    python3 fetch_moji_exam.py --no-audio
"""
import argparse
import json
import os
import random
import sys
import time
import urllib.parse
import urllib.request

APP_ID = "o435nmjFY8O8WxcWbRUM2"
API = "https://api.mojidict.com/app/mojitest/parse/functions/"
OSS = "https://oss.mojidict.com/"
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
RAW = os.path.join(ROOT, "n1-qbank", "raw")
AUDIO = os.path.join(ROOT, "n1-qbank", "audio")
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
DELAY = 1.2

EXAMS = [
    {"ym": "2025.07", "exam_id": "ww93VxW5ss"},
    {"ym": "2025.12", "exam_id": "lUZ711l1bB"},
]

# 18 个大题按位置对应：前 13 个是笔试問題1–13，后 5 个是听力問題1–5。
# 按位置而不是按标题文本 —— 2025.07 的第 12、13 个大题标题都写着「問題12」，源站标错了。
SECTION_OF_MONDAI = {
    **{i: "词汇" for i in range(1, 5)},
    **{i: "语法" for i in range(5, 8)},
    **{i: "阅读" for i in range(8, 14)},
}


def post(fn: str, payload: dict, tries: int = 3) -> dict:
    token = os.environ.get("MOJI_TOKEN", "").strip()
    if not token:
        sys.exit("缺少 MOJI_TOKEN，取法见 fetch_moji_patch.py 的 docstring")
    body = dict(payload, _ApplicationId=APP_ID, g_os="PCWeb", _SessionToken=token)
    last = None
    for attempt in range(tries):
        req = urllib.request.Request(
            API + fn,
            data=json.dumps(body).encode(),
            headers={
                "Content-Type": "application/json",
                "Origin": "https://test.mojidict.com",
                "Referer": "https://test.mojidict.com/",
                "User-Agent": UA,       # 不带 UA 会 403
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                d = json.loads(r.read().decode())
            res = d.get("result") or {}
            if res.get("code") == 200:
                return res["result"]
            last = f"code={res.get('code')} {res.get('message')}"
        except Exception as e:  # noqa: BLE001
            last = repr(e)
        time.sleep(DELAY * (2 ** attempt) + random.random())
    sys.exit(f"{fn} 失败：{last}")


def with_image(html: str, image_id: str) -> str:
    """情報検索（問題13）等材料的正文是一张表格图，接口把 html 写成 <MOJiTest_URL>
    占位、真正内容在 imageId。转成 <img> 标签，好让 to_markdown 的 to_text 和
    fetch_images 按既有管线处理。"""
    if not image_id:
        return html
    url = OSS + urllib.parse.quote(image_id)
    html = (html or "").replace("<MOJiTest_URL>", "")
    return f'{html}<img src="{url}">'


def flatten(node: dict, mondai: str, out_q: list, out_m: list, parent=None):
    """把 mojidict 的树拍平成 (材料, 题) 两个列表。
    有 items 的子节点是材料（文章），没有的就是题本身。"""
    for child in node.get("items") or []:
        kids = child.get("items") or []
        if kids:
            out_m.append({
                "id": child["objectId"],
                "stem": with_image(child.get("title") or "", child.get("imageId") or ""),
                "translation": child.get("translation") or "",
                # 听力材料的正文在 subtitle（日文原文），title 是空的；
                # 每个听力材料还带自己的 mediaId，即该题的音频片段（整卷 mp3 之外）。
                "subtitle": child.get("subtitle") or "",
                "mediaId": child.get("mediaId") or "",
                "type": "6",
                "isExist": 1,
                "_source": "mojidict",
            })
            for q in kids:
                out_q.append(to_question(q, mondai, child["objectId"]))
        else:
            out_q.append(to_question(child, mondai, parent))


def to_question(q: dict, mondai: str, parent_id=None) -> dict:
    opts = [o if isinstance(o, str) else (o.get("title") or "") for o in (q.get("options") or [])]
    ans = q.get("rightAnswer")
    return {
        "id": q["objectId"],
        "parentId": parent_id or 0,
        "stem": with_image(q.get("title") or "", q.get("imageId") or ""),
        "options": opts,
        # mojidict 的 rightAnswer 是 0-based 字符串，与纳豆 answer 数组同基准
        # （已用 2013.07 两来源重叠的 6 题校准）
        "answer": [int(ans)] if str(ans).isdigit() else [],
        "analysis": q.get("analysis") or "",
        "translation": q.get("translation") or "",
        "type": "1",
        "isExist": 1,
        "_mondai": mondai,
        "_source": "mojidict",
    }


def download_audio(media_id: str, dest: str) -> int:
    url = OSS + urllib.parse.quote(media_id)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": "https://test.mojidict.com/"})
    with urllib.request.urlopen(req, timeout=300) as r:
        data = r.read()
    if len(data) < 10240:
        raise ValueError(f"文件过小 {len(data)}B")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "wb") as f:
        f.write(data)
    return len(data)


def fetch_exam(cfg: dict, with_audio: bool):
    ym, exam_id = cfg["ym"], cfg["exam_id"]
    print(f"[{ym}] examId={exam_id}")
    exam = post("examV2-fetchExamWithFirstLayer", {"objectId": exam_id})
    larges = exam.get("items") or []
    print(f"  卷名={exam.get('title')} tag={exam.get('tag')} 大题 {len(larges)} 个")
    if len(larges) != 18:
        print(f"  ⚠ 大题数不是 18（笔试13+听力5），問題号按位置推断可能不准")

    buckets = {"词汇": [], "语法": [], "阅读": [], "听力": []}
    mats = {"词汇": [], "语法": [], "阅读": [], "听力": []}

    for idx, lg in enumerate(larges):
        detail = post("examV2-fetchStructuredQuestion", {"objectId": lg["objectId"]})
        if idx < 13:                       # 笔试問題1–13
            mondai = str(idx + 1)
            section = SECTION_OF_MONDAI[idx + 1]
        else:                              # 听力問題1–5
            mondai = f"聴解{idx - 12}"
            section = "听力"
        qs, ms = [], []
        flatten(detail, mondai, qs, ms)
        buckets[section].extend(qs)
        mats[section].extend(ms)
        print(f"    第{idx+1:2d} 大题 → {section} 問題{mondai}: {len(qs)} 题, {len(ms)} 材料", flush=True)
        time.sleep(DELAY + random.random() * 0.5)

    # audioUrl 只取决于文件在不在，与 --no-audio 无关 —— 否则重跑一次 --no-audio
    # 会把已下好的音频路径从 raw JSON 里抹掉。
    audio_rel = ""
    dest = os.path.join(AUDIO, ym, "full.mp3")
    if exam.get("mediaId"):
        if os.path.exists(dest):
            print("  音频已存在，跳过下载")
            audio_rel = f"audio/{ym}/full.mp3"
        elif with_audio:
            print("  下载整卷音频…", flush=True)
            n = download_audio(exam["mediaId"], dest)
            audio_rel = f"audio/{ym}/full.mp3"
            print(f"  音频 {n / 1048576:.0f} MB → {audio_rel}")
        else:
            print("  --no-audio 且本地无文件，audioUrl 留空")

    for section in ("词汇", "语法", "阅读", "听力"):
        out = {
            "paper": {
                "id": exam_id,
                "name": f"{ym} {section}",
                "yearMonth": ym,
                "section": section,
                "itemCount": len(buckets[section]),
                "audioUrl": audio_rel if section == "听力" else "",
            },
            "meta": {"title": exam.get("title"), "tag": exam.get("tag"), "mediaId": exam.get("mediaId")},
            "_source": "mojidict",
            "materialItems": mats[section],
            "questions": buckets[section],
        }
        d = os.path.join(RAW, ym)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, f"{section}.json"), "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=1)
        print(f"  {section}: {len(buckets[section])} 题, {len(mats[section])} 材料 → raw/{ym}/{section}.json")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="只抓某年月")
    ap.add_argument("--no-audio", action="store_true")
    args = ap.parse_args()
    todo = [e for e in EXAMS if not args.only or e["ym"] == args.only]
    if not todo:
        sys.exit(f"EXAMS 里没有 {args.only}")
    for cfg in todo:
        fetch_exam(cfg, not args.no_audio)
        print()


if __name__ == "__main__":
    main()
