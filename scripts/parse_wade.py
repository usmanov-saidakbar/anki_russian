"""Extract the vocabulary lists from Terence Wade, *Using Russian Vocabulary* (CUP 2009).

Works on the publisher's preview PDF (Unit 1 + start of Unit 2) and on the full book, which
uses the same layout. Copies headwords, the grammar notes printed next to them and the
English glosses exactly as printed; nothing is written by hand.

Layout facts this relies on (checked on the preview):
- Russian is set in a Cyrillic font (TimesNRomCyrMT) whose Latin-looking letters a, e, p, c,
  x, y, H, B, P ... are really Cyrillic: they are mapped back to Cyrillic.
- Stress is a separate acute glyph (´) and ё is a separate diaeresis (¨) printed above the
  vowel: each is attached to the Cyrillic letter under it.
- In word lists the English column starts at a fixed x (about 287 pt); a Russian entry starts
  at the left margin and wraps with an indent.
- Headings are semibold (section) and semibold italic (subsection); notes such as
  "Word origins:" follow a list until the next heading; exercises run from "Exercises" to the
  next "Level N" heading or "Additional vocabulary".

Usage: python parse_wade.py book.pdf out.json [first_book_page_offset]
"""
import json
import re
import sys
from collections import Counter

import pdfplumber

PDF, OUT = sys.argv[1], sys.argv[2]
OFFSET = int(sys.argv[3]) if len(sys.argv) > 3 else 12  # book page = pdf page - OFFSET
DEBUG = {int(x) for x in sys.argv[4].split(",")} if len(sys.argv) > 4 else set()

HOMO = str.maketrans({
    "a": "а", "e": "е", "o": "о", "p": "р", "c": "с", "x": "х", "y": "у", "k": "к", "m": "м",
    "A": "А", "B": "В", "C": "С", "E": "Е", "H": "Н", "K": "К", "M": "М", "O": "О", "P": "Р",
    "T": "Т", "X": "Х", "Y": "У",
})
CYR_FONT = "Cyr"
ACUTE = "́"
VOWELS = set("аеёиоуыэюяАЕЁИОУЫЭЮЯ")
UNITS = [
    (1, 3, "Towns and buildings. The household. Gardens"),
    (2, 40, "The physical world"),
    (3, 76, "The human body and health"),
    (4, 122, "Appearance and movement"),
    (5, 163, "Personality and human behaviour"),
    (6, 205, "Clothes, footwear, and accessories. Food and drink"),
    (7, 232, "Perception"),
    (8, 259, "Shapes and patterns. Size and quantity. Containers"),
    (9, 286, "Visual and performing arts"),
    (10, 314, "Literature and literary criticism. Speaking, reading, and writing"),
    (11, 341, "Leisure"),
    (12, 367, "Tourism, travel, and transport"),
    (13, 397, "Family, birth, death, and marriage"),
    (14, 423, "Education"),
    (15, 451, "Agriculture. Industry"),
    (16, 478, "Business and commerce"),
    (17, 507, "The office and computing. Post and telecommunications"),
    (18, 530, "Law and finance"),
    (19, 557, "Key to exercises"),
]


def unit_of(page):
    u = None
    for n, start, _ in UNITS:
        if page >= start:
            u = n
    return u


def is_cyr(ch):
    return CYR_FONT in ch["fontname"]


def build_lines(chars):
    """Group chars into visual lines and attach accents to the vowel under them."""
    marks = [c for c in chars if c["text"] in ("´", "¨")]
    letters = [dict(c) for c in chars if c["text"] not in ("´", "¨") and c["text"].strip()]
    for c in letters:
        if is_cyr(c):
            c["text"] = c["text"].translate(HOMO)
        c["mark"] = ""
    for m in marks:
        mid = (m["x0"] + m["x1"]) / 2
        best, bd = None, 99
        for c in letters:
            if abs(c["top"] - m["top"]) > 3 or c["text"].translate(HOMO) not in VOWELS:
                continue
            if c["x0"] - 0.6 <= mid <= c["x1"] + 0.6:
                d = abs((c["x0"] + c["x1"]) / 2 - mid)
                if d < bd:
                    best, bd = c, d
        if best is not None:
            best["mark"] = "ё" if m["text"] == "¨" else "acute"
    # lines
    letters.sort(key=lambda c: (round(c["top"]), c["x0"]))
    lines = []
    for c in letters:
        mid = c["top"] + (c["bottom"] - c["top"]) / 2
        for ln in lines:
            if abs(ln["mid"] - mid) < 3.2:
                ln["chars"].append(c)
                break
        else:
            lines.append({"mid": mid, "chars": [c]})
    out = []
    for ln in sorted(lines, key=lambda l: l["mid"]):
        cs = sorted(ln["chars"], key=lambda c: c["x0"])
        out.append({"top": ln["mid"], "chars": cs})
    return out


