# For each English Wikipedia title in work_terms.txt [wikipedia], get the Wikidata item's
# Russian and English labels (and the Russian Wikipedia title). Saves wikidata_terms.json.
import json, os, urllib.request, urllib.parse
os.chdir(os.path.dirname(os.path.abspath(__file__)))
titles, sec = [], None
for line in open('work_terms.txt', encoding='utf-8'):
    line = line.strip()
    if line.startswith('['): sec = line; continue
    if line and not line.startswith('#') and sec == '[wikipedia]': titles.append(line)
out = []
for i in range(0, len(titles), 50):
    batch = titles[i:i + 50]
    q = urllib.parse.urlencode({'action': 'wbgetentities', 'sites': 'enwiki', 'titles': '|'.join(batch), 'props': 'labels|sitelinks',
                                'languages': 'en|ru', 'sitefilter': 'enwiki|ruwiki', 'format': 'json'})
    req = urllib.request.Request('https://www.wikidata.org/w/api.php?' + q, headers={'User-Agent': 'word-list-builder/1.0 (personal study app)'})
    data = json.load(urllib.request.urlopen(req, timeout=60))
    for qid, ent in data.get('entities', {}).items():
        if qid.startswith('-'): continue
        sl = ent.get('sitelinks', {})
        out.append({'qid': qid, 'enwiki': sl.get('enwiki', {}).get('title'), 'ruwiki': sl.get('ruwiki', {}).get('title'),
                    'en': ent.get('labels', {}).get('en', {}).get('value'), 'ru': ent.get('labels', {}).get('ru', {}).get('value')})
found = {o['enwiki'] for o in out}
print('missing titles:', [t for t in titles if t not in found and t.replace('_', ' ') not in found])
json.dump(out, open('wikidata_terms.json', 'w'), ensure_ascii=False, indent=0)
for o in out: print(o['en'], '→', o['ru'], '| ruwiki:', o['ruwiki'])
