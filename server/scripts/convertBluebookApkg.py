#!/usr/bin/env python3
"""
把两个「蓝宝书」Anki 卡组合并成一份语法条目 JSON。

两个 apkg 是同一本书的两个版本，互补：

  B = 蓝宝书N1-N5全套 new.apkg     767 note / 744 句型
      结构化字段（Word / Explain1-15 / Example1-25 / Chinese1-25 /
      Note1-15 / SentenceTag1-25 / Image1-10），文本已校对干净，
      共 2475 条例句，但没有音频。→ 正文全部取这一版。

  A = 日语文法蓝宝书 N1-N5-v2.apkg  988 note / 806 句型
      每 note 只有一条例句，文本带 OCR 残留（「註意」「折略」），
      但有 1766 个 mp3（句型朗读 + 例句朗读）。
      → 只取三样：B 没有的 132 个句型、音频、B 没有的例句。

合并键是 (pattern, level) 而不是 pattern：书里「～たところで」这类句型
N1 和 N2 各收一条、讲不同用法，是两个独立条目。同键的多条 note 则是同一
句型的多条例句，合并进一条。

用法:
    python3 server/scripts/convertBluebookApkg.py
    python3 server/scripts/convertBluebookApkg.py --media-out /tmp/bluebook-media

输出 server/data/bluebook/grammar.json，以及一份 stats 摘要打到 stdout。
媒体只在 --media-out 时导出（按真实文件名），供后续传 R2。
"""
from __future__ import annotations

import argparse
import difflib
import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
import unicodedata
import zipfile
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
DEFAULT_A = os.path.join(ROOT, "日语文法蓝宝书 N1-N5-v2.apkg")
DEFAULT_B = os.path.join(ROOT, "蓝宝书N1-N5全套 new.apkg")
DEFAULT_OUT = os.path.join(ROOT, "server", "data", "bluebook", "grammar.json")

MODEL_A = "1683933602603"  # 日语蓝宝书-tank562
MODEL_B = "1725626812943"  # 双类型文法卡组Note


# ---------------------------------------------------------------- apkg 读取

class Deck:
    """解压后的 apkg：note 行 + 媒体名映射。"""

    def __init__(self, path: str, workdir: str):
        self.dir = os.path.join(workdir, os.path.basename(path))
        os.makedirs(self.dir, exist_ok=True)
        with zipfile.ZipFile(path) as z:
            z.extractall(self.dir)
        db = os.path.join(self.dir, "collection.anki2")
        con = sqlite3.connect(db)
        self.models = json.loads(con.execute("select models from col").fetchone()[0])
        self.decks = json.loads(con.execute("select decks from col").fetchone()[0])
        # 一条 note 可能生成多张卡（B 有 26 个模板），只取第一张定级别。
        self.notes = list(
            con.execute(
                "select n.mid, n.flds, min(c.did) from notes n "
                "join cards c on c.nid = n.id group by n.id order by n.id"
            )
        )
        con.close()
        # media 是 {"0": "真实文件名"}，我们要反向查：真实名 → 压缩包内的数字名。
        with open(os.path.join(self.dir, "media"), encoding="utf-8") as f:
            self.media = {v: k for k, v in json.load(f).items()}

    def fields(self, mid: str) -> list[str]:
        return [f["name"] for f in self.models[mid]["flds"]]

    def level_of(self, did: int) -> str:
        return self.decks[str(did)]["name"].split("::")[-1]

    def media_path(self, filename: str) -> str | None:
        num = self.media.get(filename)
        return os.path.join(self.dir, num) if num else None


# ---------------------------------------------------------------- 文本清洗

