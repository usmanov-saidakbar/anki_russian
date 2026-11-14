# Builds the one-file artifact preview: same CSS and JS as the app, with 10 words from words.json.
import json, os, sys
APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public')
PICK = ['сейчас', 'понимать', 'данные', 'как дела', 'сразу', 'запрос', 'решение', 'таблица', 'постепенно', 'хранилище данных']
words = {w['id']: w for w in json.load(open(f'{APP}/words.json'))}
sample = [words[i] for i in PICK]
css = open(f'{APP}/style.css').read()
js = open(f'{APP}/app.js').read()
data = json.dumps(sample, ensure_ascii=False).replace('</', '<\\/')
html = f'''<title>Слово за словом</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600;700&family=PT+Serif:wght@400;700&display=swap">
<style>
{css}
</style>
<div id="app"><p class="loading">Loading…</p></div>
<script>window.SLOVO_CONFIG = {{ preview: true, storageKey: "slovo-preview" }}; window.SLOVO_WORDS = {data};</script>
<script>
{js}
</script>
'''
os.makedirs(os.path.dirname(os.path.abspath(sys.argv[1])), exist_ok=True)
open(sys.argv[1], 'w').write(html)
print('wrote', sys.argv[1], len(html), 'bytes;', [w['ru'] for w in sample])
