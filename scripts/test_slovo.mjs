import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const out = path.join(path.dirname(new URL(import.meta.url).pathname), "shots2");
fs.mkdirSync(out, { recursive: true });

export default async function test(page) {
  const text = () => page.eval(`document.getElementById('app').innerText`);
  const key = (k) => page.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(k)}, bubbles: true }))`);
  const S = (expr) => page.eval(`(() => { const s = slovo.session; return ${expr}; })()`);
  const click = (sel) => page.eval(`document.querySelector(${JSON.stringify(sel)}).click()`);

  // ---------- Preview (the artifact) ----------
  await page.size(1100, 1400);
  await page.goto("http://127.0.0.1:3918/preview.html");
  let t = await text();
  assert.match(t, /Preview with 10 sample words/);
  assert.deepEqual(await page.eval(`[...document.querySelectorAll('.due-n b')].map(b => b.textContent)`), ["10", "0", "0"]);
  await page.shot(`${out}/p1-today.png`, ".shell");

  await click("[data-a=study]");
  assert.equal(await S("s.kind"), "intro");
  assert.equal(await page.eval(`document.querySelector('.word').textContent`), "го́род");
  assert.match(await page.eval(`document.querySelector('.example').innerText`), /го́род/);
  assert.equal(await page.eval(`document.querySelector('.book-note').textContent`), "(pl. города́)");
  assert.match(await page.eval(`document.querySelector('.sources').innerText`), /Wade, «Using Russian Vocabulary», Unit 1, level 1, p\. 3 · example: Tatoeba/);
  assert.equal(await page.eval(`document.querySelector('.chip-book').textContent`), "U1 · L1");
  await page.shot(`${out}/p2-intro.png`, ".shell");

  await key(" "); // Got it
  assert.equal(await S("s.id"), "покупать/купить");
  assert.match(await page.eval(`document.querySelector('.book-note').innerText`), /\(куплю́ ку́пишь\)/);
  await key(" ");
  assert.equal(await S("s.id"), "данные");
  await key("k"); // I know it
  const known = await page.eval(`slovo.progress.cards['данные']`);
  assert.equal(known.q, "R");
  assert.equal(known.k, 1);
  assert.ok(known.i >= 10 && known.i <= 25, String(known.i));
  await key("z"); // undo brings it back
  assert.equal(await S("s.id"), "данные");
  assert.equal(await S("s.kind"), "intro");
  assert.equal(await page.eval(`slovo.progress.cards['данные'].q`), "N");
  await key(" "); // learn it instead
  for (let i = 0; i < 20 && (await S("s.kind")) === "intro"; i++) await key(" ");
  assert.equal(await page.eval(`Object.values(slovo.progress.cards).filter(c => c.q === 'L').length`), 10);
  assert.equal(await S("s.kind"), "test", "after the new words, the first check comes early (learn-ahead)");
  assert.equal(await S("s.id"), "город");

  await key(" "); // show answer
  assert.deepEqual(await page.eval(`[...document.querySelectorAll('.grade small')].map(s => s.textContent)`), ["1 min", "6 min", "10 min", "16 days"]);
  await page.shot(`${out}/p3-test.png`, ".shell");
  await key("1"); // Again
  const again = await page.eval(`slovo.progress.cards['город']`);
  assert.equal(again.q, "L");
  assert.equal(again.st, 0);
  assert.equal(again.s, 0.40255);

  // Good on everything else until the session ends.
  for (let i = 0; i < 80 && (await S("Boolean(s.id)")); i++) {
    if ((await S("s.kind")) === "intro") await key(" ");
    else {
      if (!(await S("s.revealed"))) await key(" ");
      await key("3");
    }
  }
  assert.equal(await S("s.id"), null);
  t = await text();
  assert.match(t, /All done for today/);
  const cards = await page.eval(`slovo.progress.cards`);
  assert.ok(Object.values(cards).every((c) => c.q === "R"), JSON.stringify(cards));
  assert.equal(cards["город"].i, 1, "Again then Good, Good: back tomorrow");
  for (const [id, c] of Object.entries(cards)) if (id !== "город") assert.ok(c.i >= 3 && c.i <= 5, `${id} ${c.i}`);
  const log = await page.eval(`slovo.progress.log[new Date(slovo.dayOf(Date.now()) * 864e5).toISOString().slice(0, 10)]`);
  assert.equal(log.n, 10);
  assert.equal(log.r, 21); // 10 words × 2 checks + 1 extra after "Again"
  assert.equal(log.a, 1);
  await page.shot(`${out}/p4-done.png`, ".shell");

  await click("[data-a=home]");
  t = await text();
  assert.match(t, /All done for today/);
  assert.match(t, /10\s*words learned/);
  assert.match(t, /1\s*day in a row/);

  // ---------- Word test ----------
  assert.match(t, /Today's test/);
  await click("[data-a=quiz]");
  const Qx = (expr) => page.eval(`(() => { const q = slovo.quiz; return ${expr}; })()`);
  assert.equal(await Qx("q.qs.length"), 10);
  const types = await Qx("q.qs.map(x => x.type)");
  assert.ok(new Set(types).size >= 3, types.join());
  await page.shot(`${out}/q1-question.png`, ".shell");
  let missed = null;
  for (let i = 0; i < 10; i++) {
    const q = await Qx("q.qs[q.i]");
    const wrongOnPurpose = i === 0;
    if (q.type === "type") {
      const answer = wrongOnPurpose ? "абвгд" : (await page.eval(`slovo.words().find(w => w.id === ${JSON.stringify(q.id)}).ru`)).replace(/́/g, "");
      await page.eval(`(() => { const f = document.querySelector('[data-form=q-type]'); f.answer.value = ${JSON.stringify(answer)}; f.requestSubmit(); })()`);
    } else {
      await key(String((wrongOnPurpose ? (q.answer + 1) % 4 : q.answer) + 1));
    }
    assert.equal(await Qx("q.ok"), !wrongOnPurpose, `question ${i} (${q.type})`);
    if (wrongOnPurpose) {
      missed = q.id;
      assert.equal(await page.eval(`slovo.progress.cards[${JSON.stringify(missed)}].q`), "F", "a wrong answer sends the word back");
      await page.shot(`${out}/q2-wrong.png`, ".shell");
    }
    await key("Enter");
  }
  assert.match(await text(), /Test done: 9 \/ 10/);
  await page.shot(`${out}/q3-done.png`, ".shell");
  const qlog = await page.eval(`slovo.progress.log[new Date(slovo.dayOf(Date.now()) * 864e5).toISOString().slice(0, 10)]`);
  assert.equal(qlog.tq, 10);
  assert.equal(qlog.tc, 9);
  assert.equal(qlog.tt, 1);
  await click("[data-a=q-study]"); // study the missed word right away
  assert.equal(await S("s.id"), missed);
  await key(" ");
  await key("3");
  assert.equal(await S("s.id"), null);
  await click("[data-a=home]");
  assert.match(await text(), /Tested today: 9 \/ 10 right/);
  await page.eval(`location.hash = 'stats'`);
  await page.sleep(200);
  assert.match(await text(), /9 \/ 10\s*90%/);
  await page.eval(`location.hash = 'today'`);
  await page.sleep(200);

  // Tomorrow: the word answered "Again" (and the word missed in the test) are due.
  await click("[data-a=tomorrow]");
  const dueTomorrow = await page.eval(`[...document.querySelectorAll('.due-n b')].map(b => b.textContent)`);
  assert.deepEqual(dueTomorrow.slice(0, 2), ["0", "0"]);
  assert.ok(Number(dueTomorrow[2]) >= 1);
  await click("[data-a=study]");
  assert.equal(await S("s.kind"), "test");
  await key(" ");
  const revLabels = await page.eval(`[...document.querySelectorAll('.grade small')].map(s => s.textContent)`);
  assert.equal(revLabels[0], "1 min");
  assert.ok(revLabels.slice(1).every((l) => /day|mo/.test(l)), revLabels.join());
  await key("3");
  for (let i = 0; i < 5 && (await S("Boolean(s.id)")); i++) {
    await key(" ");
    await key("3");
  }
  assert.equal(await S("s.id"), null);
  await click("[data-a=home]");
  assert.match(await text(), /2\s*days in a row/);
  assert.match(await text(), /Today's words/);
  assert.match(await page.eval(`document.querySelector('.daily-words .daily-head .muted').textContent`), /All done for today/);

  // Five days later the rest are due.
  for (let i = 0; i < 5; i++) await click("[data-a=tomorrow]");
  const dueNow = Number(await page.eval(`document.querySelectorAll('.due-n b')[2]?.textContent || 0`));
  assert.ok(dueNow >= 8, String(dueNow));

  // ---------- Words ----------
  await page.eval(`location.hash = 'words'`);
  await page.sleep(200);
  assert.match(await page.eval(`document.querySelector('.list-count').textContent`), /10 words/);
  await page.eval(`(() => { const i = document.getElementById('word-search'); i.value = 'data'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const found = await page.eval(`[...document.querySelectorAll('.w-ru')].map(e => e.textContent)`);
  assert.ok(found.includes("да́нные") && found.includes("храни́лище да́нных"), found.join());
  const add = (ru, en, ex = "") =>
    page.eval(`(() => { const d = document.querySelector('.add-sheet'); d.open = true; const f = d.querySelector('form');
      f.ru.value = ${JSON.stringify(ru)}; f.en.value = ${JSON.stringify(en)}; f.ex.value = ${JSON.stringify(ex)}; f.requestSubmit();
      return document.querySelector('.note')?.textContent || ''; })()`);
  assert.match(await add("доро'жка", "path", "Мы шли по доро'жке."), /Added/);
  const own = await page.eval(`Object.values(slovo.progress.own)[0]`);
  assert.equal(own.ru, "доро́жка");
  assert.equal(own.ex, "Мы шли по *доро́жке*.");
  assert.match(await add("Го́род", "town"), /already in your cards/);
  assert.match(await add("дорожка", "path"), /already in your words/);
  await page.shot(`${out}/p5-words.png`, ".shell");

  // ---------- Options: English first ----------
  await page.eval(`location.hash = 'options'`);
  await page.sleep(200);
  await click('[data-k="dir"][data-v="\\"en\\""]');
  assert.equal(await page.eval(`slovo.progress.settings.dir`), "en");
  await page.eval(`location.hash = 'today'`);
  await page.sleep(200);
  await click("[data-a=study]");
  assert.equal(await S("s.kind"), "test", "two reviews, then a new word");
  const front = await page.eval(`document.querySelector('.card').innerText`);
  assert.ok(!/[а-яё]/i.test(front.replace(/Review|Check|Again/g, "")), front);
  await key(" ");
  assert.match(await page.eval(`document.querySelector('.card').innerText`), /[а-яё]/i);
  await key("3");
  await key(" ");
  await key("3");
  assert.equal(await S("s.kind"), "intro");
  assert.equal(await S("s.id.startsWith('u:')"), true, "your own word is the first new word");

  // ---------- Phone and dark mode ----------
  await page.size(390, 844, true);
  await page.goto("http://127.0.0.1:3918/preview.html#today");
  assert.equal(await page.eval(`document.documentElement.scrollWidth <= innerWidth`), true, "no sideways scroll (today)");
  await page.shot(`${out}/p6-phone-today.png`);
  await click("[data-a=study]");
  if ((await S("s.kind")) === "test") await key(" ");
  assert.equal(await page.eval(`document.documentElement.scrollWidth <= innerWidth`), true, "no sideways scroll (card)");
  await page.shot(`${out}/p7-phone-card.png`);
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await page.shot(`${out}/p8-phone-dark.png`);
  await page.eval(`location.hash = 'stats'`);
  await page.sleep(300);
  assert.equal(await page.eval(`document.documentElement.scrollWidth <= innerWidth`), true, "no sideways scroll (stats)");
  await page.shot(`${out}/p9-phone-stats-dark.png`);
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });

  // ---------- Real app with all words and sync ----------
  await page.size(1100, 1400);
  await page.goto("http://127.0.0.1:3918/app/test.html");
  await page.sleep(800);
  assert.equal(await page.eval(`slovo.words().length`), 7318);
  assert.deepEqual(await page.eval(`[...document.querySelectorAll('.due-n b')].map(b => b.textContent)`), ["20", "0", "0"]);
  await page.eval(`location.hash = 'options'`);
  await page.sleep(200);
  await page.eval(`(() => { const f = document.querySelector('[data-form=email]'); f.email.value = 'test@example.com'; f.requestSubmit(); })()`);
  await page.sleep(800);
  assert.match(await page.eval(`document.getElementById('sync-status').textContent`), /Synced with test@example.com/);
  await page.eval(`location.hash = 'today'`);
  await page.sleep(200);
  await click("[data-a=study]");
  assert.equal(await page.eval(`document.querySelector('.word').textContent`), "го́род", "new words start with the book");
  await key(" ");
  await page.sleep(2600); // debounced upload
  let stored = await page.eval(`fetch('/__store').then(r => r.json())`);
  assert.equal(stored["test@example.com"].cards["город"].q, "L");
  // Another device studies "в" meanwhile; reloading merges both.
  await page.eval(`(async () => { const r = await fetch('/api/anki/test%40example.com'); const p = await r.json();
    p.cards['в'] = { q: 'L', st: 0, at: Date.now(), n: 0, f: 0, a: 1, t: Date.now() + 1000 };
    await fetch('/api/anki/test%40example.com', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }); })()`);
  await page.goto("http://127.0.0.1:3918/app/test.html");
  await page.sleep(1200);
  const merged = await page.eval(`Object.keys(slovo.progress.cards).sort()`);
  assert.deepEqual(merged, ["в", "город"]);
  await page.shot(`${out}/a1-app-today.png`, ".shell");

  // ---------- A fixed daily set of new words, then unlimited practice ----------
  await page.eval(`location.hash = 'options'`);
  await page.sleep(200);
  await click('[data-k="newPerDay"][data-v="5"]');
  await page.eval(`location.hash = 'today'`);
  await page.sleep(200);
  const todayKey = () => page.eval(`new Date(slovo.dayOf(Date.now()) * 864e5).toISOString().slice(0, 10)`);
  const before = await page.eval(`slovo.progress.log[${JSON.stringify(await todayKey())}]`);
  assert.equal(before.n, 1, "«город» was started earlier today");
  assert.equal(await page.eval(`document.querySelectorAll('.due-n b')[0].textContent`), "4", "5 a day, 1 already started");
  await click("[data-a=study]");
  let intros = 0;
  for (let i = 0; i < 80 && (await S("Boolean(s.id)")); i++) {
    if ((await S("s.kind")) === "intro") {
      await key(intros < 2 ? "k" : " "); // the first two: «I know it»
      intros++;
    } else {
      if (!(await S("s.revealed"))) await key(" ");
      await key("3");
    }
  }
  assert.equal(intros, 4, "only today's set of new words, «I know it» included");
  const after = await page.eval(`slovo.progress.log[${JSON.stringify(await todayKey())}]`);
  assert.equal((after.n || 0) + (after.k || 0), 5);
  t = await text();
  assert.doesNotMatch(t, /Learn 10 more/);
  assert.match(t, /All done for today/);
  assert.equal(await page.eval(`Boolean(document.querySelector('[data-a=practice]'))`), true, "practice offered at the end");
  await click("[data-a=home]");
  assert.equal(await page.eval(`document.querySelectorAll('.due-n b').length`), 0, "no more new words today");
  assert.match(await text(), /Practise as much as you like/);

  const cardsBefore = await page.eval(`JSON.stringify(slovo.progress.cards)`);
  await click("[data-a=practice]");
  assert.equal(await page.eval(`location.hash`), "#practice");
  const answerQ = async (right) => {
    const q = await Qx("q.qs[q.i]");
    if (q.type === "type") {
      const ans = right ? (await page.eval(`slovo.words().find(w => w.id === ${JSON.stringify(q.id)}).ru`)).replace(/́/g, "") : "абвгд";
      await page.eval(`(() => { const f = document.querySelector('[data-form=q-type]'); f.answer.value = ${JSON.stringify(ans)}; f.requestSubmit(); })()`);
    } else {
      await key(String((right ? q.answer : (q.answer + 1) % 4) + 1));
    }
    return q.id;
  };
  const seen = [];
  for (let i = 0; i < 12; i++) {
    seen.push(await answerQ(i !== 0));
    assert.equal(await Qx("q.ok"), i !== 0, `practice question ${i}`);
    if (i === 0) assert.match(await text(), /comes back in a few questions/);
    await key("Enter");
  }
  assert.ok(seen.slice(1, 6).includes(seen[0]), "a missed word comes back soon: " + seen.join(", "));
  assert.equal(await page.eval(`JSON.stringify(slovo.progress.cards)`), cardsBefore, "practice doesn't change the schedule");
  const plog = await page.eval(`slovo.progress.log[${JSON.stringify(await todayKey())}]`);
  assert.equal(plog.pq, 12);
  assert.equal(plog.pc, 11);
  await click("[data-a=q-stop]");
  assert.match(await text(), /Practice: 11 \/ 12/);
  await page.shot(`${out}/a2-practice-done.png`, ".shell");
  await click('.actions [data-a=practice]');
  assert.equal(await Qx("q.count"), 0, "keep practising starts a new round");
  await click("[data-a=q-stop]");
  assert.equal(await page.eval(`location.hash`), "#today");
  assert.match(await text(), /Today: 12 answers, 11 right/);
  console.log("all slovo checks passed");
}
