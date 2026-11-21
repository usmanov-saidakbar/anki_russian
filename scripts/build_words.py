# Builds base_words.json (Kelly + IT words) from published sources only; build_book_words.py then
# puts the vocabulary book first and writes public/words.json. Sources:
#   word list + CEFR level : Kelly project Russian list (ru_m3.xls, Sharoff), A1–B2
#   translation, stress,
#   gender, aspect pairs   : English Wiktionary (kaikki.org extract); OpenRussian as fallback
#   example sentences      : Tatoeba (Russian–English pairs); Wiktionary examples as fallback
#   stress inside examples : OpenRussian word forms
#   work words             : Wiktionary computing entries + Russian Wikidata labels of
#                            data-engineering Wikipedia articles (selection in work_terms.txt)
# Nothing in the output is written by hand: the script only selects, trims and joins.
import csv, gzip, json, re, os, collections, heapq

S = os.path.dirname(os.path.abspath(__file__))
SRC, DL = f"{S}/src", f"{S}/dl"
ACUTE, GRAVE = "́", "̀"
csv.field_size_limit(10**9)


def norm(s):
    s = s.lower().replace("ё", "е").replace("'", "").replace(ACUTE, "").replace(GRAVE, "")
    return re.sub(r"[^а-яa-z0-9 -]", "", s).strip()


# ---------- Kelly list ----------
kelly = json.load(open(f"{S}/kelly.json"))
EXCLUDE = {"оргазм", "педофил", "проститутка", "секс", "порно", "порнография", "наркотик", "кока-кола", "пепси-кола"}
core = []  # (lemma, level, pos, position)
seen = set()
for i, (lemma, lvl, pos, _, ipm) in enumerate(kelly):
    lvl = str(lvl).upper()
    lemma = lemma.strip()
    if lvl not in ("A1", "A2", "B1", "B2") or norm(lemma) in EXCLUDE:
        continue
    key = (norm(lemma), str(pos).lower())
    if key in seen:
        continue
    seen.add(key)
    core.append({"lemma": lemma, "lvl": lvl, "kpos": str(pos).lower(), "pos_i": i})
kelly_pos = {}
for i, r in enumerate(kelly):
    kelly_pos.setdefault(norm(r[0]), i)  # position in the whole Kelly list (A1..C2), for example difficulty

# ---------- Work selection ----------
work_wikt, work_wiki, sec = [], [], None
for line in open(f"{S}/work_terms.txt", encoding="utf-8"):
    line = line.strip()
    if line.startswith("["):
        sec = line
        continue
    if line and not line.startswith("#"):
        (work_wikt if sec == "[wiktionary]" else work_wiki).append(line)
# Wikidata items whose Russian label is a different concept from the English one, or not a term.
WIKIDATA_SKIP = {"Scheduling (computing)", "Configuration file", "Recursion (computer science)", "Database normalization",
                 "Access control", "Exception handling"}
wikidata = []
for o in json.load(open(f"{S}/wikidata_terms.json")):
    if o["enwiki"] in WIKIDATA_SKIP:
        continue
    ru = o["ruwiki"] if o["ruwiki"] and re.search("[а-яё]", o["ruwiki"].lower()) else None
    if not ru and o["ru"] and re.search("[а-яё]", o["ru"].lower()):
        ru = o["ru"]
    if not ru:
        continue
    ru = re.sub(r"\s*\([^)]*\)", "", ru).strip()
    if len(ru) > 1 and ru[1].islower():
        ru = ru[0].lower() + ru[1:]
    wikidata.append({"ru": ru, "en": o["en"], "qid": o["qid"], "order": work_wiki.index(o["enwiki"]) if o["enwiki"] in work_wiki else 999})
wikidata.sort(key=lambda o: o["order"])

