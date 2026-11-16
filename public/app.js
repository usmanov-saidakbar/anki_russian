/* Слово за словом: Russian words to B2 with spaced repetition (FSRS-5).
   Plain JavaScript, no build step. Progress lives in this browser and, if you
   enter an email, is synced through the python_deepdive server. */
(() => {
  "use strict";

  const CONFIG = Object.assign(
    {
      wordsUrl: "words.json",
      syncUrl: "https://python-deepdive.onrender.com/api/anki/",
      storageKey: "slovo",
      preview: false,
    },
    window.SLOVO_CONFIG || {}
  );

  // ---------- Small helpers ----------
  const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
  const ACUTE = "́";
  const plain = (s) => String(s).replace(/́/g, "");
  const keyOf = (s) => plain(s).toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/g, " ").trim();
  const num = (n) => Math.round(n).toLocaleString("en-US");
  const plural = (n, one, many = one + "s") => `${num(n)} ${n === 1 ? one : many}`;
  const link = (href, text) => `<a href="${h(href)}" target="_blank" rel="noopener">${h(text)}</a>`;
  function readLS(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }
  function writeLS(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }
  function hash(str) {
    let x = 2166136261;
    for (let i = 0; i < str.length; i++) x = Math.imul(x ^ str.charCodeAt(i), 16777619);
    return x >>> 0;
  }

  // ---------- Time ----------
  const MIN = 60 * 1000;
  const DAY = 24 * 60 * MIN;
  const ROLLOVER = 4 * 60 * MIN; // a new day starts at 4 am, so late-night study still counts as today
  let clockOffset = CONFIG.preview ? Number(readLS(CONFIG.storageKey + ":clock")) || 0 : 0;
  const now = () => Date.now() + clockOffset;
  function dayOf(ts) {
    const d = new Date(ts - ROLLOVER);
    return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
  }
  const today = () => dayOf(now());
  const dayKey = (day) => new Date(day * DAY).toISOString().slice(0, 10);
  const fmtDay = (day, opts) => new Date(day * DAY).toLocaleDateString("en-GB", { timeZone: "UTC", ...opts });

  function fmtWait(ms) {
    const m = Math.max(1, Math.round(ms / MIN));
    return m < 60 ? `${m} min` : `${Math.round(m / 60)} h`;
  }
  function fmtDays(d) {
    if (d < 1) return "today";
    if (d === 1) return "1 day";
    if (d < 30) return `${d} days`;
    if (d < 365) {
      const mo = d / 30;
      return `${mo < 10 ? mo.toFixed(1).replace(/\.0$/, "") : Math.round(mo)} mo`;
    }
    return `${(d / 365).toFixed(1).replace(/\.0$/, "")} yr`;
  }

  // ---------- Scheduler: FSRS-5 with its published default weights ----------
  const W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
  const DECAY = -0.5;
  const FACTOR = 19 / 81;
  const RETENTION = 0.9; // aim to remember 90% of words when they come back
  const MAX_IVL = 365;
  const LEARN_STEPS = [1, 10]; // minutes between the first checks of a new word
  const AGAIN_MIN = 1;
  const HARD_MIN = 6;
  const LEARN_AHEAD = 20 * MIN;

  const clampD = (d) => Math.min(10, Math.max(1, d));
  const initS = (g) => W[g - 1];
  const initD = (g) => clampD(W[4] - Math.exp(W[5] * (g - 1)) + 1);
  const recall = (t, s) => Math.pow(1 + (FACTOR * t) / s, DECAY);
  const nextD = (d, g) => clampD(W[7] * initD(4) + (1 - W[7]) * (d - (W[6] * (g - 3) * (10 - d)) / 9));
  const recallS = (d, s, r, g) =>
    s * (1 + Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) * (Math.exp((1 - r) * W[10]) - 1) * (g === 2 ? W[15] : 1) * (g === 4 ? W[16] : 1));
  const forgetS = (d, s, r) => Math.min(s, W[11] * Math.pow(d, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp((1 - r) * W[14]));
  const shortS = (s, g) => s * Math.exp(W[17] * (g - 3 + W[18]));
  const ivlFor = (s) => Math.min(MAX_IVL, Math.max(1, Math.round((s / FACTOR) * (Math.pow(RETENTION, 1 / DECAY) - 1))));
  const round2 = (x) => Math.round(x * 100) / 100;

  // Returns the card after answering with grade g (1 Again, 2 Hard, 3 Good, 4 Easy) and a label for the button.
  function schedule(card, g, t) {
    const day = dayOf(t);
    const c = { ...card, n: (card.n || 0) + 1, t };
    const step = (st, minutes) => {
      c.st = st;
      c.at = t + minutes * MIN;
      return { card: c, label: `${minutes} min` };
    };
    const graduate = () => {
      const ivl = ivlFor(c.s);
      Object.assign(c, { q: "R", i: ivl, l: day, due: day + ivl });
      delete c.st;
      delete c.at;
      return { card: c, label: fmtDays(ivl), days: ivl };
    };
    if (card.q === "L" || card.q === "F") {
      if (card.s == null) {
        c.s = initS(g);
        c.d = initD(g);
      } else {
        c.s = shortS(card.s, g);
        c.d = nextD(card.d, g);
      }
      if (g === 1) return step(0, AGAIN_MIN);
      if (g === 2) return step(card.st || 0, card.q === "L" && card.st ? LEARN_STEPS[card.st] : HARD_MIN);
      if (g === 3 && card.q === "L" && (card.st || 0) + 1 < LEARN_STEPS.length) return step(card.st + 1, LEARN_STEPS[card.st + 1]);
      return graduate();
    }
    // a review of a word you already learned
    const r = recall(Math.max(0, day - card.l), card.s);
    if (g === 1) {
      Object.assign(c, { q: "F", s: forgetS(card.d, card.s, r), d: nextD(card.d, 1), f: (card.f || 0) + 1, l: day });
      delete c.i;
      delete c.due;
      return step(0, AGAIN_MIN);
    }
    let [hard, good, easy] = [2, 3, 4].map((gg) => ivlFor(recallS(card.d, card.s, r, gg)));
    hard = Math.min(hard, good);
    good = Math.max(good, hard + 1);
    easy = Math.max(easy, good + 1);
    const ivl = [hard, good, easy][g - 2];
    Object.assign(c, { s: recallS(card.d, card.s, r, g), d: nextD(card.d, g), i: ivl, l: day, due: day + ivl });
    return { card: c, label: fmtDays(ivl), days: ivl };
  }
  // Spread reviews a little so words learned together don't all come back on the same day.
  function fuzz(ivl) {
    if (ivl < 3) return ivl;
    const f = Math.max(1, Math.round(ivl * 0.05));
    return Math.min(MAX_IVL, ivl - f + Math.floor(Math.random() * (2 * f + 1)));
  }

  // ---------- Progress ----------
  const DEFAULTS = { newPerDay: 20, dir: "ru", audio: true, work: true, testDays: "daily", testSize: 10, typing: true };
  function emptyProgress() {
    return { v: 1, cards: {}, own: {}, pull: {}, edits: {}, log: {}, settings: { ...DEFAULTS, t: 0 } };
  }
  const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
  function normalize(raw) {
    const p = emptyProgress();
    if (!isObj(raw)) return p;
    for (const k of ["cards", "own", "edits", "pull", "log"]) if (isObj(raw[k])) p[k] = raw[k];
    if (isObj(raw.settings)) p.settings = { ...DEFAULTS, ...raw.settings };
    return p;
  }
  // Two copies (this device and the server) are merged card by card: the newer change wins.
  function merge(a, b) {
    const out = emptyProgress();
    for (const k of ["cards", "own", "edits"]) {
      out[k] = { ...a[k] };
      for (const [id, v] of Object.entries(b[k])) if (!out[k][id] || (v.t || 0) > (out[k][id].t || 0)) out[k][id] = v;
    }
    out.pull = { ...a.pull };
    for (const [id, t] of Object.entries(b.pull)) out.pull[id] = Math.max(t, a.pull[id] || 0);
    for (const day of new Set([...Object.keys(a.log), ...Object.keys(b.log)])) {
      const x = a.log[day] || {};
      const y = b.log[day] || {};
      const m = {};
      for (const f of new Set([...Object.keys(x), ...Object.keys(y)])) m[f] = Math.max(x[f] || 0, y[f] || 0);
      out.log[day] = m;
    }
    out.settings = (b.settings.t || 0) > (a.settings.t || 0) ? b.settings : a.settings;
    return out;
  }

  const LOCAL_KEY = CONFIG.storageKey + ":progress";
  const EMAIL_KEY = CONFIG.storageKey + ":email";
  let P = normalize(JSON.parse(readLS(LOCAL_KEY) || "null"));
  let email = CONFIG.preview ? "" : readLS(EMAIL_KEY) || "";
  const saveLocal = () => writeLS(LOCAL_KEY, JSON.stringify(P));
  function save() {
    saveLocal();
    schedulePush();
  }
  function todayLog() {
    const k = dayKey(today());
    return (P.log[k] = P.log[k] || {});
  }
  const bump = (log, f, by = 1) => (log[f] = (log[f] || 0) + by);

  // ---------- Sync ----------
  const sync = { state: email ? "waiting" : "off", at: 0, error: "" };
  let pushTimer = 0;
  let pushing = false;
  let pushAgain = false;
  let lastPull = 0;
  const syncUrl = () => CONFIG.syncUrl + encodeURIComponent(email);
  async function pull() {
    if (!email || CONFIG.preview) return;
    lastPull = Date.now();
    sync.state = "busy";
    paintSync();
    try {
      const res = await fetch(syncUrl(), { cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 503 ? "the server has no storage set up" : `the server answered ${res.status}`);
      const remote = normalize(await res.json());
      const before = JSON.stringify(P);
      P = merge(P, remote);
      saveLocal();
      sync.state = "ok";
      sync.at = Date.now();
      if (JSON.stringify(P) !== JSON.stringify(remote)) schedulePush(0);
      if (JSON.stringify(P) !== before && view !== "study") render();
    } catch (err) {
      sync.state = "error";
      sync.error = err.message === "Failed to fetch" ? "couldn't reach the server" : err.message;
    }
    paintSync();
  }
  function schedulePush(delay = 2000) {
    if (!email || CONFIG.preview) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, delay);
  }
  async function push(keepalive = false) {
    if (!email || CONFIG.preview) return;
    clearTimeout(pushTimer);
    pushTimer = 0;
    if (pushing) {
      pushAgain = true;
      return;
    }
    pushing = true;
    try {
      const body = JSON.stringify(P);
      const small = new TextEncoder().encode(body).length < 60000;
      const res = await fetch(syncUrl(), { method: "PUT", headers: { "Content-Type": "application/json" }, body, keepalive: keepalive && small });
      if (!res.ok) throw new Error(`the server answered ${res.status}`);
      sync.state = "ok";
      sync.at = Date.now();
    } catch (err) {
      sync.state = "error";
      sync.error = err.message === "Failed to fetch" ? "couldn't reach the server" : err.message;
    }
    pushing = false;
    paintSync();
    if (pushAgain) {
      pushAgain = false;
      push();
    }
  }
  function syncText() {
    if (!email) return "Not synced. Your words are saved in this browser only.";
    if (sync.state === "busy" || sync.state === "waiting") return `Syncing with ${email}…`;
    if (sync.state === "error") return `Saved on this device. Sync failed (${sync.error}); it will try again.`;
    const t = new Date(sync.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    return `Synced with ${email} at ${t}.`;
  }
  function paintSync() {
    const el = document.getElementById("sync-status");
    if (el) {
      el.textContent = syncText();
      el.dataset.state = sync.state;
    }
  }

  // ---------- Words ----------
  let words = [];
  const byId = new Map();
  const LEVELS = ["A1", "A2", "B1", "B2"];
  let levelTotals = {};
  const posOf = new Map();
  function setWords(list) {
    words = list;
    byId.clear();
    posOf.clear();
    levelTotals = { IT: 0 };
    for (const [i, w] of list.entries()) {
      byId.set(w.id, w);
      posOf.set(w.id, i);
      levelTotals[w.lvl] = (levelTotals[w.lvl] || 0) + 1;
    }
  }
  function wordFor(id) {
    const own = P.own[id];
    if (own) return own.gone ? null : { id, ru: own.ru, en: own.en, ex: own.ex, exEn: own.exEn, lvl: "Mine", deck: "own" };
    const w = byId.get(id);
    if (!w) return null;
    const e = P.edits[id];
    return e && e.en ? { ...w, en: e.en } : w;
  }
  const started = (id) => P.cards[id] && P.cards[id].q !== "N";
  const deckOn = (w) => w.deck !== "work" || P.settings.work;
  const ownIds = () =>
    Object.entries(P.own)
      .filter(([, o]) => !o.gone)
      .sort((a, b) => a[1].t - b[1].t)
      .map(([id]) => id);
  function newLeft() {
    const log = todayLog();
    return Math.max(0, P.settings.newPerDay + (log.x || 0) * 10 - (log.n || 0));
  }
  // New words in the order they'll be shown: your own words first, then the list.
  function freshIds(max = Infinity) {
    const out = [];
    for (const id of ownIds()) if (out.length < max && !started(id)) out.push(id);
    const pulled = Object.keys(P.pull).sort((a, b) => P.pull[a] - P.pull[b]);
    for (const id of pulled) if (out.length < max && byId.has(id) && !started(id)) out.push(id);
    let left = newLeft();
    for (const w of words) {
      if (left <= 0 || out.length >= max) break;
      if (!deckOn(w) || started(w.id) || P.pull[w.id]) continue;
      out.push(w.id);
      left--;
    }
    return out;
  }
  function counts() {
    const t = now();
    const d = today();
    let learn = 0;
    let rev = 0;
    let later = null;
    for (const [id, c] of Object.entries(P.cards)) {
      if (!wordFor(id)) continue;
      if (c.q === "R" && c.due <= d) rev++;
      if (c.q === "L" || c.q === "F") {
        learn++;
        if (c.at > t + LEARN_AHEAD && (later === null || c.at < later)) later = c.at;
      }
    }
    return { learn, rev, fresh: freshIds().length, later };
  }

  // Words introduced today (first card of a word shown today, including "I know it").
  function startedTodayIds() {
    const t = today();
    return Object.entries(P.cards)
      .filter(([id, c]) => c && c.a === t && c.q !== "S" && c.q !== "N" && wordFor(id))
      .map(([id]) => id);
  }

  // Reviews and learning checks that are due right now.
  function dueNow() {
    const t = now();
    const d = today();
    let rev = 0;
    let learn = 0;
    for (const [id, c] of Object.entries(P.cards)) {
      if (!wordFor(id)) continue;
      if (c.q === "R" && c.due <= d) rev++;
      else if ((c.q === "L" || c.q === "F") && c.at <= t) learn++;
    }
    return { rev, learn };
  }

  // The words after today's set, grouped into future daily batches, in study order.
  // Returns a Map from word id to the batch number (0 = tomorrow's words).
  function upcomingBatchOf() {
    const todaySet = new Set(freshIds());
    const per = Math.max(1, P.settings.newPerDay || 0);
    const map = new Map();
    let idx = 0;
    for (const id of ownIds()) {
      if (!started(id) && !todaySet.has(id)) map.set(id, Math.floor(idx++ / per));
    }
    for (const w of words) {
      if (!deckOn(w) || started(w.id) || P.pull[w.id] || todaySet.has(w.id)) continue;
      map.set(w.id, Math.floor(idx++ / per));
    }
    return map;
  }
  function status(id) {
    const c = P.cards[id];
    if (!c || c.q === "N") return "new";
    if (c.q === "S") return "hidden";
    if (c.q === "L" || c.q === "F") return "learning";
    if (c.k) return "known";
    return (c.i || 0) >= 21 ? "strong" : "learned";
  }
  const STATUS_LABEL = { new: "Not started", learning: "Learning", learned: "Learned", strong: "Known well", known: "You knew it", hidden: "Hidden" };

  // ---------- Study session ----------
  let S = null;
  function startStudy() {
    S = { undo: [], mix: 0, answered: 0, started: 0, ms: 0, last: null, id: null, kind: null, revealed: false, shownAt: 0, dir: "ru", editing: false, confirmHide: false };
    view = "study";
    if (location.hash !== "#study") history.replaceState(null, "", "#study");
    nextCard();
  }
  function cardDir(id) {
    const s = P.settings.dir;
    if (s !== "mix") return s;
    return hash(id + ":" + (P.cards[id]?.n || 0)) % 2 ? "en" : "ru";
  }
  function pickNext() {
    const t = now();
    const d = today();
    const learnDue = [];
    const reviews = [];
    let soon = null;
    for (const [id, c] of Object.entries(P.cards)) {
      if (!wordFor(id)) continue;
      if (c.q === "R") {
        if (c.due <= d) reviews.push(id);
      } else if (c.q === "L" || c.q === "F") {
        if (c.at <= t) learnDue.push(id);
        else if (c.at <= t + LEARN_AHEAD && (!soon || c.at < P.cards[soon].at)) soon = id;
      }
    }
    learnDue.sort((a, b) => P.cards[a].at - P.cards[b].at);
    const fresh = freshIds(1);
    const others = reviews.length + fresh.length + learnDue.length - 1;
    if (learnDue.length) {
      const first = learnDue[0] === S.last && others > 0 ? learnDue[1] : learnDue[0];
      if (first) return { id: first, kind: "test" };
    }
    if (reviews.length || fresh.length) {
      S.mix++;
      if (fresh.length && (!reviews.length || S.mix % 3 === 0)) return { id: fresh[0], kind: "intro" };
      reviews.sort((a, b) => P.cards[a].due - P.cards[b].due || hash(a + d) - hash(b + d));
      return { id: reviews[0], kind: "test" };
    }
    if (learnDue.length) return { id: learnDue[0], kind: "test" };
    if (soon) return { id: soon, kind: "test" };
    return null;
  }
  function nextCard() {
    const pick = pickNext();
    Object.assign(S, { id: pick ? pick.id : null, kind: pick ? pick.kind : null, revealed: false, editing: false, confirmHide: false, shownAt: now() });
    S.dir = pick ? cardDir(pick.id) : "ru";
    render();
    if (pick && (S.kind === "intro" || S.dir === "ru")) autoSpeak();
  }
  function remember(kind) {
    S.undo.push({ id: S.id, kind, dir: S.dir, before: P.cards[S.id] ? { ...P.cards[S.id] } : null, day: dayKey(today()), log: { ...todayLog() }, last: S.last });
    if (S.undo.length > 30) S.undo.shift();
  }
  function spent(log) {
    const ms = Math.min(now() - S.shownAt, 90 * 1000);
    bump(log, "ms", ms);
    S.ms += ms;
  }
  function introduce(known) {
    const id = S.id;
    const t = now();
    const day = today();
    const log = todayLog();
    remember("intro");
    const counted = byId.has(id) && !P.pull[id];
    if (known) {
      const ivl = 10 + Math.floor(Math.random() * 16);
      P.cards[id] = { q: "R", s: initS(4), d: initD(4), i: ivl, l: day, due: day + ivl, n: 1, f: 0, k: 1, a: day, t };
      bump(log, "k");
    } else {
      P.cards[id] = { q: "L", st: 0, at: t + AGAIN_MIN * MIN, n: 0, f: 0, a: day, t };
      bump(log, counted ? "n" : "o");
      S.started++;
    }
    spent(log);
    S.last = id;
    save();
    nextCard();
  }
  function answer(g) {
    const id = S.id;
    const before = P.cards[id];
    if (!before) return;
    const log = todayLog();
    remember("test");
    const { card } = schedule(before, g, now());
    if (card.q === "R" && card.i >= 3) {
      card.i = fuzz(card.i);
      card.due = card.l + card.i;
    }
    P.cards[id] = card;
    bump(log, "r");
    if (g === 1) bump(log, "a");
    if (before.q === "R") {
      bump(log, "rv");
      if (g === 1) bump(log, "rl");
    }
    spent(log);
    S.answered++;
    S.last = id;
    save();
    nextCard();
  }
  function undo() {
    const u = S && S.undo.pop();
    if (!u) return;
    // the restored copy gets a new time so it also wins on the server
    P.cards[u.id] = u.before ? { ...u.before, t: now() } : { q: "N", t: now() };
    P.log[u.day] = u.log;
    Object.assign(S, { id: u.id, kind: u.kind, dir: u.dir, revealed: u.kind === "test", editing: false, confirmHide: false, shownAt: now(), last: u.last });
    if (u.kind === "test") S.answered = Math.max(0, S.answered - 1);
    save();
    render();
  }
  function hideWord(id) {
    P.cards[id] = { ...(P.cards[id] || {}), q: "S", t: now() };
    save();
  }

  // ---------- Speech ----------
  let voice = null;
  function pickVoice() {
    if (!("speechSynthesis" in window)) return;
    const ru = speechSynthesis.getVoices().filter((v) => /^ru(-|_|$)/i.test(v.lang));
    const had = Boolean(voice);
    voice = ru.find((v) => v.localService && /milena|yuri|katya|irina|dariya|google/i.test(v.name)) || ru.find((v) => v.localService) || ru[0] || null;
    if (Boolean(voice) !== had && !document.activeElement?.matches("input, textarea")) render();
  }
  function speak(text) {
    if (!voice) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(plain(text).replace(/\*/g, ""));
      u.voice = voice;
      u.lang = voice.lang;
      u.rate = 0.9;
      speechSynthesis.speak(u);
    } catch {
      /* speech isn't essential */
    }
  }
  function autoSpeak() {
    if (!P.settings.audio || !S || !S.id) return;
    const w = wordFor(S.id);
    if (w) speak(w.ru);
  }
  const SPEAKER =
    '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M4 9.5v5h3.6L12 18.6V5.4L7.6 9.5H4z" fill="currentColor"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  const speakBtn = (text, label) =>
    voice ? `<button type="button" class="speak" data-a="speak" data-text="${h(text)}" aria-label="${h(label)}" title="${h(label)}">${SPEAKER}</button>` : "";

  // ---------- Rendering helpers ----------
  const app = document.getElementById("app");
  let view = "today";
  const VIEWS = ["today", "words", "stats", "options"];
  function grammarHTML(w) {
    if (w.g === "pl") return "noun, plural only";
    if (w.g) return `${{ m: "masculine", f: "feminine", n: "neuter" }[w.g]} noun`;
    if (w.asp) {
      const kind = w.asp === "pf" ? "perfective" : "imperfective";
      const other = w.asp === "pf" ? "imperfective" : "perfective";
      return `${kind} verb${w.pair ? ` · ${other}: <span lang="ru">${h(w.pair)}</span>` : ""}`;
    }
    return "";
  }
  const exampleHTML = (ex) => h(ex).split("*").map((part, i) => (i % 2 ? `<mark>${part}</mark>` : part)).join("");
  function sourcesHTML(w) {
    if (w.deck === "own") return "Your word";
    const page = encodeURIComponent(plain(w.ru).replace(/[?!]/g, "").trim());
    const parts = [];
    if (w.deck === "core") parts.push(link("https://ssharoff.github.io/kelly/", `Kelly list ${w.lvl}`));
    if (w.tr === "wikt") parts.push(link(`https://en.wiktionary.org/wiki/${page}#Russian`, "Wiktionary"));
    else if (w.tr === "or") parts.push(link(`https://en.openrussian.org/ru/${page}`, "OpenRussian"));
    else if (w.tr && w.tr.startsWith("wd:")) parts.push(link(`https://www.wikidata.org/wiki/${w.tr.slice(3)}`, "Wikipedia / Wikidata"));
    if (w.xs && w.xs.startsWith("tat:")) parts.push(link(`https://tatoeba.org/en/sentences/show/${w.xs.slice(4)}`, "example: Tatoeba"));
    else if (w.xs === "wikt" && w.tr !== "wikt") parts.push(link(`https://en.wiktionary.org/wiki/${page}#Russian`, "example: Wiktionary"));
    if (P.edits[w.id]) parts.push("meaning edited by you");
    return parts.join(" · ");
  }
  function levelChip(w) {
    if (w.deck === "own") return '<span class="chip chip-own">Your word</span>';
    if (w.deck === "work") return '<span class="chip chip-it" title="Data engineering and IT">IT</span>';
    return `<span class="chip" title="Kelly list level">${h(w.lvl)}</span>${w.work ? '<span class="chip chip-it" title="Also used in IT">IT</span>' : ""}`;
  }
  function streak() {
    const active = (day) => {
      const l = P.log[dayKey(day)];
      return l && (l.r || 0) + (l.n || 0) + (l.o || 0) + (l.k || 0) > 0;
    };
    let d = today();
    if (!active(d)) d--;
    let n = 0;
    while (active(d)) {
      n++;
      d--;
    }
    return n;
  }
  function tally() {
    const t = { learned: 0, strong: 0, learning: 0, byLevel: {} };
    for (const [id, c] of Object.entries(P.cards)) {
      const w = wordFor(id);
      if (!w || c.q === "N" || c.q === "S") continue;
      if (c.q === "L" || c.q === "F") {
        t.learning++;
        continue;
      }
      t.learned++;
      if ((c.i || 0) >= 21) t.strong++;
      t.byLevel[w.lvl] = (t.byLevel[w.lvl] || 0) + 1;
    }
    t.core = LEVELS.reduce((sum, l) => sum + (t.byLevel[l] || 0), 0);
    t.coreTotal = LEVELS.reduce((sum, l) => sum + (levelTotals[l] || 0), 0);
    return t;
  }

  // ---------- Views ----------
  function renderHeader() {
    const tabs = [
      ["today", "Today"],
      ["words", "Words"],
      ["stats", "Progress"],
      ["options", "Options"],
    ];
    return `<header class="top">
      <a class="brand" href="#today"><span class="brand-name" lang="ru">Слово за&nbsp;словом</span><span class="brand-sub">Russian words to B2</span></a>
      <nav class="tabs" aria-label="Sections">${tabs
        .map(([v, label]) => `<a href="#${v}" class="tab"${view === v ? ' aria-current="page"' : ""}>${label}</a>`)
        .join("")}</nav>
    </header>`;
  }
  function previewBar() {
    if (!CONFIG.preview) return "";
    const shift = Math.round(clockOffset / DAY);
    return `<div class="preview-bar" role="note">
      <p><b>Preview</b> with ${plural(words.length, "sample word")}. Progress stays in this browser.${shift ? ` Pretending it's ${plural(shift, "day")} later.` : ""}</p>
      <div class="preview-actions"><button type="button" class="btn small" data-a="tomorrow">Skip to tomorrow</button><button type="button" class="btn small ghost" data-a="wipe">Start over</button></div>
    </div>`;
  }
  function progressBar(t) {
    let acc = 0;
    const ticks = LEVELS.map((l) => {
      acc += levelTotals[l] || 0;
      return { l, at: acc };
    });
    const total = t.coreTotal || 1;
    return `<div class="goal">
      <div class="goal-head"><span>B2 word list</span><span class="num">${num(t.core)} / ${num(t.coreTotal)}</span></div>
      <div class="goal-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${t.coreTotal}" aria-valuenow="${t.core}" aria-label="B2 words learned">
        <div class="goal-fill" style="width:${((t.core / total) * 100).toFixed(2)}%"></div>
        ${ticks.slice(0, -1).map((k) => `<span class="goal-tick" style="left:${((k.at / total) * 100).toFixed(2)}%"></span>`).join("")}
      </div>
      <div class="goal-levels">${ticks
        .map((k, i) => {
          const from = i ? ticks[i - 1].at : 0;
          return `<span style="width:${(((k.at - from) / total) * 100).toFixed(2)}%">${k.l}</span>`;
        })
        .join("")}</div>
    </div>`;
  }
  function renderToday() {
    const c = counts();
    const t = tally();
    const st = streak();
    const log = P.log[dayKey(today())] || {};
    const due = c.fresh + c.learn + c.rev;
    const minutes = Math.max(1, Math.round((c.fresh * 35 + c.learn * 9 + c.rev * 9) / 60));
    const unstarted = words.some((w) => deckOn(w) && !started(w.id));
    const studied = (log.r || 0) + (log.n || 0) + (log.o || 0) + (log.k || 0) > 0;
    const date = fmtDay(today(), { weekday: "long", day: "numeric", month: "long" });
    const main = due
      ? `<div class="due">
          <div class="due-n c-new"><b class="num">${num(c.fresh)}</b><span>new</span></div>
          <div class="due-n c-learn"><b class="num">${num(c.learn)}</b><span>learning</span></div>
          <div class="due-n c-rev"><b class="num">${num(c.rev)}</b><span>to review</span></div>
        </div>
        <button type="button" class="btn primary big" data-a="study">${studied ? "Continue" : "Start"} · about ${minutes} min</button>`
      : `<p class="done-line">${studied ? "All done for today ✓" : "Nothing due right now."}${c.later ? ` ${plural(c.learn, "word")} come back in ${fmtWait(c.later - now())}.` : ""}</p>
        ${unstarted ? '<button type="button" class="btn big" data-a="more">Learn 10 more words</button>' : ""}`;
    return `<section class="today">
      <p class="eyebrow">${h(date)}</p>
      <div class="sheet today-sheet">${main}</div>
      ${renderTodayWords()}
      ${testCardHTML()}
      <div class="facts">
        <div><b class="num">${num(st)}</b><span>${st === 1 ? "day" : "days"} in a row</span></div>
        <div><b class="num">${num(t.learned)}</b><span>words learned</span></div>
        <div><b class="num">${num(((log.n || 0) + (log.o || 0)))}</b><span>new today</span></div>
      </div>
      ${progressBar(t)}
      <p class="hint">New words come in the order of the <a href="https://ssharoff.github.io/kelly/" target="_blank" rel="noopener">Kelly list</a> (A1 to B2)${P.settings.work ? ", with a data-engineering word every fifth card" : ""}. Add your own words under <a href="#words">Words</a>.</p>
    </section>`;
  }

  // Today's daily words: the day's new words and what's already been started.
  function renderTodayWords() {
    const fresh = freshIds(newLeft());
    const startedToday = startedTodayIds();
    const due = dueNow();
    const ids = [...startedToday, ...fresh];
    const shown = ids.slice(0, 12);
    const rows = [];
    for (const id of shown) {
      const w = wordFor(id);
      if (!w) continue;
      const done = startedToday.includes(id);
      rows.push(`<li><span class="dw-ru" lang="ru">${h(w.ru)}</span><span class="dw-en">${h(w.en)}</span><span class="chip ${done ? "chip-rev" : "chip-new"}">${done ? "started" : "new"}</span></li>`);
    }
    const extra = ids.length - shown.length;
    const allDone = fresh.length === 0 && due.rev === 0 && due.learn === 0;
    const head =
      allDone && (startedToday.length || P.log[dayKey(today())])
        ? "All done for today ✓"
        : fresh.length
          ? `${plural(fresh.length, "new word")} to learn${due.rev ? ` · ${plural(due.rev, "review")} due` : ""}`
          : `${plural(due.rev, "review")} due${due.learn ? ` · ${plural(due.learn, "check")} due` : ""}`;
    return `<div class="sheet daily-words">
      <div class="daily-head"><h3>Today's words</h3><span class="muted">${h(head)}</span></div>
      ${rows.length ? `<ol class="daily-list">${rows.join("")}</ol>${extra > 0 ? `<p class="hint">…and ${plural(extra, "more word")}.</p>` : ""}` : `<p class="hint">${fresh.length || startedToday.length || due.rev || due.learn ? "The list refreshes as you study." : "Nothing due right now."}</p>`}
    </div>`;
  }

  function renderStudy() {
    const c = counts();
    const bar = `<header class="study-bar">
      <button type="button" class="icon-btn" data-a="close" aria-label="Stop and go back">✕ <span>Stop</span></button>
      <div class="counts" aria-label="Cards left: ${c.fresh} new, ${c.learn} learning, ${c.rev} to review">
        <span class="c-new" title="New">${num(c.fresh)}</span><span class="c-learn" title="Learning">${num(c.learn)}</span><span class="c-rev" title="To review">${num(c.rev)}</span>
      </div>
      <button type="button" class="icon-btn" data-a="undo" ${S.undo.length ? "" : "disabled"} aria-label="Undo last answer">↶ <span>Undo</span></button>
    </header>`;
    if (!S.id) return previewBar() + bar + renderDone(c);
    const w = wordFor(S.id);
    return previewBar() + bar + (S.kind === "intro" ? renderIntro(w) : renderTest(w));
  }
  function wordBlock(w) {
    return `<div class="word-row"><h2 class="word" lang="ru">${h(w.ru)}</h2>${speakBtn(w.ru, "Say the word")}</div>
      ${grammarHTML(w) ? `<p class="grammar">${grammarHTML(w)}</p>` : ""}`;
  }
  function detailsBlock(w) {
    const ex = w.ex
      ? `<div class="example"><p lang="ru">${exampleHTML(w.ex)} ${speakBtn(w.ex, "Say the example")}</p>${w.exEn ? `<p class="ex-en">${h(w.exEn)}</p>` : ""}</div>`
      : "";
    const edit = S.editing
      ? `<form class="edit-form" data-form="edit"><label for="edit-en">Meaning</label><input id="edit-en" name="en" value="${h(w.en)}" autocomplete="off"><button class="btn small primary">Save</button><button type="button" class="btn small ghost" data-a="edit-cancel">Cancel</button></form>`
      : "";
    const hide = S.confirmHide
      ? `<span class="confirm">Hide this word for good? <button type="button" class="link-btn danger" data-a="hide-yes">Hide</button> <button type="button" class="link-btn" data-a="hide-no">Keep</button></span>`
      : `<button type="button" class="link-btn" data-a="edit">Edit meaning</button><button type="button" class="link-btn" data-a="hide">Hide word</button>`;
    return `${ex}${edit}<p class="card-foot"><span class="sources">${sourcesHTML(w)}</span><span class="card-tools">${hide}</span></p>`;
  }
  function renderIntro(w) {
    return `<article class="card sheet" aria-live="polite">
        <div class="card-tags"><span class="chip chip-new">New word</span>${levelChip(w)}</div>
        ${wordBlock(w)}
        <p class="meaning">${h(w.en)}</p>
        ${detailsBlock(w)}
      </article>
      <div class="actions two">
        <button type="button" class="btn" data-a="known">I know it <kbd>K</kbd></button>
        <button type="button" class="btn primary" data-a="learn">Got it <kbd>Space</kbd></button>
      </div>
      <p class="hint center">Say it out loud. In a minute you'll be asked if you remember it.</p>`;
  }
  function renderTest(w) {
    const c = P.cards[S.id];
    const tag = c.q === "R" ? '<span class="chip chip-rev">Review</span>' : c.q === "F" ? '<span class="chip chip-learn">Again</span>' : '<span class="chip chip-learn">Check</span>';
    const ruFirst = S.dir === "ru";
    const front = ruFirst ? wordBlock(w) : `<p class="prompt">${h(w.en)}</p>${(w.g || w.asp) && !S.revealed ? `<p class="grammar">${grammarHTML({ g: w.g, asp: w.asp })}</p>` : ""}`;
    const back = !S.revealed ? "" : ruFirst ? `<hr class="fold"><p class="meaning">${h(w.en)}</p>${detailsBlock(w)}` : `<hr class="fold">${wordBlock(w)}${detailsBlock(w)}`;
    const q = ruFirst ? "What does it mean?" : "How do you say it in Russian?";
    let actions;
    if (!S.revealed) {
      actions = `<div class="actions"><button type="button" class="btn primary wide" data-a="reveal">Show answer <kbd>Space</kbd></button></div><p class="hint center">${q} Say it, then check.</p>`;
    } else {
      const t = now();
      const names = ["Again", "Hard", "Good", "Easy"];
      actions = `<div class="actions grades">${names
        .map((name, i) => `<button type="button" class="grade g${i + 1}" data-a="grade" data-g="${i + 1}"><span>${name}</span><small>${h(schedule(c, i + 1, t).label)}</small><kbd>${i + 1}</kbd></button>`)
        .join("")}</div><p class="hint center">How well did you remember? The time under each button is when you'll see the word again.</p>`;
    }
    return `<article class="card sheet" aria-live="polite"><div class="card-tags">${tag}${levelChip(w)}</div>${front}${back}</article>${actions}`;
  }
  function renderDone(c) {
    const tomorrow = Object.entries(P.cards).filter(([id, k]) => k.q === "R" && k.due === today() + 1 && wordFor(id)).length;
    const unstarted = words.some((w) => deckOn(w) && !started(w.id));
    const mins = Math.max(1, Math.round(S.ms / MIN));
    const later = c.later ? `<p>${plural(c.learn, "word")} come back in ${fmtWait(c.later - now())} for one more check.</p>` : "";
    return `<article class="card sheet done">
      <h2>All done for today</h2>
      <p>${S.answered || S.started ? `You answered ${plural(S.answered, "card")} and started ${plural(S.started, "new word")} in about ${plural(mins, "minute")}.` : "There's nothing to study right now."}</p>
      ${later}
      <p>Tomorrow: ${plural(tomorrow, "review")}${P.settings.newPerDay ? ` and up to ${num(P.settings.newPerDay)} new words` : ""}.</p>
    </article>
    <div class="actions two">
      <button type="button" class="btn" data-a="home">Back to today</button>
      ${unstarted ? '<button type="button" class="btn primary" data-a="more">Learn 10 more</button>' : ""}
    </div>`;
  }

  // Words list
  const W_STATE = { q: "", filter: "all", level: "all", days: 15, open: null, editing: null, addNote: "" };
  function filteredWords() {
    const q = keyOf(W_STATE.q);
    const all = [...ownIds().map((id) => wordFor(id)), ...words.map((w) => wordFor(w.id))].filter(Boolean);
    return all.filter((w) => {
      const st = status(w.id);
      if (W_STATE.filter === "mine" && w.deck !== "own") return false;
      if (W_STATE.filter !== "all" && W_STATE.filter !== "mine") {
        const want = { new: ["new"], learning: ["learning"], learned: ["learned", "strong", "known"], hidden: ["hidden"] }[W_STATE.filter];
        if (!want.includes(st)) return false;
      }
      if (W_STATE.level !== "all" && !(w.lvl === W_STATE.level || (W_STATE.level === "IT" && w.work))) return false;
      return !q || keyOf(w.ru).includes(q) || w.en.toLowerCase().includes(q);
    });
  }
  function wordRow(w) {
    const st = status(w.id);
    const c = P.cards[w.id];
    const open = W_STATE.open === w.id;
    let next = "";
    if (c && c.q === "R") next = c.due <= today() ? "Due today" : `Next review ${fmtDay(c.due, { day: "numeric", month: "short" })}`;
    const actions = [];
    if (st === "new") actions.push(`<button type="button" class="btn small" data-a="pull" data-id="${h(w.id)}">${P.pull[w.id] ? "Queued next" : "Learn it next"}</button>`, `<button type="button" class="btn small ghost" data-a="mark-known" data-id="${h(w.id)}">I know it</button>`);
    if (st === "hidden") actions.push(`<button type="button" class="btn small" data-a="unhide" data-id="${h(w.id)}">Show again</button>`);
    else if (st !== "new") actions.push(`<button type="button" class="btn small ghost" data-a="reset" data-id="${h(w.id)}">Start this word over</button>`);
    if (st !== "hidden") actions.push(`<button type="button" class="btn small ghost" data-a="hide-row" data-id="${h(w.id)}">Hide</button>`);
    if (w.deck === "own") actions.push(`<button type="button" class="btn small ghost danger" data-a="delete-own" data-id="${h(w.id)}">Delete</button>`);
    else actions.push(`<button type="button" class="btn small ghost" data-a="edit-row" data-id="${h(w.id)}">Edit meaning</button>`);
    const editing =
      W_STATE.editing === w.id
        ? `<form class="edit-form" data-form="edit-row" data-id="${h(w.id)}"><label for="row-en">Meaning</label><input id="row-en" name="en" value="${h(w.en)}" autocomplete="off"><button class="btn small primary">Save</button></form>`
        : "";
    const detail = open
      ? `<div class="row-detail">
          ${w.ex ? `<p lang="ru" class="row-ex">${exampleHTML(w.ex)}</p>${w.exEn ? `<p class="ex-en">${h(w.exEn)}</p>` : ""}` : ""}
          ${grammarHTML(w) ? `<p class="grammar">${grammarHTML(w)}</p>` : ""}
          <p class="sources">${sourcesHTML(w)}${next ? ` · ${h(next)}` : ""}</p>
          ${editing}
          <div class="row-actions">${actions.join("")}</div>
        </div>`
      : "";
    return `<li class="wrow${open ? " open" : ""}">
      <button type="button" class="wrow-main" data-a="toggle-row" data-id="${h(w.id)}" aria-expanded="${open}">
        <span class="w-ru" lang="ru">${h(w.ru)}</span><span class="w-en">${h(w.en)}</span>
        <span class="w-meta">${levelChip(w)}<span class="st st-${st}">${STATUS_LABEL[st]}</span></span>
      </button>${detail}</li>`;
  }
  function renderWordList() {
    const list = filteredWords();
    const groups = groupedWords(list);
    const searching = Boolean(W_STATE.q.trim());
    const shownGroups = searching ? groups : groups.slice(0, W_STATE.days);
    const html = shownGroups
      .map((g) => {
        const open = searching || g.key === "today";
        const date = g.day >= 0 && g.key.startsWith("up") ? `<span class="dg-date">${h(fmtDay(g.day, { weekday: "short", day: "numeric", month: "short" }))}</span>` : "";
        return `<details class="day-group"${open ? " open" : ""}>
          <summary><span class="dg-label">${h(g.label)}</span><span class="dg-count">${plural(g.words.length, "word")}</span>${date}</summary>
          <ul class="wlist">${g.words.map(wordRow).join("")}</ul>
        </details>`;
      })
      .join("");
    const more =
      !searching && groups.length > shownGroups.length
        ? `<button type="button" class="btn wide" data-a="more-days">Show ${num(Math.min(15, groups.length - shownGroups.length))} more days</button>`
        : "";
    return `<p class="list-count">${plural(list.length, "word")} · grouped by study day</p>
      ${html}${more}`;
  }

  // The filtered words, split into day groups: Today, upcoming daily batches,
  // then the days words were learned on (most recent first), then hidden.
  function groupedWords(list) {
    const t = today();
    const todaySet = new Set(freshIds());
    const batchOf = upcomingBatchOf();
    const groups = new Map();
    const add = (key, label, day, w) => {
      if (!groups.has(key)) groups.set(key, { key, label, day, words: [] });
      groups.get(key).words.push(w);
    };
    for (const w of list) {
      const c = P.cards[w.id];
      if (c && c.q === "S") {
        add("hidden", "Hidden", -1, w);
        continue;
      }
      if (c && c.q !== "N" && c.a != null) {
        const d = c.a;
        add("d" + d, d === t ? "Today" : fmtDay(d, { weekday: "short", day: "numeric", month: "short" }), d, w);
        continue;
      }
      if (P.pull[w.id] || todaySet.has(w.id)) {
        add("today", "Today", t, w);
        continue;
      }
      if (!P.settings.newPerDay) {
        add("off", "Skipped · new words are off", -1, w);
        continue;
      }
      if (!deckOn(w)) {
        add("off", "Skipped · data-engineering words are off", -1, w);
        continue;
      }
      const b = batchOf.get(w.id);
      if (b === undefined) {
        add("off", "Not scheduled", -1, w);
        continue;
      }
      const day = t + b + 1;
      add("up" + b, b === 0 ? "Tomorrow" : `In ${b + 1} days`, day, w);
    }
    const ordered = [];
    if (groups.has("today")) ordered.push(groups.get("today"));
    for (const [, g] of [...groups].sort((a, b) => a[1].day - b[1].day)) if (g.key.startsWith("up")) ordered.push(g);
    for (const [, g] of [...groups].sort((a, b) => b[1].day - a[1].day)) if (g.key.startsWith("d")) ordered.push(g);
    for (const key of ["off", "hidden"]) if (groups.has(key)) ordered.push(groups.get(key));
    return ordered;
  }
  function renderWords() {
    const opt = (v, label, cur) => `<option value="${v}"${cur === v ? " selected" : ""}>${label}</option>`;
    return `<section class="words">
      <details class="sheet add-sheet"${W_STATE.addNote ? " open" : ""}>
        <summary>Add your own word</summary>
        <form data-form="add" class="add-form">
          <div class="field"><label for="add-ru">Russian</label><input id="add-ru" name="ru" lang="ru" placeholder="доро'жка" autocomplete="off" required></div>
          <div class="field"><label for="add-en">Meaning</label><input id="add-en" name="en" placeholder="path" autocomplete="off" required></div>
          <div class="field wide"><label for="add-ex">Example (optional)</label><input id="add-ex" name="ex" lang="ru" placeholder="Мы шли по доро'жке." autocomplete="off"></div>
          <button class="btn primary">Add word</button>
        </form>
        <p class="hint">Put ' after the stressed vowel: <span lang="ru">доро'жка</span> becomes <span lang="ru">доро́жка</span>. Your words come up first in your next session.</p>
        ${W_STATE.addNote ? `<p class="note" role="status">${h(W_STATE.addNote)}</p>` : ""}
      </details>
      <div class="filters">
        <label class="search"><span class="sr">Search</span><input id="word-search" type="search" placeholder="Search Russian or English" value="${h(W_STATE.q)}" autocomplete="off"></label>
        <select id="word-filter" aria-label="Status">${opt("all", "All words", W_STATE.filter)}${opt("new", "Not started", W_STATE.filter)}${opt("learning", "Learning", W_STATE.filter)}${opt("learned", "Learned", W_STATE.filter)}${opt("mine", "Your words", W_STATE.filter)}${opt("hidden", "Hidden", W_STATE.filter)}</select>
        <select id="word-level" aria-label="Level">${opt("all", "All levels", W_STATE.level)}${LEVELS.map((l) => opt(l, l, W_STATE.level)).join("")}${opt("IT", "IT words", W_STATE.level)}</select>
      </div>
      <div id="word-list">${renderWordList()}</div>
    </section>`;
  }

  // Progress
  function barChart(values, labels, opts) {
    const wdt = 600;
    const hgt = 150;
    const pad = { l: 30, r: 6, t: 10, b: 22 };
    const max = Math.max(4, ...values.map((v) => v.total));
    const step = Math.pow(10, Math.floor(Math.log10(max)));
    const tick = [1, 2, 5, 10].map((m) => m * step).find((s) => max / s <= 4) || step * 10;
    const top = Math.ceil(max / tick) * tick;
    const bw = (wdt - pad.l - pad.r) / values.length;
    const y = (v) => pad.t + (hgt - pad.t - pad.b) * (1 - v / top);
    let g = "";
    for (let v = 0; v <= top; v += tick) g += `<line x1="${pad.l}" x2="${wdt - pad.r}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${pad.l - 6}" y="${y(v) + 4}" class="axis" text-anchor="end">${num(v)}</text>`;
    values.forEach((v, i) => {
      const x = pad.l + i * bw + bw * 0.15;
      const w = bw * 0.7;
      let base = 0;
      for (const part of v.parts) {
        if (part.v > 0) g += `<rect x="${x.toFixed(1)}" y="${y(base + part.v).toFixed(1)}" width="${w.toFixed(1)}" height="${(y(base) - y(base + part.v)).toFixed(1)}" class="${part.cls}"><title>${h(v.title)}</title></rect>`;
        base += part.v;
      }
      if (labels[i]) g += `<text x="${(x + w / 2).toFixed(1)}" y="${hgt - 6}" class="axis" text-anchor="middle">${h(labels[i])}</text>`;
    });
    return `<svg viewBox="0 0 ${wdt} ${hgt}" class="chart" role="img" aria-label="${h(opts.label)}">${g}</svg>`;
  }
  function renderStats() {
    const t = tally();
    const d = today();
    const days = [];
    let rv = 0;
    let rl = 0;
    let ms7 = 0;
    for (let i = 29; i >= 0; i--) {
      const l = P.log[dayKey(d - i)] || {};
      const fresh = (l.n || 0) + (l.o || 0);
      const reviews = Math.max(0, (l.r || 0) - fresh);
      rv += l.rv || 0;
      rl += l.rl || 0;
      if (i < 7) ms7 += l.ms || 0;
      days.push({ total: fresh + reviews, parts: [{ v: reviews, cls: "bar-rev" }, { v: fresh, cls: "bar-new" }], title: `${fmtDay(d - i, { day: "numeric", month: "short" })}: ${fresh} new, ${reviews} other answers` });
    }
    const forecast = [];
    for (let i = 0; i < 14; i++) {
      let n = 0;
      for (const [id, c] of Object.entries(P.cards)) if (c.q === "R" && wordFor(id) && (i === 0 ? c.due <= d : c.due === d + i)) n++;
      forecast.push({ total: n, parts: [{ v: n, cls: "bar-due" }], title: `${fmtDay(d + i, { day: "numeric", month: "short" })}: ${n} reviews` });
    }
    const lbl30 = days.map((_, i) => (i % 7 === 2 ? fmtDay(d - 29 + i, { day: "numeric", month: "short" }) : ""));
    const lbl14 = forecast.map((_, i) => (i === 0 ? "Today" : i % 3 === 0 ? fmtDay(d + i, { day: "numeric", month: "short" }) : ""));
    const rate = rv ? Math.round(((rv - rl) / rv) * 100) + "%" : "–";
    const left = words.filter((w) => w.deck === "core" && !started(w.id)).length;
    const perDay = Math.max(1, P.settings.newPerDay);
    const finish = left ? `At ${num(perDay)} new words a day you'll have met every word on the B2 list by ${fmtDay(d + Math.ceil(left / perDay), { day: "numeric", month: "long", year: "numeric" })}.` : "You've met every word on the B2 list.";
    return `<section class="stats">
      <div class="facts four">
        <div><b class="num">${num(t.learned)}</b><span>words learned</span></div>
        <div><b class="num">${num(t.strong)}</b><span>known well (3+ weeks)</span></div>
        <div><b class="num">${num(streak())}</b><span>${streak() === 1 ? "day" : "days"} in a row</span></div>
        <div><b class="num">${rate}</b><span>remembered in reviews, last 30 days</span></div>
      </div>
      ${progressBar(t)}
      <table class="levels"><thead><tr><th>Level</th><th>Learned</th><th>Words</th></tr></thead><tbody>
        ${[...LEVELS, "IT"].map((l) => `<tr><td>${l === "IT" ? "IT words" : l}</td><td class="num">${num(t.byLevel[l] || 0)}</td><td class="num">${num(levelTotals[l] || 0)}</td></tr>`).join("")}
      </tbody></table>
      <p class="hint">${h(finish)} You studied for ${plural(Math.round(ms7 / MIN), "minute")} in the last 7 days.</p>
      ${testHistoryHTML()}
      <h3>Last 30 days</h3>
      ${barChart(days, lbl30, { label: "Cards answered per day over the last 30 days" })}
      <p class="legend"><span class="key key-new"></span>new words <span class="key key-rev"></span>reviews and checks</p>
      <h3>Reviews coming up</h3>
      ${barChart(forecast, lbl14, { label: "Reviews due in the next 14 days" })}
    </section>`;
  }

  // Options
  function renderOptions() {
    const seg = (name, value, label) =>
      `<button type="button" class="seg${P.settings[name] === value ? " on" : ""}" data-a="set" data-k="${name}" data-v="${h(JSON.stringify(value))}" aria-pressed="${P.settings[name] === value}">${label}</button>`;
    const voiceNote = !("speechSynthesis" in window)
      ? "This browser can't speak."
      : voice
        ? `Voice: ${h(voice.name)}.`
        : "No Russian voice found on this device. On a phone, add one in the system's speech settings.";
    const syncBlock = CONFIG.preview
      ? `<p class="hint">In the real app you enter your email here and your words sync between your phone and laptop.</p>`
      : `<form data-form="email" class="inline-form"><label for="email" class="sr">Email</label><input id="email" name="email" type="email" placeholder="you@example.com" value="${h(email)}" autocomplete="email"><button class="btn">${email ? "Switch" : "Sync"}</button>${email ? '<button type="button" class="btn ghost" data-a="sync-off">Stop syncing</button>' : ""}</form>
         <p class="hint" id="sync-status" data-state="${sync.state}">${h(syncText())}</p>
         <p class="hint">There's no password: anyone who knows the email can see these words. Use the same email as the Russian roadmap.</p>`;
    return `<section class="options">
      <div class="opt"><h3>New words a day</h3><div class="segs">${[5, 10, 15, 20, 30].map((n) => seg("newPerDay", n, String(n))).join("")}</div>
        <p class="hint">Each new word takes about half a minute on its first day, and comes back for short reviews after that.</p></div>
      <div class="opt"><h3>Show first</h3><div class="segs">${seg("dir", "ru", "Russian")}${seg("dir", "en", "English")}${seg("dir", "mix", "Mixed")}</div></div>
      <div class="opt"><h3>Read words aloud</h3><div class="segs">${seg("audio", true, "On")}${seg("audio", false, "Off")}</div><p class="hint">${voiceNote}${voice ? ' <button type="button" class="link-btn" data-a="speak" data-text="Приве́т! Как дела́?">Try it</button>' : ""}</p></div>
      <div class="opt"><h3>Data-engineering words</h3><div class="segs">${seg("work", true, "Include")}${seg("work", false, "Skip")}</div><p class="hint">${num(levelTotals.IT || 0)} terms from Wiktionary and Wikipedia, one in every five new words.</p></div>
      <div class="opt"><h3>Word tests</h3>
        <div class="segs">${seg("testDays", "daily", "Every day")}${seg("testDays", "mwf", "Mon, Wed, Fri")}${seg("testDays", "sun", "Sundays")}${seg("testDays", "off", "Only when I start one")}</div>
        <div class="segs">${[10, 20, 30].map((n) => seg("testSize", n, `${n} questions`)).join("")}</div>
        <div class="segs">${seg("typing", true, "With typing")}${seg("typing", false, "Choices only")}</div>
        <p class="hint">Tests use words you've already learned: pick the meaning, pick the Russian word, fill the gap in a sentence, listen, or type the word. Typing needs a Russian keyboard.</p></div>
      <div class="opt"><h3>Sync</h3>${syncBlock}</div>
      ${CONFIG.preview ? "" : `<div class="opt"><h3>Backup</h3><div class="segs"><button type="button" class="btn" data-a="export">Download backup</button><label class="btn ghost file-btn">Restore from file<input type="file" id="import-file" accept="application/json,.json"></label></div></div>`}
      <div class="opt"><h3>Start over</h3>${
        W_STATE.confirmWipe
          ? `<p>Delete all progress on this device${email ? " and on the server" : ""}? <button type="button" class="btn small danger" data-a="wipe-yes">Delete everything</button> <button type="button" class="btn small ghost" data-a="wipe-no">Cancel</button></p>`
          : '<button type="button" class="btn ghost danger" data-a="wipe">Delete all progress</button>'
      }</div>
      <div class="opt credits"><h3>Where the words come from</h3>
        <p>Word list and levels: the ${link("https://ssharoff.github.io/kelly/", "Kelly project")} Russian list by Serge Sharoff (CC BY-NC-SA). Meanings, stress and grammar: ${link("https://en.wiktionary.org/", "English Wiktionary")} via ${link("https://kaikki.org/", "kaikki.org")} (CC BY-SA), and ${link("https://en.openrussian.org/", "OpenRussian")} (CC BY-SA) where Wiktionary has no entry. Example sentences: ${link("https://tatoeba.org/", "Tatoeba")} (CC BY 2.0 FR). IT terms: Wiktionary and ${link("https://www.wikidata.org/", "Wikidata")}. Scheduling: FSRS-5, the algorithm Anki uses.</p></div>
    </section>`;
  }

  // ---------- Word tests ----------
  // A test checks words you've already learned. A wrong answer sends the word back to your study cards.
  let Q = null;
  function isTestDay(day) {
    const s = P.settings.testDays;
    const wd = new Date(day * DAY).getUTCDay();
    return s === "daily" || (s === "mwf" && [1, 3, 5].includes(wd)) || (s === "sun" && wd === 0);
  }
  function nextTestDay() {
    for (let i = 1; i <= 7; i++) if (isTestDay(today() + i)) return today() + i;
    return null;
  }
  const testPool = () =>
    Object.entries(P.cards)
      .filter(([id, c]) => c.q === "R" && wordFor(id))
      .map(([id, c]) => ({ id, c }));
  const firstSense = (en) => (String(en).split(/;\s*/)[0].replace(/\s*\([^()]*\)\s*$/, "").trim() || String(en)).slice(0, 70);
  const kindOf = (w) => (w.g ? "noun" : w.asp || /^to /.test(firstSense(w.en)) ? "verb" : "other");
  const markedForm = (ex) => (ex && ex.split("*").length >= 3 ? ex.split("*")[1] : null);
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  // Three wrong options taken from other words: same kind (noun, verb, other), similar level, clearly different.
  function distractors(w, valueOf) {
    const all = [...words, ...ownIds().map((id) => wordFor(id))].filter(Boolean);
    const at = posOf.has(w.id) ? posOf.get(w.id) : -1;
    const seen = new Set([keyOf(valueOf(w) || "")]);
    const out = [];
    const tryAdd = (x) => {
      if (out.length >= 3 || x.id === w.id || keyOf(x.ru) === keyOf(w.ru)) return;
      const v = valueOf(x);
      if (!v || seen.has(keyOf(v))) return;
      seen.add(keyOf(v));
      out.push(v);
    };
    const near = all.filter((x) => kindOf(x) === kindOf(w) && (at < 0 || !posOf.has(x.id) || Math.abs(posOf.get(x.id) - at) < 400));
    shuffle(near).forEach(tryAdd);
    if (out.length < 3) shuffle(all).forEach(tryAdd);
    return out;
  }
  function makeQuestion(w, type) {
    if (type === "type") return P.settings.typing ? { id: w.id, type } : null;
    if (type === "listen" && !voice) return null;
    let right = null;
    let wrong = [];
    if (type === "meaning" || type === "listen") {
      right = firstSense(w.en);
      wrong = distractors(w, (x) => firstSense(x.en));
    } else if (type === "russian") {
      right = w.ru;
      wrong = distractors(w, (x) => x.ru);
    } else if (type === "gap") {
      // every option takes the capital letter only if the gap starts the sentence
      const atStart = /^\s*\*/.test(w.ex || "");
      const fit = (form, x) =>
        !form ? null : /^[А-ЯЁ]/.test(x.ru) ? form : (atStart ? form[0].toUpperCase() : form[0].toLowerCase()) + form.slice(1);
      right = fit(markedForm(w.ex), w);
      if (right) wrong = distractors(w, (x) => fit(markedForm(x.ex), x));
    }
    if (!right || wrong.length < 3) return null;
    const options = shuffle([right, ...wrong]);
    return { id: w.id, type, options, answer: options.indexOf(right) };
  }
  function buildQuiz(size) {
    const d = today();
    let pool = testPool();
    const older = pool.filter((p) => (p.c.a ?? 0) < d);
    if (older.length >= Math.min(size, 5)) pool = older; // words from earlier days first
    shuffle(pool);
    pool.sort((a, b) => (a.c.x ?? -1) - (b.c.x ?? -1)); // never tested, or tested longest ago, first
    const order = shuffle(["meaning", "russian", "gap", "listen", "type"]);
    let k = 0;
    const qs = [];
    for (const p of pool.slice(0, size)) {
      const w = wordFor(p.id);
      let q = null;
      for (let tries = 0; tries < order.length && !q; tries++) q = makeQuestion(w, order[k++ % order.length]);
      q = q || makeQuestion(w, "meaning") || { id: w.id, type: "type" };
      qs.push(q);
    }
    return shuffle(qs);
  }
  function startQuiz() {
    const qs = buildQuiz(P.settings.testSize);
    if (!qs.length) {
      toast("Learn a few words first: tests use words you've learned.");
      return go("today");
    }
    Q = { qs, i: 0, answered: false, ok: false, near: false, picked: null, typed: "", correct: 0, wrong: [], done: false };
    S = null;
    view = "test";
    if (location.hash !== "#test") history.replaceState(null, "", "#test");
    render();
    quizAutoplay();
  }
  function quizAutoplay() {
    const q = Q && !Q.done && Q.qs[Q.i];
    if (q && q.type === "listen") speak(wordFor(q.id).ru);
  }
  function quizRecord(ok) {
    const q = Q.qs[Q.i];
    const log = todayLog();
    bump(log, "tq");
    if (ok) bump(log, "tc");
    const c = P.cards[q.id];
    if (c && c.q === "R") P.cards[q.id] = ok ? { ...c, x: today(), t: now() } : { ...schedule(c, 1, now()).card, x: today() };
    if (ok) Q.correct++;
    else Q.wrong.push(q.id);
    Q.answered = true;
    Q.ok = ok;
    save();
    render();
    if (P.settings.audio) speak(wordFor(q.id).ru);
  }
  function quizPick(i) {
    const q = Q.qs[Q.i];
    if (Q.answered || !q.options) return;
    Q.picked = i;
    quizRecord(i === q.answer);
  }
  function lev(a, b) {
    if (Math.abs(a.length - b.length) > 1) return 2;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }
  function quizType(value) {
    const q = Q.qs[Q.i];
    if (Q.answered) return;
    const want = keyOf(wordFor(q.id).ru);
    const got = keyOf(value);
    Q.typed = value;
    Q.near = got !== want && want.length >= 5 && lev(got, want) === 1;
    quizRecord(Boolean(got) && (got === want || Q.near));
  }
  function quizNext() {
    if (!Q.answered) return;
    Q.i++;
    Object.assign(Q, { answered: false, ok: false, near: false, picked: null, typed: "" });
    if (Q.i >= Q.qs.length) {
      Q.done = true;
      bump(todayLog(), "tt");
      save();
    }
    render();
    quizAutoplay();
  }
  function renderQuiz() {
    if (Q.done) return renderQuizDone();
    const q = Q.qs[Q.i];
    const w = wordFor(q.id);
    const bar = `<header class="study-bar">
      <button type="button" class="icon-btn" data-a="q-stop" aria-label="Stop the test">✕ <span>Stop</span></button>
      <div class="counts"><span class="num">${Q.i + 1} / ${Q.qs.length}</span><span class="c-rev num" title="Right so far">✓ ${Q.correct}</span></div>
    </header>
    <div class="quiz-progress" aria-hidden="true"><span style="width:${((Q.i / Q.qs.length) * 100).toFixed(1)}%"></span></div>`;
    const ask = { meaning: "What does it mean?", russian: "Which Russian word is it?", gap: "Fill the gap", listen: "Listen: what does it mean?", type: "Type it in Russian" }[q.type];
    let prompt = "";
    if (q.type === "meaning") prompt = `<div class="word-row"><h2 class="word" lang="ru">${h(w.ru)}</h2>${speakBtn(w.ru, "Say the word")}</div>`;
    if (q.type === "russian" || q.type === "type") prompt = `<p class="prompt">${h(w.en)}</p>${w.g || w.asp ? `<p class="grammar">${grammarHTML({ g: w.g, asp: w.asp })}</p>` : ""}`;
    if (q.type === "gap") {
      const sentence = Q.answered ? w.ex : w.ex.replace(/\*[^*]*\*/, "*_____*");
      prompt = `<p class="gap" lang="ru">${exampleHTML(sentence)}</p>${w.exEn ? `<p class="ex-en">${h(w.exEn)}</p>` : ""}`;
    }
    if (q.type === "listen") prompt = `<button type="button" class="btn listen-btn" data-a="q-replay">${SPEAKER} Play again</button>`;
    const typing =
      q.type === "type"
        ? `<form class="type-form" data-form="q-type"><label for="q-input" class="sr">The word in Russian</label><input id="q-input" name="answer" lang="ru" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" value="${h(Q.typed)}" ${Q.answered ? "disabled" : ""}><button class="btn primary" ${Q.answered ? "disabled" : ""}>Check</button><button type="button" class="btn ghost" data-a="q-skip" ${Q.answered ? "disabled" : ""}>I don't know</button></form>`
        : "";
    const verdict = !Q.answered
      ? ""
      : `<div class="verdict ${Q.ok ? "ok" : "bad"}" role="status">${Q.ok ? (Q.near ? "Right, but check the spelling." : "Right.") : "Not this time. The word goes back into your study cards."}</div>
        <div class="answer-word"><span class="aw-ru" lang="ru">${h(w.ru)}</span>${speakBtn(w.ru, "Say the word")}<span class="aw-en">${h(w.en)}</span></div>`;
    const ruOptions = q.type === "russian" || q.type === "gap";
    const options = q.options
      ? `<div class="options">${q.options
          .map((o, i) => {
            const cls = !Q.answered ? "" : i === q.answer ? " right" : i === Q.picked ? " wrong" : "";
            return `<button type="button" class="option${cls}" data-a="q-pick" data-i="${i}" ${Q.answered ? "disabled" : ""}><kbd>${i + 1}</kbd><span${ruOptions ? ' lang="ru"' : ""}>${h(o)}</span></button>`;
          })
          .join("")}</div>`
      : "";
    const next = Q.answered
      ? `<div class="actions"><button type="button" class="btn primary wide" data-a="q-next">${Q.i + 1 < Q.qs.length ? "Next" : "See your score"} <kbd>Enter</kbd></button></div>`
      : "";
    return `${bar}<article class="card sheet quiz-card" aria-live="polite"><div class="card-tags"><span class="chip chip-new">${ask}</span>${levelChip(w)}</div>${prompt}${typing}${verdict}</article>${options}${next}`;
  }
  function renderQuizDone() {
    const total = Q.qs.length;
    const pct = Math.round((Q.correct / total) * 100);
    const missed = Q.wrong.map((id) => wordFor(id)).filter(Boolean);
    return `<article class="card sheet done">
      <h2>Test done: ${Q.correct} / ${total}</h2>
      <p>${pct}% right.</p>
      ${missed.length ? `<p>These words went back into your study cards:</p><ul class="missed">${missed.map((w) => `<li><span lang="ru">${h(w.ru)}</span><span>${h(w.en)}</span></li>`).join("")}</ul>` : "<p>No mistakes.</p>"}
    </article>
    <div class="actions two">
      <button type="button" class="btn" data-a="q-stop">Back to today</button>
      ${missed.length ? '<button type="button" class="btn primary" data-a="q-study">Study them now</button>' : '<button type="button" class="btn primary" data-a="quiz">Another test</button>'}
    </div>`;
  }
  function testCardHTML() {
    const s = P.settings.testDays;
    const log = P.log[dayKey(today())] || {};
    const pool = testPool().length;
    if (pool < 5) return s === "off" ? "" : `<div class="sheet test-sheet"><div><h3>Word test</h3><p class="hint">Tests start once you've learned 5 words (you have ${num(pool)}).</p></div></div>`;
    const n = Math.min(P.settings.testSize, pool);
    if (log.tt) {
      const pct = Math.round(((log.tc || 0) / (log.tq || 1)) * 100);
      return `<div class="sheet test-sheet"><div><h3>Tested today: ${num(log.tc || 0)} / ${num(log.tq || 0)} right</h3><p class="hint">${pct}%. Missed words are back in your study cards.</p></div><button type="button" class="btn small ghost" data-a="quiz">Another test</button></div>`;
    }
    if (isTestDay(today()))
      return `<div class="sheet test-sheet"><div><h3>Today's test</h3><p class="hint">${plural(n, "word")} you've learned, about ${plural(Math.max(1, Math.round((n * 12) / 60)), "minute")}. A wrong answer sends the word back to your study cards.</p></div><button type="button" class="btn primary" data-a="quiz">Start test</button></div>`;
    const nd = nextTestDay();
    return `<p class="hint test-line">${nd ? `Next test: ${h(fmtDay(nd, { weekday: "long" }))}.` : "Tests run only when you start one."} <button type="button" class="link-btn" data-a="quiz">Test yourself now</button></p>`;
  }
  function testHistoryHTML() {
    const rows = Object.entries(P.log)
      .filter(([, l]) => l.tq)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 8);
    if (!rows.length) return `<h3>Tests</h3><p class="hint">No tests yet. They start once you've learned 5 words.</p>`;
    return `<h3>Tests</h3><table class="levels"><thead><tr><th>Day</th><th>Right</th><th>Score</th></tr></thead><tbody>${rows
      .map(([k, l]) => `<tr><td>${h(fmtDay(Math.round(Date.parse(k) / DAY), { weekday: "short", day: "numeric", month: "short" }))}</td><td class="num">${num(l.tc || 0)} / ${num(l.tq)}</td><td class="num">${Math.round(((l.tc || 0) / l.tq) * 100)}%</td></tr>`)
      .join("")}</tbody></table>`;
  }

  function render() {
    document.body.dataset.view = view;
    if (view === "study") {
      app.innerHTML = `<div class="shell study">${renderStudy()}</div>`;
      return;
    }
    if (view === "test") {
      app.innerHTML = `<div class="shell study">${previewBar()}${renderQuiz()}</div>`;
      const input = document.getElementById("q-input");
      if (input && !input.disabled) input.focus();
      return;
    }
    const body = { today: renderToday, words: renderWords, stats: renderStats, options: renderOptions }[view]();
    app.innerHTML = `<div class="shell">${previewBar()}${renderHeader()}<main>${body}</main></div>`;
  }
  let toastTimer = 0;
  function toast(msg) {
    let el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  // ---------- Own words ----------
  const VOWEL_APOSTROPHE = /([аеиоуыэюяАЕИОУЫЭЮЯ])['’`´]/g;
  const withStress = (s) => s.replace(VOWEL_APOSTROPHE, "$1" + ACUTE).trim();
  function addOwnWord(form) {
    const ru = withStress(form.ru.value);
    const en = form.en.value.trim();
    const exRaw = withStress(form.ex.value);
    if (!/[а-яё]/i.test(ru) || !en) {
      W_STATE.addNote = "Type the Russian word and its meaning.";
      return render();
    }
    const k = keyOf(ru);
    const mine = ownIds().find((id) => keyOf(P.own[id].ru) === k);
    if (mine) {
      W_STATE.addNote = `“${plain(ru)}” is already in your words.`;
      return render();
    }
    const listed = words.find((w) => keyOf(w.ru) === k);
    if (listed) {
      if (started(listed.id)) W_STATE.addNote = `“${plain(listed.ru)}” is already in your cards (${STATUS_LABEL[status(listed.id)].toLowerCase()}).`;
      else {
        P.pull[listed.id] = now();
        W_STATE.addNote = `“${plain(listed.ru)}” is on the list (${listed.lvl}): it now comes up next, with the dictionary meaning.`;
        save();
      }
      return render();
    }
    const id = "u:" + now().toString(36) + Math.random().toString(36).slice(2, 6);
    let ex = exRaw;
    if (ex && !ex.includes("*")) {
      // mark the word inside your example so it gets highlighted
      const stem = keyOf(ru).slice(0, Math.max(3, keyOf(ru).length - 2));
      ex = ex.replace(/[А-Яа-яЁё́]+/g, (m) => (keyOf(m).startsWith(stem) ? `*${m}*` : m));
    }
    P.own[id] = { ru, en, ex: ex || undefined, t: now() };
    W_STATE.addNote = `Added “${plain(ru)}”. It comes up first in your next session.`;
    save();
    render();
    const f = document.querySelector('[data-form="add"]');
    if (f) f.ru.focus();
  }

  // ---------- Events ----------
  function go(v) {
    if (v === "study") return startStudy();
    if (v === "test") return startQuiz();
    view = VIEWS.includes(v) ? v : "today";
    if (location.hash.slice(1) !== view) history.replaceState(null, "", "#" + view);
    render();
    window.scrollTo(0, 0);
  }
  const actions = {
    study: () => startStudy(),
    quiz: () => startQuiz(),
    "q-pick": (b) => quizPick(Number(b.dataset.i)),
    "q-next": () => quizNext(),
    "q-skip": () => quizType(""),
    "q-replay": () => {
      const q = Q && Q.qs[Q.i];
      if (q) speak(wordFor(q.id).ru);
    },
    "q-stop": () => {
      Q = null;
      go("today");
    },
    "q-study": () => {
      Q = null;
      startStudy();
    },
    more: () => {
      bump(todayLog(), "x");
      save();
      startStudy();
    },
    close: () => {
      S = null;
      go("today");
    },
    home: () => {
      S = null;
      go("today");
    },
    undo: () => undo(),
    learn: () => introduce(false),
    known: () => introduce(true),
    reveal: () => {
      S.revealed = true;
      render();
      if (S.dir === "en") autoSpeak();
    },
    grade: (b) => answer(Number(b.dataset.g)),
    speak: (b) => speak(b.dataset.text),
    edit: () => {
      S.editing = true;
      render();
      document.getElementById("edit-en")?.focus();
    },
    "edit-cancel": () => {
      S.editing = false;
      render();
    },
    hide: () => {
      S.confirmHide = true;
      render();
    },
    "hide-no": () => {
      S.confirmHide = false;
      render();
    },
    "hide-yes": () => {
      remember(S.kind);
      hideWord(S.id);
      toast("Hidden. Undo brings it back.");
      nextCard();
    },
    tomorrow: () => {
      clockOffset += DAY;
      writeLS(CONFIG.storageKey + ":clock", String(clockOffset));
      S = null;
      go("today");
      toast("It's tomorrow now (preview only).");
    },
    wipe: () => {
      if (CONFIG.preview) {
        P = emptyProgress();
        clockOffset = 0;
        writeLS(CONFIG.storageKey + ":clock", null);
        saveLocal();
        S = null;
        go("today");
        toast("Started over.");
        return;
      }
      W_STATE.confirmWipe = true;
      render();
    },
    "wipe-no": () => {
      W_STATE.confirmWipe = false;
      render();
    },
    "wipe-yes": () => {
      // keep the newest timestamp so the server copy is replaced, not merged back in
      P = emptyProgress();
      P.settings.t = now();
      W_STATE.confirmWipe = false;
      saveLocal();
      if (email) push();
      go("today");
      toast("All progress deleted.");
    },
    set: (b) => {
      P.settings[b.dataset.k] = JSON.parse(b.dataset.v);
      P.settings.t = now();
      save();
      render();
    },
    "sync-off": () => {
      email = "";
      writeLS(EMAIL_KEY, null);
      sync.state = "off";
      render();
    },
    export: () => {
      const blob = new Blob([JSON.stringify(P)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `russian-words-${dayKey(today())}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    },
    "toggle-row": (b) => {
      W_STATE.open = W_STATE.open === b.dataset.id ? null : b.dataset.id;
      W_STATE.editing = null;
      paintList();
    },
    "more-days": () => {
      W_STATE.days += 15;
      paintList();
    },
    pull: (b) => {
      P.pull[b.dataset.id] = now();
      save();
      paintList();
      toast("It comes up next time you study.");
    },
    "mark-known": (b) => {
      const day = today();
      const ivl = 10 + Math.floor(Math.random() * 16);
      P.cards[b.dataset.id] = { q: "R", s: initS(4), d: initD(4), i: ivl, l: day, due: day + ivl, n: 1, f: 0, k: 1, a: day, t: now() };
      bump(todayLog(), "k");
      save();
      paintList();
    },
    reset: (b) => {
      P.cards[b.dataset.id] = { q: "N", t: now() };
      save();
      paintList();
    },
    "hide-row": (b) => {
      hideWord(b.dataset.id);
      paintList();
    },
    unhide: (b) => {
      P.cards[b.dataset.id] = { q: "N", t: now() };
      save();
      paintList();
    },
    "delete-own": (b) => {
      const o = P.own[b.dataset.id];
      P.own[b.dataset.id] = { ...o, gone: 1, t: now() };
      save();
      paintList();
      toast(`Deleted “${plain(o.ru)}”.`);
    },
    "edit-row": (b) => {
      W_STATE.editing = b.dataset.id;
      paintList();
      document.getElementById("row-en")?.focus();
    },
  };
  function paintList() {
    const el = document.getElementById("word-list");
    if (el) el.innerHTML = renderWordList();
  }

  app.addEventListener("click", (e) => {
    const b = e.target.closest("[data-a]");
    if (!b || b.disabled) return;
    const fn = actions[b.dataset.a];
    if (fn) {
      e.preventDefault();
      fn(b, e);
    }
  });
  app.addEventListener("submit", (e) => {
    const f = e.target;
    e.preventDefault();
    if (f.dataset.form === "add") addOwnWord(f);
    if (f.dataset.form === "q-type") quizType(f.answer.value);
    if (f.dataset.form === "edit" || f.dataset.form === "edit-row") {
      const id = f.dataset.form === "edit" ? S.id : f.dataset.id;
      const en = f.en.value.trim();
      if (!en) return;
      if (P.own[id]) P.own[id] = { ...P.own[id], en, t: now() };
      else P.edits[id] = { en, t: now() };
      save();
      if (f.dataset.form === "edit") {
        S.editing = false;
        render();
      } else {
        W_STATE.editing = null;
        paintList();
      }
      toast("Meaning saved.");
    }
    if (f.dataset.form === "email") {
      const next = f.email.value.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) return toast("That doesn't look like an email address.");
      if (next !== email) {
        email = next;
        writeLS(EMAIL_KEY, email);
        sync.state = "waiting";
        render();
        pull();
      }
    }
  });
  app.addEventListener("input", (e) => {
    if (e.target.id === "word-search") {
      W_STATE.q = e.target.value;
      W_STATE.days = 15;
      paintList();
    }
  });
  app.addEventListener("change", (e) => {
    if (e.target.id === "word-filter" || e.target.id === "word-level") {
      W_STATE[e.target.id === "word-filter" ? "filter" : "level"] = e.target.value;
      W_STATE.days = 15;
      paintList();
    }
    if (e.target.id === "import-file" && e.target.files[0]) {
      e.target.files[0].text().then((text) => {
        try {
          P = merge(P, normalize(JSON.parse(text)));
          save();
          render();
          toast("Backup restored.");
        } catch {
          toast("That file isn't a backup from this app.");
        }
      });
    }
  });
  app.addEventListener("toggle", (e) => {
    if (e.target.matches(".add-sheet") && !e.target.open) W_STATE.addNote = "";
  }, true);

  document.addEventListener("keydown", (e) => {
    if (view === "test" && Q && !Q.done && !e.altKey && !e.metaKey && !e.ctrlKey) {
      if (e.target.closest && e.target.closest("input, textarea, select")) return;
      const q = Q.qs[Q.i];
      if (!Q.answered && q.options && ["1", "2", "3", "4"].includes(e.key)) quizPick(Number(e.key) - 1);
      else if (Q.answered && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        quizNext();
      }
      return;
    }
    if (view !== "study" || !S || e.altKey || e.metaKey) return;
    if (e.target.closest && e.target.closest("input, textarea, select")) return;
    const k = e.key.toLowerCase();
    if (k === "z" || k === "u") {
      e.preventDefault();
      return undo();
    }
    if (e.ctrlKey || !S.id) return;
    if (S.kind === "intro") {
      if (k === " " || k === "enter") {
        e.preventDefault();
        introduce(false);
      } else if (k === "k") introduce(true);
    } else if (!S.revealed) {
      if (k === " " || k === "enter") {
        e.preventDefault();
        actions.reveal();
      }
    } else if (["1", "2", "3", "4"].includes(k)) answer(Number(k));
    else if (k === " " || k === "enter") {
      e.preventDefault();
      answer(3);
    }
    if (k === "r") autoSpeak();
  });
  window.addEventListener("hashchange", () => {
    const v = location.hash.slice(1);
    if (v === "study") {
      if (!S) startStudy();
      return;
    }
    if (v === "test") {
      if (!Q) startQuiz();
      return;
    }
    if (v !== view) {
      S = null;
      Q = null;
      go(v);
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && pushTimer) push(true);
    if (document.visibilityState === "visible" && email && Date.now() - lastPull > 60 * 1000) pull();
  });
  window.addEventListener("pagehide", () => {
    if (pushTimer) push(true);
  });

  // ---------- Start ----------
  async function boot() {
    try {
      const list = Array.isArray(window.SLOVO_WORDS) ? window.SLOVO_WORDS : await (await fetch(CONFIG.wordsUrl)).json();
      setWords(list);
    } catch {
      app.innerHTML = '<p class="loading">Couldn\'t load the word list. Check your connection and reload the page.</p>';
      return;
    }
    if ("speechSynthesis" in window) {
      pickVoice();
      speechSynthesis.onvoiceschanged = pickVoice;
    }
    const v = location.hash.slice(1);
    if (v === "study") startStudy();
    else go(v || "today");
    pull();
  }
  boot();
  // For tests and the browser console.
  window.slovo = { get progress() { return P; }, get session() { return S; }, get quiz() { return Q; }, schedule, words: () => words, setClock: (ms) => (clockOffset = ms), dayOf };
})();
