#!/usr/bin/env python3
"""Extract the "N1必背2000词" style PDF into JSON.

Layout per entry (text-flow, not tables):
  Line 1: reading【word】 ⓪|①|...        (and for 外来语: katakana (latin) ①|...)
  Line 2: ［POS］ meaning
  Optional follow-up lines starting 連連/類類/関関/対対/合合 (bold text rendered
  with each character doubled — we collapse those when stashing them in `note`).

Pages also contain category headers (名名词词, 动动词词, ...) and section letters
(あ, い, ...) which are skipped.

Usage:
    python3 server/scripts/extractN1MustPdf.py <pdf> <out.json> [--shuffle]
"""
from __future__ import annotations

import json
import random
import re
import sys

import pdfplumber

ACCENT = "⓪①②③④⑤⑥⑦⑧⑨"
RELATED_MARKERS = ("連連", "類類", "関関", "対対", "合合")
SECTION_LETTERS = set("あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんがぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワ")

PAGE_FOOTER_RE = re.compile(r"^·\s*\d+\s*·$")

ENTRY_TAIL_RE = re.compile(rf"^(?P<head>.+?)\s*[{ACCENT}]+\s*$")
KANJI_FORM_RE = re.compile(r"^(?P<reading>[^\s【]+)【(?P<word>[^】]+)】$")
KANA_ONLY_RE = re.compile(r"^[぀-ゟ゠-ヿー・（）]+$")
KATAKANA_LOAN_RE = re.compile(r"^(?P<word>[゠-ヿー・]+)(?:\s*\(([^)]*)\))?$")
POS_LINE_RE = re.compile(r"^［(?P<pos>[^］]+)］\s*(?P<meaning>.*)$")


def collapse_doubled(text: str) -> str:
    """Collapse the doubled-character rendering used for bold runs (aa→a),
    but leave parenthesised Chinese glosses alone."""
    parts = re.split(r"(（[^）]*）|\([^)]*\))", text)
    out: list[str] = []
    for i, part in enumerate(parts):
        if i % 2 == 1:  # the parenthesised group itself — leave intact
            out.append(part)
            continue
        # Collapse runs where every char is repeated: aabb → ab
        collapsed = []
        j = 0
        while j < len(part):
            if j + 1 < len(part) and part[j] == part[j + 1]:
                collapsed.append(part[j])
                j += 2
            else:
                collapsed.append(part[j])
                j += 1
        out.append("".join(collapsed))
    return "".join(out).strip()


def parse_entry_header(line: str):
    """Return (reading, word) or None."""
    m = ENTRY_TAIL_RE.match(line)
    if not m:
        return None
    head = m.group("head").strip()
    m2 = KANJI_FORM_RE.match(head)
    if m2:
        return m2.group("reading").strip(), m2.group("word").strip()
    m3 = KATAKANA_LOAN_RE.match(head)
    if m3:
        word = m3.group("word").strip()
        return word, word
    if KANA_ONLY_RE.match(head):
        return head, head
    return None


def is_category_header(line: str) -> bool:
    """Detect a doubled-character category header like 名名词词 / 动动词词."""
    if not line or len(line) < 4 or len(line) > 12:
        return False
    if any(c in line for c in "［】【()⓪①②③④⑤⑥⑦⑧⑨0123456789·"):
        return False
    # All characters appear in repeating pairs
    if len(line) % 2 != 0:
        return False
    return all(line[i] == line[i + 1] for i in range(0, len(line), 2))


def is_section_letter(line: str) -> bool:
    return len(line) == 1 and line in SECTION_LETTERS


def main() -> None:
    if len(sys.argv) < 3:
        print("usage: extractN1MustPdf.py <pdf> <out.json> [--shuffle]", file=sys.stderr)
        sys.exit(2)

    pdf_path, out_path = sys.argv[1], sys.argv[2]
    shuffle = "--shuffle" in sys.argv[3:]

    records: list[dict] = []
    seen: set[tuple[str, str]] = set()
    current_category = ""  # 名词 / 动词 / イ形容词 / ナ形容词 / 副词 / 其他 / 外来语

    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            lines = [ln.strip() for ln in text.split("\n") if ln.strip()]

            i = 0
            while i < len(lines):
                line = lines[i]
                if PAGE_FOOTER_RE.match(line):
                    i += 1
                    continue
                if is_section_letter(line):
                    i += 1
                    continue
                if is_category_header(line):
                    current_category = collapse_doubled(line)
                    i += 1
                    continue

                parsed = parse_entry_header(line)
                if parsed is None:
                    i += 1
                    continue
                reading, word = parsed

                # Next line should be the POS / meaning line
                pos = ""
                meaning = ""
                if i + 1 < len(lines):
                    pm = POS_LINE_RE.match(lines[i + 1])
                    if pm:
                        pos = pm.group("pos").strip()
                        meaning = pm.group("meaning").strip()
                        i += 2
                    else:
                        i += 1
                        continue
                else:
                    i += 1
                    continue

                # Collect related-expression lines (連/類/関/対/合) as note
                notes: list[str] = []
                while i < len(lines):
                    nxt = lines[i]
                    if nxt.startswith(RELATED_MARKERS):
                        marker = nxt[0]  # single char (the doubled pair collapses to one)
                        rest = nxt[2:]   # drop the doubled marker
                        notes.append(f"{marker} {collapse_doubled(rest)}")
                        i += 1
                        continue
                    break

                key = (word, reading)
                if key in seen:
                    continue
                seen.add(key)

                records.append({
                    "word": word,
                    "reading": reading,
                    "partOfSpeech": pos or current_category,
                    "meaning": meaning,
                    "example": "",
                    "note": "\n".join(notes),
                    "language": "jp",
                })

    if shuffle:
        random.seed(0)  # deterministic shuffle so re-runs match
        random.shuffle(records)

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)

    print(f"wrote {len(records)} records to {out_path} (shuffle={shuffle})")


if __name__ == "__main__":
    main()