# ---------- OpenRussian (forms for stress, fallback translations) ----------
FORM_COLS = {
    "noun": ["sg_nom", "sg_gen", "sg_dat", "sg_acc", "sg_inst", "sg_prep", "pl_nom", "pl_gen", "pl_dat", "pl_acc", "pl_inst", "pl_prep"],
    "verb": ["imperative_sg", "imperative_pl", "past_m", "past_f", "past_n", "past_pl", "presfut_sg1", "presfut_sg2", "presfut_sg3", "presfut_pl1", "presfut_pl2", "presfut_pl3"],
    "adj": ["comparative", "superlative", "short_m", "short_f", "short_n", "short_pl"] + [f"decl_{g}_{c}" for g in ("m", "f", "n", "pl") for c in ("nom", "gen", "dat", "acc", "inst", "prep")],
    "other": [],
}
orus = []
for pos, fn in [("noun", "nouns.csv"), ("verb", "verbs.csv"), ("adj", "adjectives.csv"), ("other", "others.csv")]:
    with open(f"{DL}/{fn}", newline="", encoding="utf-8") as f:
        r = csv.reader(f, delimiter="\t", quoting=csv.QUOTE_NONE)
        header = next(r)
        for row in r:
            rec = dict(zip(header, row))
            bare = rec["bare"].strip()
            if not bare:
                continue
            forms = {}
            for raw in [rec["accented"] or bare] + [rec.get(c, "") for c in FORM_COLS[pos]]:
                for v in re.split(r"[,;/]", raw or ""):
                    v = v.strip().strip("*()").strip()
                    if v and re.fullmatch(r"[А-Яа-яЁё'\- ]+", v):
                        forms.setdefault(norm(v), set()).add(v.lower())
            orus.append({"pos": pos, "bare": bare, "acc": (rec["accented"] or bare).replace("'", ACUTE),
                         "en": rec["translations_en"].strip(), "g": rec.get("gender", ""), "asp": rec.get("aspect", ""),
                         "partner": rec.get("partner", ""), "forms": forms})
orus_by = collections.defaultdict(list)
form_index = collections.defaultdict(set)
for i, L in enumerate(orus):
    orus_by[norm(L["bare"])].append(i)
    for k in L["forms"]:
        form_index[k].add(i)


def stressed_form(token):
    """Stress one word using OpenRussian forms, only if all matching forms agree."""
    opts = set()
    for i in form_index.get(norm(token), ()):
        opts |= orus[i]["forms"][norm(token)]
    if not opts:
        opts = {f.replace(ACUTE, "'") for f in wikt_forms.get(norm(token), ())}
    marked = {a for a in opts if "'" in a or "ё" in a}
    unmarked = [a for a in opts if a not in marked and len(re.findall("[аеёиоуыэюя]", a)) > 1]
    return next(iter(marked)) if len(marked) == 1 and not unmarked else None


def apply_stress(tok, accented):
    letters = accented.replace("'", "")
    if norm(letters) != norm(tok) or len(letters) != len(tok):
        return tok
    out, j = "", 0
    for ch in accented:
        if ch == "'":
            out += ACUTE
            continue
        c = tok[j]
        if letters[j] == "ё" and c in "еЕ":
            c = "ё" if c == "е" else "Ё"
        out += c
        j += 1
    return out


def fix_stress(text):
    text = re.sub("([ёЁ])" + ACUTE, r"\1", text)
    return re.sub(r"[А-Яа-яЁё́]+", lambda m: m.group(0).replace(ACUTE, "") if len(re.findall("[аеёиоуыэюяАЕЁИОУЫЭЮЯ]", m.group(0))) < 2 else m.group(0), text)


def stress_phrase(text):
    def one(m):
        acc = stressed_form(m.group(0))
        return apply_stress(m.group(0), acc) if acc else m.group(0)
    return re.sub(r"[А-Яа-яЁё]+(?:-[А-Яа-яЁё]+)*", one, text)


# ---------- Wiktionary ----------
need = {norm(c["lemma"]) for c in core} | {norm(w) for w in work_wikt} | {norm(t) for o in wikidata for t in re.findall(r"[А-Яа-яЁё-]+", o["ru"])}
wikt = collections.defaultdict(list)
wikt_forms = collections.defaultdict(set)


def load_wikt(keys):
    with gzip.open(f"{SRC}/ru-wikt.jsonl.gz", "rt", encoding="utf-8") as f:
        for line in f:
            e = json.loads(line)
            k = norm(e.get("word", ""))
            if k not in keys:
                continue
            ent = {
                "word": e["word"], "pos": e.get("pos"),
                "head": (e.get("head_templates") or [{}])[0].get("expansion", ""),
                "forms": [(x.get("form", ""), x.get("tags", [])) for x in e.get("forms", [])],
                "senses": [{"g": s.get("glosses", []), "tags": s.get("tags", []), "topics": s.get("topics", []),
                            "fo": (s.get("form_of") or [{}])[0].get("word"),
                            "ex": [x for x in s.get("examples", []) if x.get("english") or x.get("translation")]}
                           for s in e.get("senses", [])],
            }
            wikt[k].append(ent)
            for form, tags in ent["forms"]:
                if re.search(ACUTE + "|ё", form) and "romanization" not in tags and " " not in form.strip():
                    wikt_forms[norm(form)].add(form.strip().lower().replace(GRAVE, ""))