def render(cs):
    """Text of a run of chars, with spaces from gaps and stress marks applied."""
    s = ""
    prev = None
    for c in cs:
        if prev is not None:
            gap = c["x0"] - prev["x1"]
            size = min(c["size"], prev["size"])
            if gap > 0.18 * size:
                s += " "
        t = c["text"]
        if c.get("mark"):
            t = t.translate(HOMO)
        if c.get("mark") == "ё":
            t = {"е": "ё", "Е": "Ё"}.get(t, t)
        elif c.get("mark") == "acute" and t in VOWELS:
            t = t + ACUTE
        s += t
        prev = c
    s = re.sub(r"\s+", " ", s).strip()
    return " ".join(fix_token(tok) for tok in s.split(" "))


def fix_token(tok):
    # a word with any Cyrillic letter is Cyrillic: stray Latin look-alikes become Cyrillic
    if re.search(r"[А-Яа-яЁё]", tok):
        return tok.translate(HOMO)
    return tok


def font_kind(c):
    f = c["fontname"]
    if "SemiBoldItalic" in f:
        return "subhead"
    if "SemiBold" in f or "Bold" in f:
        return "head"
    if "Italic" in f:
        return "italic"
    return "cyr" if is_cyr(c) else "roman"


NOTE_LABEL = re.compile(
    r"^(Word formation|Word origins?|Origins?|Cognates|Generic words|Phraseology|Literary|Lirerary|Meanings?|"
    r"Note|NB|Usage|Grammar|Stress|Spelling|Proverb|Sayings?|Idioms?|Cultural|Historical|Etymology|"
    r"Similes?|Synonyms?|Antonyms?|Pronunciation|Abbreviations?|See also|Also|«)",
)


def strip_stress_mono(word):
    # the book marks stress on one-syllable words too; drop it there (no information lost)
    def fix(tok):
        if sum(ch in VOWELS for ch in tok) == 1:
            return tok.replace(ACUTE, "")
        return tok

    return re.sub(r"[А-Яа-яЁё́-]+", lambda m: fix(m.group(0)), word)


