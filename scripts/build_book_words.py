# Builds public/words.json with the vocabulary book first:
#   1. Terence Wade, «Using Russian Vocabulary» (Cambridge, 2009), in the book's order: unit by unit,
#      levels 1, 2, 3, then the unit's «Additional vocabulary» (off in the app unless switched on).
#      Headword, stress, grammar note and English gloss are copied as printed (see parse_wade.py).
#   2. The rest of the Kelly list, B1 then B2 (for when the book's words run out),
#      with a data-engineering word after every 4 words from the 60th word on, as before.
#   3. Kelly A1 and A2 last: the user is past them, but cards already started keep their reviews.
# A book word that is also on the Kelly list takes over that card's id, so earlier progress counts,
# and borrows its gender, aspect pair and example sentence (Tatoeba or Wiktionary, already sourced).
# Nothing is written by hand.
#
#   python3 parse_wade.py <book or preview PDF> wade_preview.json   (needs pdfplumber)
#   python3 build_book_words.py
import json
import os
import re

S = os.path.dirname(os.path.abspath(__file__))
ACUTE, GRAVE = "́", "̀"

book = json.load(open(f"{S}/wade_preview.json", encoding="utf-8"))
base = json.load(open(f"{S}/base_words.json", encoding="utf-8"))  # Kelly + IT words, as build_words.py makes them


def plain(s):
    return s.replace(ACUTE, "").replace(GRAVE, "").lower().rstrip("?!. ")


core = [w for w in base if w["deck"] == "core"]
work = [w for w in base if w["deck"] == "work"]
core_by = {w["id"]: w for w in core}

book_words, by_id, merged = [], {}, 0
for e in book:
    i = plain(e["ru"])
    if i in by_id:  # the same headword printed twice (e.g. плита́ «cooker», later «(stone) slab»)
        w = by_id[i]
        if e["en"] not in w["en"].split("; "):
            w["en"] += "; " + e["en"]
        merged += 1
        continue
    w = {"id": i, "ru": e["ru"], "en": e["en"]}
    if e["gram"]:
        w["gram"] = e["gram"]
    m = re.match(r"^\((m|f|n)\.", e["gram"] or "")
    if m:
        w["g"] = m.group(1)
    k = core_by.get(i)
    if k:
        own_pair = "/" in e["ru"] or "/" in (e["gram"] or "")  # the book prints its own aspect partner
        for f in ("g",) if own_pair else ("g", "asp", "pair"):
            if f in k and f not in w:
                w[f] = k[f]
    for part in [i] + (i.split("/") if "/" in i else []):
        kk = core_by.get(part)
        if kk and kk.get("ex"):
            w["ex"] = kk["ex"]
            if kk.get("exEn"):
                w["exEn"] = kk["exEn"]
            if kk.get("xs"):
                w["xs"] = kk["xs"]
            break
    w.update({"deck": "book", "lvl": f"U{e['unit']}", "u": e["unit"], "bl": "x" if e["level"] == "extra" else e["level"], "pg": e["page"]})
    by_id[i] = w
    book_words.append(w)

rest = [w for w in core if w["id"] not in by_id]
later = [w for w in rest if w["lvl"] in ("B1", "B2")]
known = [w for w in rest if w["lvl"] in ("A1", "A2")]

out, wi, n = [], 0, 0
for item in book_words + later:
    out.append(item)
    if item.get("bl") == "x":
        continue  # additional vocabulary is off by default, so it doesn't count toward the IT rhythm
    n += 1
    if n >= 60 and n % 4 == 0 and wi < len(work):
        out.append(work[wi])
        wi += 1
out += work[wi:] + known

OUT = os.path.join(S, "..", "public", "words.json")
json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
with_ex = sum(1 for w in book_words if w.get("ex"))
print(f"book: {len(book_words)} words ({merged} repeats merged), {with_ex} with an example from the Kelly entry")
print(f"then Kelly B1–B2: {len(later)}, IT: {len(work)}, Kelly A1–A2 last: {len(known)}; total {len(out)}")
print("size:", os.path.getsize(OUT) // 1024, "KB")