SOUND_RE = re.compile(r"\[sound:([^\]]+)\]")
IMG_RE = re.compile(r"<img[^>]*\bsrc\s*=\s*[\"']([^\"']+)[\"'][^>]*>", re.I)
# 高亮：书里用 <b> 标句型本体，A 版用 <u> 和蓝色 <font> 表达同一件事。
EMPH_OPEN_RE = re.compile(r"<\s*(b|u|strong)\b[^>]*>", re.I)
EMPH_CLOSE_RE = re.compile(r"<\s*/\s*(b|u|strong)\s*>", re.I)
BLUE_FONT_RE = re.compile(r"<font[^>]*color\s*=\s*[\"']?#?(1168eb|0000ff)[^>]*>(.*?)</font>", re.I | re.S)
BR_RE = re.compile(r"<\s*(br|/div|/p)\s*/?\s*>", re.I)
TAG_RE = re.compile(r"<[^>]+>")
# Anki 注音：可选前导空格 + 非空白/非括号的一段 + [读音]
RUBY_RE = re.compile(r"[ 　]?([^\s\[\]<>]+?)\[([^\]]+?)\]")


def strip_html(text: str, *, keep_emphasis: bool) -> str:
    """剥 HTML。keep_emphasis 时把各种强调统一成 <b>，其余标签一律去掉。"""
    s = text.replace("&nbsp;", " ")
    s = SOUND_RE.sub("", s)
    s = IMG_RE.sub("", s)
    s = BR_RE.sub("\n", s)
    if keep_emphasis:
        # A 版靠蓝色 font 表达高亮，先归一成 <b> 再统一处理。
        s = BLUE_FONT_RE.sub(r"<b>\2</b>", s)
        s = EMPH_OPEN_RE.sub("\x01", s)
        s = EMPH_CLOSE_RE.sub("\x02", s)
    s = TAG_RE.sub("", s)
    if keep_emphasis:
        s = s.replace("\x01", "<b>").replace("\x02", "</b>")
        # 清洗后可能留下空的或嵌套的高亮
        s = re.sub(r"<b>\s*</b>", "", s)
    s = s.replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
    s = re.sub(r"[ \t　]+", " ", s)
    s = re.sub(r"\n{2,}", "\n", s)
    return s.strip()


def strip_ruby(text: str) -> str:
    """去掉注音，只留汉字本体 —— 兼容字段和搜索用这一版。"""
    return RUBY_RE.sub(r"\1", text)


def plain(text: str) -> str:
    """纯文本：无 HTML、无注音、无强调标记。"""
    return strip_ruby(strip_html(text, keep_emphasis=False))


def norm_key(text: str) -> str:
    """归一化到匹配键：去注音、去波浪线，标点一律抹平，全角统一。

    两版对同一条目的标点写法各不相同 —— B 写「名词1＋は＋名词2＋です」，
    A 写「名词1+は+名词2+『です』」。不抹平的话同一条目会被当成两条各自收进
    来，接着还会在模糊判重里互相误判成「重复」。
    """
    s = plain(text)
    s = unicodedata.normalize("NFKC", s)
    s = re.sub(r"[〜～~…\s]", "", s)
    # 结构说明类条目全靠这一步对齐：+ 『』「」 / （） 在两版里写法不一致。
    s = re.sub(r"[+＋『』「」（）()\[\]【】/／、,，。.·・:：;；]", "", s)
    return s


def clean_pattern(text: str) -> str:
    """句型标题：去注音、去 HTML，波浪线统一成 ～，压掉前后空白。"""
    s = strip_html(text, keep_emphasis=False)
    s = strip_ruby(s)
    s = s.replace("〜", "～").replace("~", "～")
    s = re.sub(r"[ 　]+", "", s)
    return s.strip()


def sentence_key(text: str) -> str:
    """例句匹配键 —— A 的『例句发音源』是无注音纯文本，B 的例句带注音。"""
    return re.sub(r"[\s　。、，,．.]", "", plain(text))


# ---------------------------------------------------------------- 条目模型

LEVEL_RE = re.compile(r"N[1-5]")


def parse_level(raw: str, fallback: str) -> str:
    m = LEVEL_RE.search(raw or "")
    return m.group(0) if m else fallback