def main():
    pdf = pdfplumber.open(PDF)
    entries = []
    state = {"unit": None, "level": None, "section": "", "sub": "", "mode": "skip"}
    curs = {}
    pending = {0: [], 1: []}

    def flush(ci):
        e = curs.get(ci)
        if e and e["ru_raw"].strip() and e["en"].strip():
            pending[ci].append(e)
        curs[ci] = None

    def flush_all():
        # a two-column block reads down the left column, then the right one
        for ci in (0, 1):
            flush(ci)
        for ci in (0, 1):
            entries.extend(pending[ci])
            pending[ci] = []

    for pi, page in enumerate(pdf.pages):
        bpage = pi + 1 - OFFSET
        if bpage < 3:
            continue
        unit = unit_of(bpage)
        if unit is None or unit > 18:
            continue
        if unit != state["unit"]:
            flush_all()
            state.update(unit=unit, level=None, section="", sub="", mode="skip")
        lines = build_lines(page.chars)
        lm = Counter(round(ln["chars"][0]["x0"]) for ln in lines if ln["chars"][0]["top"] > 40)
        left_margin = lm.most_common(1)[0][0] if lm else 149
        # runs after a wide gap: Cyrillic ones mean a second word column (Additional vocabulary)
        en_starts, ru2_starts = Counter(), Counter()
        for ln in lines:
            cs = ln["chars"]
            for a, b in zip(cs, cs[1:]):
                if b["x0"] - a["x1"] > 9:
                    (ru2_starts if is_cyr(b) else en_starts)[round(b["x0"])] += 1
        ru2 = None
        if ru2_starts:
            x, n = ru2_starts.most_common(1)[0]
            if n >= 3 and x > left_margin + 100:
                ru2 = x
        if ru2:
            cols = [(left_margin, ru2 - 4), (ru2, 9999)]
        else:
            cols = [(left_margin, 9999)]
        # gloss start for each column: most common start of a non-Cyrillic run after a gap
        gloss = []
        for lo, hi in cols:
            cand = Counter({x: n for x, n in en_starts.items() if lo + 60 < x < hi})
            gloss.append(cand.most_common(1)[0][0] if cand else lo + 138)
        for ln in lines:
            cs = ln["chars"]
            text = render(cs)
            first = cs[0]
            kind = font_kind(first)
            if first["top"] < 40:
                continue  # running head / page number
            if re.fullmatch(r"\d+", text) and first["top"] > 600:
                continue
            if kind == "head" and re.match(r"^Level\s*(\d)", text):
                lvl = int(re.match(r"^Level\s*(\d)", text).group(1))
                if state["mode"] == "skip" and lvl == state["level"]:
                    continue  # "Exercises / Level 1": the header of the exercises, not a new word list
                flush_all()
                state.update(level=lvl, mode="list", section="", sub="")
                continue
            if kind == "head" and text.startswith("Exercises"):
                flush_all()
                state["mode"] = "skip"
                continue
            if kind == "head" and text.replace(" ", "").startswith("Additionalvocabulary"):
                flush_all()
                state.update(level="extra", mode="list", section="", sub="")
                continue
            if kind == "head" and re.match(r"^Unit\s*\d", text):
                continue
            if state["mode"] == "skip":
                continue
            if kind == "head" and first["size"] >= 11.5:
                flush_all()
                state.update(section=text, sub="", mode="list")
                continue
            if kind == "subhead" or kind == "head":
                # semibold italic, or a smaller bold heading (e.g. a Russian one: «Поведение животных»)
                flush_all()
                state.update(sub=text, mode="list")
                continue
            if state["mode"] == "note":
                continue
            if kind in ("italic", "roman") and NOTE_LABEL.match(text.replace(" ", "")):
                flush_all()
                state["mode"] = "note"
                continue
            if kind in ("italic", "roman") and first["x0"] <= left_margin + 2 and not any(is_cyr(c) for c in cs[:6]):
                flush_all()
                state["mode"] = "note"
                continue
            if DEBUG and bpage in DEBUG:
                print(bpage, state["mode"], kind, round(first["x0"]), cols, gloss, "|", text[:90])
            for ci, ((lo, hi), gx) in enumerate(zip(cols, gloss)):
                seg = [c for c in cs if lo - 3 <= c["x0"] < hi]
                if not seg:
                    continue
                # split Russian | English at the first wide gap near the gloss column
                cut = len(seg)
                if seg[0]["x0"] >= gx - 12:
                    cut = 0
                else:
                    for i in range(1, len(seg)):
                        if seg[i]["x0"] >= gx - 14 and seg[i]["x0"] - seg[i - 1]["x1"] > 4:
                            cut = i
                            break
                left, right = seg[:cut], seg[cut:]
                ltext, rtext = render(left), render(right)
                starts_entry = bool(left) and left[0]["x0"] <= lo + 3 and any(is_cyr(c) for c in left[:3])
                if starts_entry:
                    flush(ci)
                    curs[ci] = {"ru_raw": ltext, "en": rtext, "unit": unit, "level": state["level"],
                                "section": state["section"], "sub": state["sub"], "page": bpage}
                elif curs.get(ci) is not None:
                    if ltext:
                        curs[ci]["ru_raw"] = (curs[ci]["ru_raw"] + " " + ltext).strip()
                    if rtext:
                        curs[ci]["en"] = (curs[ci]["en"] + " " + rtext).strip()
        flush_all()
    flush_all()

    out = []
    for e in entries:
        raw = re.sub(r"\s+", " ", e["ru_raw"]).strip()
        # an English word printed just after a closing bracket belongs to the gloss column
        mv = re.search(r"\)\s+([a-z][a-z ,;'-]*)$", raw)
        if mv:
            raw = raw[: mv.start(1)].strip()
            e["en"] = (mv.group(1).strip() + " " + e["en"]).strip()
        # headword = text before the first bracket; brackets hold grammar notes
        raw = re.sub(r"/\s+", "/", raw)  # a pair split over two lines: «подра́внивать/ подровня́ть»
        if ")" in raw and "(" not in raw:
            # the book prints one entry without its opening bracket: «подстрига́ть/подстри́чь подстригу́ …)»
            mm = re.match(r"^(\S+/\S+)\s+(.*\))$", raw)
            if mm:
                raw = mm.group(1) + " (" + mm.group(2)
        m = re.match(r"^([^()]+?)\s*(\(.*)?$", raw)
        head = m.group(1).strip() if m else raw
        gram = (m.group(2) or "").strip() if m else ""
        head = strip_stress_mono(head)
        en = re.sub(r"\s+", " ", e["en"]).strip().replace("ﬂ", "fl").replace("ﬁ", "fi").replace("ﬀ", "ff")
        en = re.sub(r"\s+([,.;:)])", r"\1", en)
        out.append({
            "ru": head, "gram": strip_stress_mono(gram), "en": en,
            "unit": e["unit"], "level": e["level"], "section": e["section"], "sub": e["sub"], "page": e["page"],
        })
    json.dump(out, open(OUT, "w"), ensure_ascii=False, indent=1)
    print(len(out), "entries")


main()
