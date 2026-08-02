#!/usr/bin/env python3
"""
从 n1-qbank/markdown/*.md 生成 n1-qbank/index.json —— 全库题目的筛选索引。

只放元数据（年月/部分/問題号/题型/题号/答案/关联资源），不放题干正文，
所以文件小、可入 git、可直接被前端或脚本读来做筛选，命中后再去 md 取正文。

用法：python3 build_index.py
"""
import json
import os
import re

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
QBANK = os.path.join(ROOT, "n1-qbank")
MD = os.path.join(QBANK, "markdown")
OUT = os.path.join(QBANK, "index.json")

# 与 importQbank.ts 一致的解析规则
RE_Q = re.compile(r"^##\s+(Q\d+|聴解\S+)\s*$")
RE_PASS = re.compile(r"^###\s*文章\s*([^（(]+)[（(](.+?)[）)]\s*$")
RE_OPT = re.compile(r"^\s+(\d+)\.\s?(.*)$")
RE_FLD = re.compile(r"^-\s*([A-Za-z_]+)\s*:\s?(.*)$")
RE_HEAD = re.compile(r"^#{1,6}\s")
RE_FILE = re.compile(r"^(\d{4})年(\d{1,2})月_N1_题库\.md$")


def parse(path: str):
    lines = open(path, encoding="utf-8").read().split("\n")
    i, qs, ps = 0, [], []
    while i < len(lines):
        m = RE_PASS.match(lines[i])
        if m:
            code, typ = m.group(1).strip(), m.group(2).strip()
            i += 1
            buf = []
            while i < len(lines) and not RE_HEAD.match(lines[i]):
                buf.append(lines[i])
                i += 1
            body = "\n".join(buf).strip()
            ps.append({"code": code, "type": typ, "chars": len(body),
                       "images": len(re.findall(r"!\[\]\(", body))})
            continue
        m = RE_Q.match(lines[i])
        if m:
            seq = m.group(1)
            i += 1
            rec, opts = {}, {}
            while i < len(lines) and not RE_HEAD.match(lines[i]):
                o = RE_OPT.match(lines[i])
                if o:
                    opts[int(o.group(1))] = o.group(2).strip()
                    i += 1
                    continue
                f = RE_FLD.match(lines[i])
                if f:
                    rec[f.group(1)] = f.group(2)
                i += 1
            qs.append((seq, rec, opts))
            continue
        i += 1
    return qs, ps


def main():
    papers, questions = [], []
    for name in sorted(os.listdir(MD)):
        m = RE_FILE.match(name)
        if not m:
            continue
        year, month = int(m.group(1)), int(m.group(2))
        qs, ps = parse(os.path.join(MD, name))

        counts = {}
        for seq, rec, opts in qs:
            sec = rec.get("section", "")
            counts[sec] = counts.get(sec, 0) + 1
            questions.append({
                "year": year,
                "month": month,
                "level": "N1",
                "seq": seq,
                "section": sec,
                # 笔试用 mondai(1–13)，听力用 listening(聴解1–5) + mondai_no
                "mondai": rec.get("mondai") or rec.get("listening", ""),
                "mondai_no": rec.get("mondai_no", ""),
                "type": rec.get("type", ""),
                "answer": int(rec.get("answer") or 0),
                # 两来源答案不一致时另一来源的答案，0 = 无分歧。筛分歧题：[q for q in Q if q['alt_answer']]
                "alt_answer": int(rec.get("alt_answer") or 0),
                "choices": len(opts),
                "passage": rec.get("passage", ""),
                "audio": rec.get("audio", ""),
                "has_zh": bool(rec.get("stem_zh")),
                "has_explain": bool(rec.get("explain")),
            })
        papers.append({
            "year": year, "month": month, "level": "N1",
            "file": f"markdown/{name}",
            "questions": len(qs), "passages": len(ps),
            "counts": counts,
        })

    index = {
        "source": "nadou.net qbank 103 (N1 历年真题)",
        "papers": papers,
        "questions": questions,
        "totals": {
            "papers": len(papers),
            "questions": len(questions),
            "passages": sum(p["passages"] for p in papers),
        },
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=1)

    size = os.path.getsize(OUT) / 1024
    print(f"索引已生成：{os.path.relpath(OUT, ROOT)}（{size:.0f} KB）")
    print(f"  试卷 {len(papers)} 套 / 题目 {len(questions)} 道 / 文章 {index['totals']['passages']} 篇")
    secs = {}
    for q in questions:
        secs[q["section"]] = secs.get(q["section"], 0) + 1
    print("  按部分：" + "  ".join(f"{k} {v}" for k, v in secs.items()))


if __name__ == "__main__":
    main()