load_wikt(need)
# Kelly sometimes lists a form (дети, может, эти): load the dictionary word it is a form of.
targets = {norm(s["fo"]) for k in need for e in wikt.get(k, []) for s in e["senses"] if s.get("fo")} - set(wikt)
load_wikt(targets)

POSMAP = {"n": {"noun"}, "n prop": {"name", "noun"}, "v": {"verb"}, "v mod": {"verb"}, "adj": {"adj"}, "adv": {"adv"},
          "pron": {"pron", "det"}, "det": {"det", "pron"}, "num": {"num"}, "adpos": {"prep", "postp"}, "prep": {"prep"},
          "con": {"conj"}, "particle": {"particle"}, "excl": {"intj"}, "int": {"intj"}, "abbr": {"abbrev", "noun", "name"},
          "mwe": {"phrase", "noun", "adv", "intj", "prep_phrase", "verb", "adj", "conj", "particle", "proverb"}}
BAD_TAGS = {"form-of", "alt-of", "obsolete", "archaic", "dated", "rare", "dialectal", "historical", "poetic", "misspelling", "obsolete-spelling"}


def good_senses(e):
    return [s for s in e["senses"] if s["g"] and not (set(s["tags"]) & BAD_TAGS)]


def pick_entry(lemma, kpos=None, it=False):
    cands = [e for e in wikt.get(norm(lemma), []) if good_senses(e)]
    if not cands:
        return None
    want = POSMAP.get(kpos or "", None)
    pref = [e for e in cands if want and e["pos"] in want] or cands
    if it:
        pref = [e for e in pref if any("computing" in s["topics"] for s in good_senses(e))] or pref
    # exact spelling (with ё) first, then the entry with the most senses
    return max(pref, key=lambda e: (e["word"].lower() == lemma.lower(), len(good_senses(e))))


def form_of_gloss(lemma, kpos):
    """For Kelly words that Wiktionary only lists as a form of another word (дети, может)."""
    for e in wikt.get(norm(lemma), []):
        for s in e["senses"]:
            if s.get("fo") and s["g"]:
                target = pick_entry(s["fo"])
                if target:
                    note = re.sub(r"\s*\([^)]*\)", "", s["g"][0]).strip().rstrip(":")
                    first = gloss_from(target).split("; ")[0]
                    return {"en": f"{first} ({note})", "e": e}
    return None


def is_vulgar(e):
    gs = good_senses(e)
    return bool(gs) and bool(set(gs[0]["tags"]) & {"vulgar", "offensive"})


def clean_gloss(g):
    g = re.sub(r"\s*\([^()]{26,}\)", "", g)
    if ": " in g and len(g.split(": ", 1)[0]) > 15:
        g = g.split(": ", 1)[1]
    return re.sub(r"\s+", " ", g).strip().rstrip(".").strip()


def gloss_from(e, it_first=False):
    senses = good_senses(e)
    if it_first:
        senses = sorted(senses, key=lambda s: "computing" not in s["topics"])
    out = []
    for s in senses:
        g = clean_gloss(s["g"][-1] if len(s["g"]) > 1 and s["g"][0].endswith(":") else s["g"][0])
        if g and g.lower() not in (x.lower() for x in out):
            out.append(g)
        if len(out) == 3:
            break
    # keep a computing sense even when it isn't among the first three
    it = [clean_gloss(s["g"][0]) for s in senses if "computing" in s["topics"]]
    if it and it[0] not in out:
        out.append(it[0])
    text = "; ".join(out)
    while len(text) > 90 and len(out) > 1:
        out.pop(-2 if it and out[-1] == it[0] and len(out) > 2 else -1)
        text = "; ".join(out)
    if len(text) > 90:
        cut = text[:90]
        text = cut[:max(cut.rfind("; "), cut.rfind(", "))] if max(cut.rfind("; "), cut.rfind(", ")) > 20 else cut
    return text


def head_of(e, lemma):
    h = e["head"].split(" • ")[0].strip() if " • " in e["head"] else ""
    h = h.replace(GRAVE, "")
    if not h or norm(h).replace("?", "") != norm(lemma).replace("?", ""):
        canon = [f for f, t in e["forms"] if "canonical" in t]
        h = canon[0].replace(GRAVE, "").replace(" " + ACUTE, ACUTE) if canon else ""
    if not h or norm(h) != norm(lemma):
        return None
    return h