class Entry:
    """一个语法条目 —— 合并键是 (pattern, level)。"""

    def __init__(self, pattern: str, level: str):
        self.pattern = pattern
        self.level = level
        self.connections: list[str] = []
        self.explains: list[str] = []
        self.notes: list[str] = []
        self.examples: list[dict] = []
        self.images: list[str] = []
        self.order = 10**6
        self.source_id = ""
        self.origin = ""          # bluebook-b | bluebook-a
        self.pattern_audio = ""
        self.honorific = ""

    def add_example(self, jp: str, zh: str, tag: str, origin: str) -> None:
        if not jp:
            return
        key = sentence_key(jp)
        for ex in self.examples:
            if sentence_key(ex["jp"]) == key:
                # 已有同句：补上原来缺的译文/标签，不重复插入。
                if zh and not ex["zh"]:
                    ex["zh"] = zh
                if tag and not ex["tag"]:
                    ex["tag"] = tag
                return
        self.examples.append(
            {"jp": jp, "zh": zh, "tag": tag, "audio": "", "origin": origin}
        )

    def dedup(self) -> None:
        for attr in ("connections", "explains", "notes"):
            seen, out = set(), []
            for item in getattr(self, attr):
                k = re.sub(r"\s+", "", plain(item))
                if k and k not in seen:
                    seen.add(k)
                    out.append(item)
            setattr(self, attr, out)

    def to_json(self) -> dict:
        self.dedup()
        # 旧的 example / exampleZh 是换行拼接的纯文本，详情页按行号配对渲染。
        # 新前端读 examples[]，这两个字段留着让老 UI 和搜索照常工作。
        jp_lines = [strip_ruby(strip_html(e["jp"], keep_emphasis=False)) for e in self.examples]
        zh_lines = [e["zh"] for e in self.examples]
        return {
            "pattern": self.pattern,
            "level": self.level,
            "orderNo": self.order,
            "sourceId": self.source_id,
            "source": "bluebook",
            "origin": self.origin,
            "connection": "\n".join(self.connections),
            "meaning": self.explains[0] if self.explains else "",
            "note": "\n".join(self.explains[1:] + self.notes),
            "example": "\n".join(jp_lines),
            "exampleZh": "\n".join(zh_lines),
            "examples": self.examples,
            "images": self.images,
            "audioKey": self.pattern_audio,
            "honorific": self.honorific,
        }


# ---------------------------------------------------------------- B：正文主干

def load_b(deck: Deck, entries: dict, stats: dict) -> None:
    flds = deck.fields(MODEL_B)
    idx = {n: i for i, n in enumerate(flds)}

    def get(parts: list[str], name: str) -> str:
        i = idx.get(name, -1)
        return parts[i] if 0 <= i < len(parts) else ""

    for mid, raw, did in deck.notes:
        if str(mid) != MODEL_B:
            continue
        parts = raw.split("\x1f")
        pattern = clean_pattern(get(parts, "Word"))
        if not pattern:
            continue
        level = parse_level(get(parts, "Level"), deck.level_of(did))
        key = (norm_key(pattern), level)
        entry = entries.get(key)
        if entry is None:
            entry = Entry(pattern, level)
            entry.origin = "bluebook-b"
            entries[key] = entry
        else:
            stats["b_merged_dupes"] += 1

        entry.source_id = get(parts, "Note ID") or entry.source_id
        try:
            entry.order = min(entry.order, int(get(parts, "TotalOrder") or 10**6))
        except ValueError:
            pass
        if get(parts, "Honorific").strip():
            entry.honorific = plain(get(parts, "Honorific"))

        for n in range(1, 11):
            v = get(parts, f"ConnectiveType{n}").strip()
            if v:
                entry.connections.append(strip_html(v, keep_emphasis=False))
        # 学校文法的接续说法，书里作为补充列在一起
        for n in range(1, 11):
            v = get(parts, f"GakkoConnective{n}").strip()
            if v:
                entry.connections.append(strip_html(v, keep_emphasis=False))
        for n in range(1, 16):
            v = get(parts, f"Explain{n}").strip()
            if v:
                entry.explains.append(strip_html(v, keep_emphasis=False))
        for n in range(1, 16):
            v = get(parts, f"Note{n}").strip()
            if v:
                entry.notes.append(strip_html(v, keep_emphasis=False))
        for n in range(1, 11):
            v = get(parts, f"Image{n}").strip()
            for src in IMG_RE.findall(v):
                if src not in entry.images:
                    entry.images.append(src)
        for n in range(1, 26):
            jp_raw = get(parts, f"Example{n}").strip()
            if not jp_raw:
                continue
            entry.add_example(
                jp=strip_html(jp_raw, keep_emphasis=True),
                zh=plain(get(parts, f"Chinese{n}")),
                tag=plain(get(parts, f"SentenceTag{n}")),
                origin="b",
            )
            for src in IMG_RE.findall(jp_raw):
                if src not in entry.images:
                    entry.images.append(src)


