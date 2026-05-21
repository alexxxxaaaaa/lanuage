#!/usr/bin/env python3
"""Extract '日语N1语法大全' PDF (7-column table) into JSON.

Columns in the source PDF: 序号 / 语法 / 接续 / 意思 / 例句 / 例句翻译 / 注意点

Usage:
    python3 server/scripts/extractN1GrammarPdf.py <pdf> <out.json>
"""
from __future__ import annotations

import json
import re
import sys

import pdfplumber


def clean(cell: str | None) -> str:
    if not cell:
        return ""
    # Strip the U+FE0F-style half-width form variations and zero-width joiners
    txt = cell.replace("​", "").replace("️", "")
    # The PDF inserts soft line breaks inside cells; collapse them but keep
    # paragraph breaks (the cell uses "\n" both for wrapping and for "next
    # sentence"). Heuristic: a single hard \n is kept; we don't have a way to
    # tell them apart so we keep them and let the user fix obvious ones.
    txt = txt.replace(" ", "\n").replace(" ", "\n")
    # Half-width digits get embedded in CJK text sometimes; leave them.
    return txt.strip()


def split_lines(text: str) -> list[str]:
    return [ln.strip() for ln in text.split("\n") if ln.strip()]


# Sentence-final punctuation that genuinely ends a line. If a line in a PDF
# cell ends without one of these, the next line is almost certainly a soft
# wrap, not a new sentence, and we should join them.
_SENTENCE_END = "。．.?!？！」』"
_NEW_EXAMPLE_PREFIX = re.compile(r"^[(（]?[\d０-９一二三四五六七八九十]+[)）.、]")


def join_soft_wraps(text: str) -> str:
    """Collapse soft line-wraps inside a cell while keeping genuine new lines
    (sentence boundaries, numbered list items)."""
    lines = [ln for ln in text.split("\n")]
    if not lines:
        return text
    out: list[str] = []
    buf = ""
    for ln in lines:
        stripped = ln.strip()
        if not stripped:
            continue
        if not buf:
            buf = stripped
            continue
        # Soft wrap if previous buffer ended without sentence-final punctuation
        # AND this line doesn't start a new numbered example.
        ends_softly = buf and buf[-1] not in _SENTENCE_END
        starts_new = bool(_NEW_EXAMPLE_PREFIX.match(stripped))
        if ends_softly and not starts_new:
            buf += stripped
        else:
            out.append(buf)
            buf = stripped
    if buf:
        out.append(buf)
    return "\n".join(out)


def main() -> None:
    if len(sys.argv) < 3:
        print("usage: extractN1GrammarPdf.py <pdf> <out.json>", file=sys.stderr)
        sys.exit(2)
    pdf_path, out_path = sys.argv[1], sys.argv[2]

    records: list[dict] = []
    seen: set[str] = set()

    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables() or []:
                for row in table:
                    if not row or len(row) < 6:
                        continue
                    seq = clean(row[0]).replace("\n", "")
                    if seq == "序号" or not re.fullmatch(r"\d+", seq):
                        continue
                    pattern = clean(row[1]).replace("\n", "")
                    if not pattern:
                        continue
                    if pattern in seen:
                        continue
                    seen.add(pattern)

                    # connection (接续) may have multiple lines; collapse internal
                    # line wraps to single space and keep distinct rules on
                    # separate lines.
                    connection_raw = clean(row[2])
                    connection = "\n".join(split_lines(connection_raw))

                    meaning = clean(row[3]).replace("\n", "")
                    example = join_soft_wraps(clean(row[4]))
                    example_zh = join_soft_wraps(clean(row[5]))
                    note = join_soft_wraps(clean(row[6])) if len(row) >= 7 else ""

                    records.append({
                        "seq": int(seq),
                        "pattern": pattern,
                        "connection": connection,
                        "meaning": meaning,
                        "example": example,
                        "exampleZh": example_zh,
                        "note": note,
                        "level": "N1",
                    })

    records.sort(key=lambda r: r["seq"])

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)

    print(f"wrote {len(records)} records to {out_path}")


if __name__ == "__main__":
    main()
