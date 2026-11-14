#!/bin/sh
# Downloads the large source files that build_words.py reads. They are not committed (see .gitignore).
set -e
cd "$(dirname "$0")"
mkdir -p src dl
curl -L -o src/ru_m3.xls https://ssharoff.github.io/kelly/ru_m3.xls
curl -L -o src/ru-wikt.jsonl.gz https://kaikki.org/dictionary/Russian/kaikki.org-dictionary-Russian.jsonl.gz
for f in rus/rus_sentences.tsv eng/eng_sentences.tsv rus/rus-eng_links.tsv; do
  curl -L "https://downloads.tatoeba.org/exports/per_language/$f.bz2" | bunzip2 > "src/$(basename "$f")"
done
for f in nouns verbs adjectives others; do
  curl -L -o "dl/$f.csv" "https://raw.githubusercontent.com/Badestrand/russian-dictionary/master/$f.csv"
done