# ---------------------------------------------------------------- A：补充

# A 的条目排在 B 的书序（最大 767）之后，内部保持牌组顺序。
A_ORDER_BASE = 900000

# A 版把书里的动词活用表和数字读法练习也做成了卡片：「辞书形：あげる / 解释：
# 给」是词汇卡，不是语法句型，放进语法列表只会稀释。前缀要带冒号才算 —— 光写
# 「自动词」「他动词」的那两条讲的是自他动词和格助词的区别，是正经语法条目。
A_VOCAB_PREFIX_RE = re.compile(r"^(辞书形|自动词|他动词|动词辞书形)\s*[:：]")
A_DRILL_RE = re.compile(r"[\d０-９一二三四五六七八九十]+[，、,]\s*[\d０-９一二三四五六七八九十]+[，、,]")

# 同一句型两版写法有出入时（A 有 OCR 噪声：「じやないか」实为「じゃないか」；
# 结尾「だ」的有无也各写各的），按相似度判重，B 的写法为准。
#
# 只对带「～」的句型做模糊判重。「动词「た形」」和「动词「て形」」字面上差一个
# 假名、相似度 0.90，却是两个完全不同的语法点 —— 这类结构说明条目只认
# norm_key 的精确相等。
A_DUP_RATIO = 0.85


def reject_a_pattern(pattern: str, level: str, entries: dict) -> tuple[str, str] | None:
    """A 独有句型的准入检查。返回 None 表示收，否则返回 (统计键, 人读原因)。"""
    if A_VOCAB_PREFIX_RE.match(pattern):
        return ("vocab", "动词活用/词汇卡，非语法句型")
    if A_DRILL_RE.search(pattern):
        return ("drill", "书里的数字读法练习行")
    if "～" not in pattern:
        return None
    bare = re.sub(r"[～~〜\s]", "", pattern)
    for (_, lv), other in entries.items():
        if lv != level or "～" not in other.pattern:
            continue
        ratio = difflib.SequenceMatcher(
            None, bare, re.sub(r"[～~〜\s]", "", other.pattern)
        ).ratio()
        if ratio >= A_DUP_RATIO:
            return ("dup", f"与「{other.pattern}」重复（相似度 {ratio:.2f}）")
    return None