def grammar_of(e):
    canon = next((t for f, t in e["forms"] if "canonical" in t), [])
    info = {}
    if e["pos"] == "noun":
        if "plural" in canon and any("plural-only" in s["tags"] for s in e["senses"]):
            info["g"] = "pl"
        else:
            for tag, g in (("masculine", "m"), ("feminine", "f"), ("neuter", "n")):
                if tag in canon:
                    info["g"] = g
                    break
    if e["pos"] == "verb":
        a = "impf" if "imperfective" in canon else "pf" if "perfective" in canon else None
        if a and not ("imperfective" in canon and "perfective" in canon):
            info["asp"] = a
            other = "perfective" if a == "impf" else "imperfective"
            pairs = []
            for f, t in e["forms"]:
                if other in t and "canonical" not in t and "infinitive" not in t and f not in pairs and re.search("[а-яё]", f):
                    pairs.append(f)
            if pairs:
                info["pair"] = ", ".join(pairs[:2])
    return info


def orus_fallback(lemma, kpos):
    want = {"n": "noun", "v": "verb", "adj": "adj"}.get(kpos)
    idx = orus_by.get(norm(lemma), [])
    idx = [i for i in idx if orus[i]["en"]]
    if not idx:
        return None
    i = next((i for i in idx if orus[i]["pos"] == want), idx[0])
    L = orus[i]
    senses = [s.strip() for s in L["en"].split(";") if s.strip()][:2]
    en = "; ".join(", ".join(x.strip() for x in s.split(",")[:3]) for s in senses)
    info = {}
    if L["pos"] == "noun" and L["g"] in ("m", "f", "n"):
        info["g"] = L["g"]
    if L["pos"] == "verb" and L["asp"] in ("perfective", "imperfective"):
        info["asp"] = "pf" if L["asp"] == "perfective" else "impf"
        p = [x.strip() for x in L["partner"].split(",") if re.search("[а-яё]", x)]
        if p:
            accs = [orus[orus_by[norm(x)][0]]["acc"] if orus_by.get(norm(x)) else x for x in p[:2]]
            info["pair"] = ", ".join(accs)
    return {"ru": L["acc"], "en": en[:90], **info}


# ---------- Assemble entries ----------
words, stats = [], collections.Counter()
ids = set()


def make_id(ru):
    base = ru.replace(ACUTE, "").replace(GRAVE, "").lower().rstrip("?!. ")
    i, k = base, 2
    while i in ids:
        i, k = f"{base}#{k}", k + 1
    ids.add(i)
    return i


core_keys, seen_cards = {}, set()
for c in core:
    e = pick_entry(c["lemma"], c["kpos"])
    item = None
    if e and is_vulgar(e):
        stats["dropped (vulgar)"] += 1
        continue
    if not e:
        fo = form_of_gloss(c["lemma"], c["kpos"])
        if fo:
            ru = head_of(fo["e"], c["lemma"]) or stress_phrase(c["lemma"])
            item = {"ru": ru, "en": fo["en"], "tr": "wikt"}
            stats["translation via form-of"] += 1
    if e:
        en = gloss_from(e)
        ru = head_of(e, c["lemma"]) or (orus_fallback(c["lemma"], c["kpos"]) or {}).get("ru") or c["lemma"]
        if en:
            item = {"ru": ru, "en": en, **grammar_of(e), "tr": "wikt"}
    if not item:
        fb = orus_fallback(c["lemma"], c["kpos"])
        if fb:
            item = {**fb, "tr": "or"}
    if not item:
        stats["dropped (no translation)"] += 1
        continue
    item["ru"] = item["ru"].replace(GRAVE, "")
    if (item["ru"], item["en"]) in seen_cards:
        stats["merged (same word and meaning)"] += 1
        continue
    seen_cards.add((item["ru"], item["en"]))
    item = {"id": make_id(item["ru"]), **item, "lvl": c["lvl"], "deck": "core"}
    item["_k"] = norm(c["lemma"])
    item["_rank"] = c["pos_i"]
    core_keys[norm(c["lemma"])] = item
    words.append(item)
    stats[f"core {c['lvl']}"] += 1
    stats[f"translation from {item['tr']}"] += 1

