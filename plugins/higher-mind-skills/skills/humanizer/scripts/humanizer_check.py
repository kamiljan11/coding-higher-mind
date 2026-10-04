#!/usr/bin/env python3
"""humanizer_check: mechanical scan for AI-writing tells (PL/EN). Usage: python humanizer_check.py file.txt [--article]
--article also checks the toRzeszow pen rhythm targets.
Prints JSON. It flags candidates; a human/LLM decides. Exit 0 always."""
import json, re, statistics, sys
t = open(sys.argv[1], encoding="utf-8").read()
article = "--article" in sys.argv
paras = [p.strip() for p in re.split(r"\n\s*\n|\n", t) if p.strip()]
def sents(s):
    return [x.strip() for x in re.split(r"(?<=[.!?…])\s+(?=[„\"(A-ZĄĆĘŁŃÓŚŹŻ0-9])", s) if x.strip()]
S = [x for p in paras for x in sents(p)]
wc = lambda s: len(re.findall(r"[\wąćęłńóśźżĄĆĘŁŃÓŚŹŻ]+(?:[-'][\w]+)*", s))
L = [wc(s) for s in S] or [0]
hits = {}
def add(k, v):
    if v: hits.setdefault(k, []).append(v)
# dashes
for m in re.finditer(r"—|–| -- | - ", t): add("dash", t[max(0,m.start()-30):m.end()+30].replace("\n"," "))
# not-X-but-Y (PL/EN)
NXY = [r"\bto nie\b[^.]{0,60}[,.]\s*to\b", r"\bnie tylko\b[^.]{0,80}\b(ale|lecz)\b", r"\bnie chodzi o\b[^.]{0,80}\b(lecz|ale|tylko)\b",
       r"\bnie\s+\w+[^.]{0,40},\s*(lecz|tylko)\b", r"\bnot (just|only|merely)\b", r"\bit'?s not\b[^.]{0,50}\bit'?s\b",
       r"\bthis (does not|doesn't) mean\b", r"\brather than\b"]
for p in NXY:
    for m in re.finditer(p, t, re.I): add("not_x_but_y", m.group(0))
# banned phrases
BAN = ["warto (zauważyć|podkreślić|pamiętać|zaznaczyć)", "co więcej", "nie da się ukryć", "jedno jest pewne", "podsumowując",
       "w dzisiejszych czasach", "w dzisiejszym świecie", "w erze cyfrowej", "na przestrzeni", "w kontekście", "kluczow\\w+", "istotn\\w+",
       "niezwykle", "kompleksow\\w+", "innowacyjn\\w+", "przełomow\\w+", "dedykowan\\w+", "pochylić się", "stanowi\\w*", "pozwala na",
       "umożliwia\\w*", "zapewnia\\w*", "przyczynia\\w* się", "odgrywa\\w*", "po prostu", "wprost",
       "delve", "tapestry", "landscape", "leverage", "seamless\\w*", "robust", "unlock", "elevate", "pivotal", "crucial", "showcas\\w+",
       "underscore\\w*", "testament", "vibrant", "meticulous\\w*", "game-?changer", "here's the thing", "at the end of the day",
       "let's dive", "in today's", "genuinely", "honestly", "actually", "notably", "importantly", "ultimately", "essentially"]
for b in BAN:
    for m in re.finditer(r"\b" + b + r"\b", t, re.I): add("banned_phrase", m.group(0))
# fragment rows: 3+ consecutive sentences <=4 words
run = []
for s, n in zip(S, L):
    run = run + [s] if n <= 4 else []
    if len(run) == 3: add("fragment_row", " ".join(run))
# anaphora inside a sentence: "ten sam głos, ten sam sposób"
for m in re.finditer(r"\b(\w+ \w+) \w+(?: \w+)?, \1\b", t, re.I): add("anaphora", m.group(0))
# paragraph closers: short last sentence (<=7 words) of a multi-sentence paragraph
for p_ in paras:
    ss = sents(p_)
    if len(ss) > 1 and wc(ss[-1]) <= 7: add("paragraph_closer_check", ss[-1])
# kiedyś/dziś symmetry and aphorism-ish "X stał(a) się ... jak"
for m in re.finditer(r"\bkiedyś\b[^.]*\.\s*(dziś|teraz)\b", t, re.I): add("then_now_symmetry", m.group(0)[:80])
for m in re.finditer(r"\b(stał[aoy]? się|to jak|jest jak|is like|became)\b[^.]{0,50}", t, re.I): add("metaphor_check", m.group(0))
# one-sentence paragraphs (closers)
for p in paras:
    if len(sents(p)) == 1 and wc(p) <= 14: add("one_line_paragraph", p)
# triads "a, b i c"
for m in re.finditer(r"\b\w+, \w+(?: \w+)? (i|oraz|and|or|lub|albo) \w+\b", t): add("triad_check", m.group(0))
# callback ending: last paragraph shares 3+ word n-gram with first paragraph
def grams(s, n=3):
    w = re.findall(r"\w+", s.lower()); return {" ".join(w[i:i+n]) for i in range(len(w)-n+1)}
if len(paras) > 2:
    common = grams(paras[0]) & grams(paras[-1])
    if common: add("callback_ending", sorted(common)[:3])
# typography
if re.search(r"[ąćęłńóśźż]", t) and re.search(r"\"[^\"]+\"", t): add("straight_quotes_in_polish", re.search(r"\"[^\"]+\"", t).group(0))
add("exclamations", t.count("!") or None)
# stats
W = sum(L); mean = statistics.mean(L); cv = (statistics.pstdev(L) / mean * 100) if mean else 0
short = sum(n <= 6 for n in L) / len(L) * 100; long_ = sum(n >= 25 for n in L) / len(L) * 100
nom = len(re.findall(r"\b\w+(anie|enie|ość|acja|acji|aniu|eniu|ości)\b", t, re.I)) / max(W, 1) * 100
q = t.count("?") / max(W, 1) * 1000
stats = {"words": W, "sentences": len(S), "mean_len": round(mean, 1), "cv_pct": round(cv), "short_le6_pct": round(short),
         "long_ge25_pct": round(long_), "nominal_per100": round(nom, 1), "questions_per1000": round(q, 1)}
targets = {"mean_len": (11, 14), "cv_pct": (60, 999), "short_le6_pct": (18, 25), "long_ge25_pct": (0, 8), "nominal_per100": (0, 3.5)}
if article: targets["questions_per1000"] = (2, 5)
off = {k: stats[k] for k, (lo, hi) in targets.items() if not lo <= stats[k] <= hi} if article else {}
hard = {k: len(v) for k, v in hits.items() if k in ("dash", "not_x_but_y", "banned_phrase", "fragment_row", "callback_ending", "then_now_symmetry", "anaphora", "exclamations", "straight_quotes_in_polish")}
print(json.dumps({"verdict": "CLEAN" if not hard and not off else "FIX", "hard_tells": hard, "rhythm_off_target": off,
                  "stats": stats, "review_candidates": {k: v for k, v in hits.items()}}, ensure_ascii=False, indent=1))