def load_a(deck: Deck, entries: dict, stats: dict, skipped: list) -> None:
    """A 版只做三件事：补 B 没有的句型、挂音频、补 B 没有的例句。"""
    flds = deck.fields(MODEL_A)
    idx = {n: i for i, n in enumerate(flds)}

    def get(parts: list[str], name: str) -> str:
        i = idx.get(name, -1)
        return parts[i] if 0 <= i < len(parts) else ""

    def sound(raw: str) -> str:
        m = SOUND_RE.search(raw or "")
        return m.group(1) if m else ""

    # A 保持牌组内的原始顺序（就是书序），排在 B 的书序之后。
    a_order = 0

    for mid, raw, did in deck.notes:
        if str(mid) != MODEL_A:
            continue
        parts = raw.split("\x1f")
        pattern = clean_pattern(get(parts, "句型"))
        if not pattern:
            continue
        level = deck.level_of(did)
        key = (norm_key(pattern), level)
        entry = entries.get(key)
        is_new = entry is None

        if is_new:
            # 同一句型换个级别在 B 里存在时，说明只是分级不同，不该重复收；
            # 只有 B 完全没收过的句型才从 A 补进来。
            if any(k[0] == key[0] for k in entries):
                stats["a_level_only_diff"] += 1
                continue
            reason = reject_a_pattern(pattern, level, entries)
            if reason:
                stats[f"a_skipped_{reason[0]}"] += 1
                skipped.append({"pattern": pattern, "level": level, "why": reason[1]})
                continue
            entry = Entry(pattern, level)
            entry.origin = "bluebook-a"
            a_order += 1
            entry.order = A_ORDER_BASE + a_order
            entries[key] = entry
            stats["a_only_added"] += 1

        jp_raw = get(parts, "日文").strip()
        jp = strip_html(jp_raw, keep_emphasis=True)
        zh = plain(get(parts, "中文"))

        if is_new:
            conn = plain(get(parts, "接续"))
            conn = re.sub(r"^\s*接続[:：]\s*", "", conn)
            if conn:
                entry.connections.append(conn)
            expl = plain(get(parts, "说明"))
            expl = re.sub(r"^\s*(説明|解释)[:：]\s*", "", expl).strip()
            if expl:
                entry.explains.append(expl)
            for n in range(1, 5):
                v = plain(get(parts, f"注意{n}"))
                v = re.sub(r"^\s*註意[:：]\s*", "", v)
                v = re.sub(r"^[①-⑳]\s*", "", v)
                if v:
                    entry.notes.append(v)
            entry.add_example(jp=jp, zh=zh, tag="", origin="a")
        else:
            # B 已有这个句型：只有当这句 B 确实没有时才补，避免重复例句。
            before = len(entry.examples)
            entry.add_example(jp=jp, zh=zh, tag="", origin="a")
            if len(entry.examples) > before:
                stats["a_extra_examples"] += 1

        # 音频：句型朗读挂条目，例句朗读按『例句发音源』回填到对应例句上。
        pat_audio = sound(get(parts, "句型发音"))
        if pat_audio and not entry.pattern_audio:
            entry.pattern_audio = pat_audio
            stats["pattern_audio"] += 1
        ex_audio = sound(get(parts, "例句发音"))
        if ex_audio:
            src_key = sentence_key(get(parts, "例句发音源")) or sentence_key(jp)
            for ex in entry.examples:
                if sentence_key(ex["jp"]) == src_key and not ex["audio"]:
                    ex["audio"] = ex_audio
                    stats["example_audio"] += 1
                    break


# ---------------------------------------------------------------- 媒体

def drop_dead_media(entries: dict, deck_a: Deck, deck_b: Deck, stats: dict) -> None:
    """卡组里引用了但压缩包里没有的媒体，引用直接清掉。

    A 版有一条「～かたがた」指向 `…(1).mp3` —— 那是导出时重名留下的痕迹，文件
    并不在包里。留着的话前端会照着渲染一个点了没声的播放按钮。
    """
    for entry in entries.values():
        if entry.pattern_audio and not deck_a.media_path(entry.pattern_audio):
            entry.pattern_audio = ""
            stats["dead_media"] += 1
        for ex in entry.examples:
            if ex["audio"] and not deck_a.media_path(ex["audio"]):
                ex["audio"] = ""
                stats["dead_media"] += 1
        kept = [img for img in entry.images if deck_b.media_path(img)]
        stats["dead_media"] += len(entry.images) - len(kept)
        entry.images = kept


# ---------------------------------------------------------------- 媒体导出