work = []
for w in work_wikt:
    if norm(w) in core_keys:  # already in the B2 list: tag it, and make sure the computing sense is shown
        item = core_keys[norm(w)]
        item["work"] = 1
        e = pick_entry(w, it=True)
        if e and item["tr"] == "wikt":
            item["en"] = gloss_from(e)
        stats["work word already in B2 list"] += 1
        continue
    e = pick_entry(w, it=True)
    if not e:
        stats["work word missing in Wiktionary"] += 1
        print("  no Wiktionary entry:", w)
        continue
    en, ru = gloss_from(e, it_first=True), head_of(e, w) or stress_phrase(w)
    item = {"id": make_id(ru), "ru": ru.replace(GRAVE, ""), "en": en, **grammar_of(e), "tr": "wikt", "lvl": "IT", "deck": "work", "_k": norm(w), "_rank": 10**6}
    work.append(item)
for o in wikidata:
    same = core_keys.get(norm(o["ru"])) or next((x for x in work if x["_k"] == norm(o["ru"])), None)
    if same:
        same["work"] = 1
        if o["en"].lower() not in same["en"].lower():
            same["en"] = f"{same['en']}; {o['en']} (IT)"
        continue
    ru = stress_phrase(o["ru"])
    work.append({"id": make_id(ru), "ru": ru, "en": o["en"], "tr": "wd:" + o["qid"], "lvl": "IT", "deck": "work", "_k": norm(o["ru"]), "_rank": 10**6})
stats["work words (separate)"] = len(work)

# ---------- Examples from Tatoeba ----------
known_rank = {}  # OpenRussian lemma index -> Kelly position (lower = easier)
for i, L in enumerate(orus):
    if norm(L["bare"]) in kelly_pos:
        known_rank[i] = kelly_pos[norm(L["bare"])]
target_of = collections.defaultdict(list)  # OpenRussian lemma index -> our word items
for item in words + work:
    if " " in item["_k"]:
        continue
    for i in orus_by.get(item["_k"], []):
        target_of[i].append(item)
phrases = collections.defaultdict(list)  # first word -> multi-word items
for item in words + work:
    if " " in item["_k"]:
        phrases[item["_k"].split()[0]].append(item)

links = collections.defaultdict(list)
with open(f"{SRC}/rus-eng_links.tsv", encoding="utf-8") as f:
    for line in f:
        a, b = line.rstrip("\n").split("\t")
        links[int(a)].append(int(b))
need_eng = {e for es in links.values() for e in es}
eng = {}
with open(f"{SRC}/eng_sentences.tsv", encoding="utf-8") as f:
    for line in f:
        sid, _, text = line.rstrip("\n").split("\t", 2)
        if int(sid) in need_eng:
            eng[int(sid)] = text

TOK = re.compile(r"[А-Яа-яЁё]+(?:-[А-Яа-яЁё]+)*")
NAMES = re.compile(r"^(том|тома|тому|томом|томе|мэри|джон|джона|джону|джоном|джоне|лейла|лейлы|лейле|лейлу|лейлой|сами|кен|кена|кену|боб|джим|майк|джек|джека|фадиль|фадил)$")
BAD = re.compile(r"[A-Za-z0-9*\[\]{}<>_#@/\\|~]")
cands = collections.defaultdict(list)
sentences = {}
with open(f"{SRC}/rus_sentences.tsv", encoding="utf-8") as f:
    for line in f:
        sid, _, text = line.rstrip("\n").split("\t", 2)
        sid = int(sid)
        if sid not in links or BAD.search(text) or len(text) > 75:
            continue
        toks = [(m.group(0), m.start(), m.end()) for m in TOK.finditer(text)]
        if not 3 <= len(toks) <= 10:
            continue
        if any(NAMES.match(t.lower()) for t, _, _ in toks) or any(t[0].isupper() for t, _, _ in toks[1:]):
            continue
        lem = [form_index.get(norm(t), set()) for t, _, _ in toks]
        ranks = [min((known_rank[i] for i in L if i in known_rank), default=None) for L in lem]
        unknown = sum(1 for r in ranks if r is None)
        if unknown > 1:
            continue
        en_opts = sorted((eng[e] for e in links[sid] if e in eng), key=len)
        if not en_opts or len(en_opts[0]) > 90:
            continue
        hits = []
        for ti, L in enumerate(lem):
            for i in L:
                for item in target_of.get(i, ()):
                    other_lemma = any(norm(orus[j]["bare"]) == norm(toks[ti][0]) and norm(orus[j]["bare"]) != item["_k"] for j in L)
                    hits.append((item, ti, 2 if other_lemma else len(L) > 1))
        low = None
        for t, _, _ in toks:
            for item in phrases.get(norm(t), ()):
                low = low or f" {norm(text)} "
                if f" {item['_k']} " in low:
                    hits.append((item, None, False))
        if not hits:
            continue
        sentences[sid] = (text, en_opts[0], toks)
        for item, ti, amb in hits:
            if amb and (item.get("work") or item["deck"] == "work"):
                continue  # IT meanings are rare in Tatoeba: only trust sentences where the word can't be another word
            limit = max(item["_rank"] if item["_rank"] < 10**6 else 2000, 1500)
            hard = sum(1 for j, r in enumerate(ranks) if j != ti and (r is None or r > limit))
            sc = hard * 10 + unknown * 6 + abs(len(toks) - 6) + (20 if amb == 2 else 6 if amb else 0)
            h = cands[item["id"]]
            entry = (-sc, -sid, ti if ti is not None else -1)
            if len(h) < 5:
                heapq.heappush(h, entry)
            elif entry > h[0]:
                heapq.heapreplace(h, entry)

