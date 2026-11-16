# Слово за словом

A flashcard app for learning Russian vocabulary up to B2, with spaced repetition and word tests. It is a plain static site: open `public/index.html` or host the `public/` folder anywhere.

**Live:** https://anki-russian.onrender.com/

- **6,746 words from A1 to B2**, in the order of the Kelly project's Russian list.
- **169 data-engineering and IT terms**: after the first 60 words, every fifth new word is one of them.
- **Your own words**: type `'` after the stressed vowel (`доро'жка` becomes `доро́жка`).
- **Spaced repetition with FSRS-5**, the algorithm Anki uses, with its default weights.
- **Word tests** on words you've already learned. A wrong answer sends the word back to your study cards.
- **Today's words**: the home screen lists the day's new words and marks the ones you've already started, so each day has a clear goal. When the queue is empty, the day ends with "All done for today".
- **Words grouped by study day**: the Words view groups the dictionary into Today, Tomorrow, "In N days" (the upcoming daily batches) and the days you learned words on, instead of one endless list. Search and filters still work across all days.
- **Sync between devices** by email, through the python_deepdive server.

## How a day works

1. **Start.** New words come first as a card with the meaning, stress, grammar (gender, aspect pair) and an example sentence.
   - Press **Got it** to learn the word, or **I know it** to skip it. A skipped word comes back for a check in 10 to 25 days.
2. **Checks.** A minute later, and again about ten minutes later, the app checks you. Think of the answer, press **Show answer**, then rate yourself:
   - **Again**, **Hard**, **Good** or **Easy**.
   - Each button shows when the word will come back.
3. **Reviews.** Words you've learned come back for review on later days. Each session mixes two reviews with one new word.
4. **Test.** Answer questions on words you've learned:
   - pick the meaning;
   - pick the Russian word;
   - fill the gap in the example sentence;
   - listen and pick the meaning;
   - type the word.

   You choose how often tests run under **Options**.

**Keys:** Space shows the answer, 1–4 rate it, K means "I know it", Z undoes the last answer, and R reads the word aloud.

**Options:** set new words per day (default 20), Russian-first or English-first cards, reading words aloud, IT words on or off, how often tests run, sync, and backups.

## Deploying on Render

Create a **Static Site** from this repo:

- **Publish directory:** `public`
- **Build command:** `echo "nothing to build"`

Or use **New → Blueprint**, which reads `render.yaml`. Static sites on Render don't sleep, so the app opens at once.

## Sync

When you enter an email under **Options**, progress syncs with `https://python-deepdive.onrender.com/api/anki/<email>`. That's the python_deepdive server, stored in Upstash Redis under `anki:<email>`.

- **No password.** Anyone who knows the email can read and change that progress, the same as the course tracker.
- **Offline first.** The app works without the server: it saves to the browser first. It merges with the server copy card by card, so the newer change wins.
- **Moving the server.** If the server moves, change `syncUrl` at the top of `public/app.js`. The server has to allow this site's origin; python_deepdive allows any `*.onrender.com` site.

## Where the words come from

Nothing in `public/words.json` was written by hand. `scripts/build_words.py` selects entries from these sources, trims them and joins them:

| What | Source | License |
|---|---|---|
| Word list, CEFR levels, order | [Kelly project](https://ssharoff.github.io/kelly/) Russian list (`ru_m3.xls`, Serge Sharoff) | CC BY-NC-SA |
| Meanings, stress, gender, aspect pairs | [English Wiktionary](https://en.wiktionary.org/), via the [kaikki.org](https://kaikki.org/dictionary/Russian/) extract | CC BY-SA |
| Fallback meanings (34 words), word forms for stress inside examples | [OpenRussian](https://en.openrussian.org/) ([data](https://github.com/Badestrand/russian-dictionary)) | CC BY-SA 4.0 |
| Example sentences with English | [Tatoeba](https://tatoeba.org/), with Wiktionary's own examples where Tatoeba had none | CC BY 2.0 FR |
| IT terms | Wiktionary computing entries, and the Russian [Wikidata](https://www.wikidata.org/) / Wikipedia names of data-engineering articles | CC BY-SA / CC0 |

Every card links to its sources. Because of the Kelly list, the word data is for non-commercial use, and changes to it must be shared under the same terms.

`scripts/work_terms.txt` lists which IT entries are used. It holds headwords and English Wikipedia titles only; the Russian, the stress and the meanings come from the sources.

### Rules the build applies

- **Dropped words.** Kelly words that Wiktionary only lists as a form of another word (дети, может) get the main word's first meaning and a note. 214 Kelly phrases that no dictionary has are left out. Words whose main meaning Wiktionary marks vulgar or offensive are left out.
- **Example choice.** The build prefers short Tatoeba sentences whose other words are also on the list. For IT words it only uses sentences where the word can't be read as a different word.
- **Stress.** Stress marks are added to the example's word only when every dictionary form agrees. One-syllable words and ё get no mark.

## Rebuilding the word list

```sh
scripts/download_sources.sh                 # ~150 MB into scripts/src and scripts/dl (not committed)
python3 scripts/kelly_to_json.py            # needs: python3 -m pip install xlrd==2.0.1
python3 scripts/fetch_wikidata.py           # Russian names for the [wikipedia] terms in work_terms.txt
python3 scripts/build_words.py              # writes public/words.json and prints counts
```

## Tests

`scripts/test_slovo.mjs` drives the app in headless Chrome over the DevTools protocol. It covers:

- the learning flow, reviews over several days and undo;
- your own words;
- a word test with one wrong answer;
- phone width and dark mode;
- syncing two devices against a mock server.

Run it like this:

```sh
cd scripts
python3 make_preview.py preview/slovo-preview.html   # the 10-word preview page the tests also use
node serve2.mjs &                                    # serves public/, the preview and a mock sync API on :3918
node cdp.mjs /path/to/chrome-headless-shell test_slovo.mjs
```

Restart `serve2.mjs` before each run, because its mock sync store is kept in memory.