def export_media(entries: list[dict], deck_a: Deck, deck_b: Deck, out_dir: str) -> dict:
    audio_dir = os.path.join(out_dir, "audio")
    image_dir = os.path.join(out_dir, "image")
    os.makedirs(audio_dir, exist_ok=True)
    os.makedirs(image_dir, exist_ok=True)
    counts = {"audio": 0, "image": 0, "missing": 0}
    for e in entries:
        wanted = [(e["audioKey"], deck_a, audio_dir, "audio")]
        wanted += [(ex["audio"], deck_a, audio_dir, "audio") for ex in e["examples"]]
        wanted += [(img, deck_b, image_dir, "image") for img in e["images"]]
        for name, deck, dest, kind in wanted:
            if not name:
                continue
            target = os.path.join(dest, name)
            if os.path.exists(target):
                continue
            src = deck.media_path(name)
            if not src or not os.path.exists(src):
                counts["missing"] += 1
                continue
            shutil.copyfile(src, target)
            counts[kind] += 1
    return counts


# ---------------------------------------------------------------- main

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apkg-a", default=DEFAULT_A)
    ap.add_argument("--apkg-b", default=DEFAULT_B)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--media-out", default="")
    args = ap.parse_args()

    for p in (args.apkg_a, args.apkg_b):
        if not os.path.exists(p):
            print(f"找不到 {p}", file=sys.stderr)
            return 2

    stats = defaultdict(int)
    workdir = tempfile.mkdtemp(prefix="bluebook-")
    try:
        deck_b = Deck(args.apkg_b, workdir)
        deck_a = Deck(args.apkg_a, workdir)

        entries: dict = {}
        skipped: list = []
        load_b(deck_b, entries, stats)
        stats["b_entries"] = len(entries)
        load_a(deck_a, entries, stats, skipped)
        drop_dead_media(entries, deck_a, deck_b, stats)

        rows = sorted(
            (e.to_json() for e in entries.values()),
            key=lambda r: (r["level"], r["orderNo"], r["pattern"]),
        )

        os.makedirs(os.path.dirname(args.out), exist_ok=True)
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(rows, f, ensure_ascii=False, indent=1)

        by_level = defaultdict(int)
        ex_total = 0
        no_meaning = no_example = 0
        for r in rows:
            by_level[r["level"]] += 1
            ex_total += len(r["examples"])
            if not r["meaning"]:
                no_meaning += 1
            if not r["examples"]:
                no_example += 1

        print(f"写出 {len(rows)} 条 → {os.path.relpath(args.out, ROOT)}")
        print(f"  级别分布   {dict(sorted(by_level.items()))}")
        print(f"  例句总数   {ex_total}")
        print(f"  B 主干     {stats['b_entries']} 条（组内合并 {stats['b_merged_dupes']} 条重复 note）")
        print(
            f"  A 补句型   {stats['a_only_added']} 条"
            f"（跳过：仅级别不同 {stats['a_level_only_diff']}、"
            f"活用词汇卡 {stats['a_skipped_vocab']}、"
            f"练习行 {stats['a_skipped_drill']}、"
            f"与 B 重复 {stats['a_skipped_dup']}）"
        )
        print(f"  A 补例句   {stats['a_extra_examples']} 句")
        audio_refs = sum(1 for r in rows if r["audioKey"]) + sum(
            1 for r in rows for e in r["examples"] if e["audio"]
        )
        print(
            f"  句型音频   {sum(1 for r in rows if r['audioKey'])}"
            f"   例句音频 {audio_refs - sum(1 for r in rows if r['audioKey'])}"
            f"   清掉死链 {stats['dead_media']}"
        )
        print(f"  缺说明     {no_meaning}   缺例句 {no_example}")

        if skipped:
            report = os.path.join(os.path.dirname(args.out), "skipped-from-a.json")
            with open(report, "w", encoding="utf-8") as f:
                json.dump(skipped, f, ensure_ascii=False, indent=1)
            print(f"  跳过清单   {len(skipped)} 条 → {os.path.relpath(report, ROOT)}")

        if args.media_out:
            counts = export_media(rows, deck_a, deck_b, args.media_out)
            print(f"  媒体导出   音频 {counts['audio']} / 图片 {counts['image']} / 缺失 {counts['missing']} → {args.media_out}")
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