used = collections.Counter()
for item in words + work:
    best = sorted(cands.get(item["id"], []), reverse=True)
    pick = next((b for b in best if used[-b[1]] == 0), best[0] if best else None)
    if pick and -pick[0] < 25:
        sid, ti = -pick[1], pick[2]
        used[sid] += 1
        text, en, toks = sentences[sid]
        if ti >= 0:
            t, a, b = toks[ti]
            acc = None
            for i in orus_by.get(item["_k"], []):
                forms = orus[i]["forms"].get(norm(t))
                if forms:
                    marked = {x for x in forms if "'" in x or "ё" in x}
                    acc = next(iter(marked)) if len(marked) == 1 else None
                    break
            word = apply_stress(t, acc) if acc else t
            item["ex"] = text[:a] + "*" + word + "*" + text[b:]
        else:
            k = item["_k"]
            m = re.search(r"(?i)(?<![А-Яа-яЁё])" + r"\s+".join(re.escape(x).replace("е", "[её]") for x in k.split()) + r"(?![А-Яа-яЁё])", text)
            item["ex"] = text[:m.start()] + "*" + m.group(0) + "*" + text[m.end():] if m else text
        item["exEn"] = en
        item["xs"] = f"tat:{sid}"
        stats["example from Tatoeba"] += 1
        continue
    # Wiktionary example, if short enough
    e = pick_entry(item["_k"]) if item["tr"] == "wikt" else None
    ex = None
    if e:
        for s in good_senses(e):
            for x in s["ex"]:
                tr = x.get("english") or x.get("translation")
                if x.get("text") and tr and len(x["text"]) <= 90 and len(tr) <= 110 and not BAD.search(x["text"].replace("—", "")):
                    ex = (x["text"], tr)
                    break
            if ex:
                break
    if ex:
        forms = {norm(f) for f, t in e["forms"]} | {norm(e["word"])}
        text = ex[0].replace(GRAVE, "")
        m = next((m for m in TOK.finditer(text) if norm(m.group(0)) in forms), None)
        item["ex"] = text[:m.start()] + "*" + m.group(0) + "*" + text[m.end():] if m else text
        item["exEn"] = ex[1]
        item["xs"] = "wikt"
        stats["example from Wiktionary"] += 1
    else:
        stats["no example"] += 1

# ---------- Order: B2 list in Kelly order, one work word after every 4 ----------
wk = [x for x in work if x["tr"] == "wikt"]
wd = [x for x in work if x["tr"] != "wikt"]
work = [x for pair in zip(wk, wd) for x in pair] + wk[len(wd):] + wd[len(wk):]
out, wi = [], 0
for n, item in enumerate(words, 1):
    out.append(item)
    if n >= 60 and n % 4 == 0 and wi < len(work):
        out.append(work[wi])
        wi += 1
out += work[wi:]
for item in out:
    for f in ("ru", "pair", "ex"):
        if f in item:
            item[f] = fix_stress(item[f])
    item.pop("_k", None)
    item.pop("_rank", None)
OUT = os.path.join(S, "base_words.json")  # build_book_words.py then puts the book first and writes public/words.json
json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
for k, v in sorted(stats.items()):
    print(f"{k}: {v}")
print("total:", len(out), "| size:", os.path.getsize(OUT) // 1024, "KB")
