#!/usr/bin/env python3
"""Extract a MOJi-style N1 wordlist PDF into JSON.

Usage:
    python3 server/scripts/extractN1Pdf.py <pdf_path> <out_json_path>

Each record has: { word, reading, partOfSpeech, meaning } plus skipped=true if
the row looked malformed (kept so the caller can inspect).
"""
from __future__ import annotations

import json
import re
import sys

import pdfplumber

POS_RE = re.compile(r"^\s*\[([^\]]+)\]\s*(.*)$", re.S)


def parse_pos(raw_meaning: str) -> tuple[str, str]:
    if not raw_meaning:
        return "", ""
    m = POS_RE.match(raw_meaning)
    if not m:
        return "", raw_meaning.strip()
    return m.group(1).strip(), m.group(2).strip()


def main() -> None:
    if len(sys.argv) < 3:
        print("usage: extractN1Pdf.py <pdf> <out.json>", file=sys.stderr)
        sys.exit(2)

    pdf_path, out_path = sys.argv[1], sys.argv[2]
    records: list[dict] = []
    seen: set[tuple[str, str]] = set()

    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables() or []:
                for row in table:
                    if not row or len(row) < 4:
                        continue
                    idx, reading, word, meaning = (
                        (row[0] or "").strip(),
                        (row[1] or "").strip(),
                        (row[2] or "").strip(),
                        (row[3] or "").strip(),
                    )
                    if idx == "序号" or not idx.isdigit():
                        continue
                    if not word or not reading:
                        continue
                    pos, meaning_text = parse_pos(meaning)
                    key = (word, reading)
                    if key in seen:
                        continue
                    seen.add(key)
                    records.append({
                        "word": word,
                        "reading": reading,
                        "partOfSpeech": pos,
                        "meaning": meaning_text,
                        "example": "",
                        "note": "",
                        "language": "jp",
                    })

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)

    print(f"wrote {len(records)} records to {out_path}")


if __name__ == "__main__":
    main()
