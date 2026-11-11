// Text logic: tokenizing, stemming, the word index, and keyword checks.
// No DOM here, so Node tests can load it.
(function (root) {
  const STOPWORDS = typeof module !== 'undefined' && module.exports
    ? require('./stopwords.js').STOPWORDS
    : root.STOPWORDS;

  const MIN_WORD = 3;  // ignore 1-2 letter words entirely
  const MIN_STEM = 3;

  // Suffixes tried longest first; the first one that leaves a long-enough stem wins.
  const SUFFIXES = ['fulness', 'fully', 'ness', 'ance', 'ence', 'ions', 'ion', 'ings', 'ing', 'edst',
    'eth', 'est', 'ful', 'ed', 'ly', 'es', 's'];
  // Words that end in a suffix but aren't a suffixed form.
  const KEEP = new Set(['priest', 'beast', 'feast', 'east', 'west', 'rest', 'forest', 'harvest',
    'manifest', 'tempest', 'conquest', 'request', 'interest', 'honest', 'earnest', 'modest',
    'chest', 'guest', 'breast', 'midst', 'jesus', 'moses', 'israel', 'king', 'thing', 'holy',
    'only', 'lily', 'early', 'ring', 'spring', 'string', 'sing', 'wing', 'bring', 'evening',
    'morning', 'nothing', 'family', 'heed', 'need', 'seed', 'deed', 'creed', 'flesh', 'glass',
    'grass', 'bless', 'less', 'mess', 'press', 'kiss', 'loss', 'cross', 'dross', 'chaos',
    'news', 'blood', 'ness', 'witness', 'wilderness', 'business']);
  const UNDOUBLE_AFTER = new Set(['ed', 'ing', 'ings', 'eth', 'est', 'edst']);

  function stem(word) {
    let w = word.toLowerCase();
    let stripped = '';
    if (w.length > MIN_STEM && !KEEP.has(w)) {
      for (const suf of SUFFIXES) {
        if (!w.endsWith(suf)) continue;
        const base = w.slice(0, -suf.length);
        const min = suf === 'est' || suf.startsWith('ion') ? 4 : MIN_STEM;
        if (base.length < min) continue;
        // Don't strip the s from -ss, -us, -is (glass, jesus, this)
        if (suf === 's' && /(ss|us|is)$/.test(w)) continue;
        w = base;
        stripped = suf;
        break;
      }
    }
    // sinned -> sinn -> sin ; but keep bless, call, staff
    if (UNDOUBLE_AFTER.has(stripped) && /([^lsfz])\1$/.test(w)) w = w.slice(0, -1);
    if (w.length > MIN_STEM && w.endsWith('e')) w = w.slice(0, -1);     // love/loved/loveth -> lov
    if (w.length >= MIN_STEM && w.endsWith('y')) w = w.slice(0, -1) + 'i'; // mercy/mercies -> merci
    return w;
  }

  const WORD_RE = /[A-Za-z]+(?:['’][A-Za-z]+)*/g;

  // Returns [{word, form, stem, start, end, stop}] for every word in the text.
  // `form` is the lowercased word with possessive 's and apostrophes removed.
  function tokenize(text) {
    const out = [];
    let m;
    WORD_RE.lastIndex = 0;
    while ((m = WORD_RE.exec(text))) {
      const form = m[0].toLowerCase().replace(/['’]s$/, '').replace(/['’]/g, '');
      const stop = form.length < MIN_WORD || STOPWORDS.has(form);
      out.push({ word: m[0], form, stem: stop ? null : stem(form), start: m.index, end: m.index + m[0].length, stop });
    }
    return out;
  }

  // Unique linkable stems in a text, with the form(s) used for each.
  function stemForms(text) {
    const map = new Map();
    for (const t of tokenize(text)) {
      if (t.stop) continue;
      if (!map.has(t.stem)) map.set(t.stem, []);
      const forms = map.get(t.stem);
      if (!forms.includes(t.form)) forms.push(t.form);
    }
    return map;
  }

  // verses: [[title, shortTitle, volumeIndex, text], ...]
  function buildIndex(data) {
    const verses = data.verses;
    const postings = new Map();   // stem -> [verseId, ...] ascending
    const formCounts = new Map(); // form -> count of verses containing it
    const stemsByVerse = new Array(verses.length);
    const formsByStem = new Map(); // stem -> Set(form)
    for (let id = 0; id < verses.length; id++) {
      const sf = stemForms(verses[id][3]);
      stemsByVerse[id] = [...sf.keys()];
      for (const [s, forms] of sf) {
        let p = postings.get(s);
        if (!p) postings.set(s, (p = []));
        p.push(id);
        let fs = formsByStem.get(s);
        if (!fs) formsByStem.set(s, (fs = new Set()));
        for (const f of forms) {
          fs.add(f);
          formCounts.set(f, (formCounts.get(f) || 0) + 1);
        }
      }
    }
    const byTitle = new Map();
    const normTitles = verses.map((v, id) => {
      const pair = [normRef(v[0]), normRef(v[1])];
      byTitle.set(pair[0], id);
      byTitle.set(pair[1], id);
      return pair;
    });
    return { verses, volumes: data.volumes, postings, stemsByVerse, formsByStem, formCounts, byTitle, normTitles };
  }

  // "1 Ne. 3:7" -> "1 ne 3:7"
  function normRef(s) {
    return s.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').replace(/\s*:\s*/, ':').trim();
  }

  function findVerse(index, ref) {
    const id = index.byTitle.get(normRef(ref));
    return id === undefined ? -1 : id;
  }

  // Up to `limit` references starting with what the user typed.
  function suggestRefs(index, typed, limit = 8) {
    const q = normRef(typed);
    if (!q) return [];
    const out = [];
    for (let id = 0; id < index.verses.length && out.length < limit; id++) {
      const [full, short] = index.normTitles[id];
      if (full.startsWith(q) || short.startsWith(q)) out.push(id);
    }
    return out;
  }

  function editDistance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let rowMin = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        rowMin = Math.min(rowMin, cur[j]);
      }
      if (rowMin > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  // Close spellings from the scripture vocabulary, most common first.
  function suggestWords(index, word, limit = 3) {
    const w = word.toLowerCase();
    const max = w.length <= 5 ? 1 : 2;
    const hits = [];
    for (const [form, count] of index.formCounts) {
      if (STOPWORDS.has(form) || form === w) continue;
      const d = editDistance(w, form, max);
      if (d <= max) hits.push({ form, d, count });
    }
    hits.sort((a, b) => a.d - b.d || b.count - a.count);
    return hits.slice(0, limit).map(h => h.form);
  }

  // Count verses per volume for a stem.
  function countByVolume(index, s) {
    const counts = new Array(index.volumes.length).fill(0);
    for (const id of index.postings.get(s) || []) counts[index.verses[id][2]]++;
    return counts;
  }

  // Check a word the user wants to add.
  // status: 'stopword' | 'notfound' | 'novolumes' | 'ok'
  function checkKeyword(index, word, selectedVolumes) {
    const form = word.toLowerCase().trim().replace(/['’]/g, '');
    if (!/^[a-z]+$/.test(form)) return { word: form, status: 'notfound', suggestions: [] };
    if (form.length < MIN_WORD || STOPWORDS.has(form)) return { word: form, status: 'stopword' };
    const s = stem(form);
    const byVolume = countByVolume(index, s);
    const total = byVolume.reduce((a, b) => a + b, 0);
    if (total === 0) return { word: form, stem: s, status: 'notfound', suggestions: suggestWords(index, form) };
    const inSelected = byVolume.reduce((a, c, i) => a + (selectedVolumes.has(i) ? c : 0), 0);
    return { word: form, stem: s, status: inSelected ? 'ok' : 'novolumes', total, inSelected, byVolume };
  }

  // ---------- starting-verse search ----------

  const ORDINALS = { first: '1', '1st': '1', second: '2', '2nd': '2', third: '3', '3rd': '3', fourth: '4', '4th': '4' };
  const bookKey = s => s.toLowerCase().replace(/\b(first|1st|second|2nd|third|3rd|fourth|4th)\b/g, m => ORDINALS[m])
    .replace(/[^a-z0-9&]/g, '');

  // Books, chapters and verse ids, built once on first search.
  function bookTable(index) {
    if (index.books) return index.books;
    const books = [];
    const byKey = new Map();
    let cur = null;
    index.verses.forEach((v, id) => {
      const full = v[0].match(/^(.*) (\d+):(\d+)$/);
      const short = v[1].match(/^(.*) (\d+):(\d+)$/);
      if (!full) return;
      if (!cur || cur.name !== full[1]) {
        cur = { name: full[1], short: short ? short[1] : full[1], keys: [], chapters: new Map() };
        cur.keys = [...new Set([bookKey(cur.name), bookKey(cur.short)])];
        books.push(cur);
        cur.keys.forEach(k => { if (!byKey.has(k)) byKey.set(k, cur); });
      }
      const ch = Number(full[2]);
      if (!cur.chapters.has(ch)) cur.chapters.set(ch, []);
      cur.chapters.get(ch)[Number(full[3]) - 1] = id;
    });
    index.books = { list: books, byKey };
    return index.books;
  }

  // Exact book names always match. A partial name ("moro") only matches when
  // allowPrefix is set, so a word like "son" isn't mistaken for Song of Solomon.
  function matchBook(index, text, allowPrefix = false) {
    const key = bookKey(text);
    if (key.length < 2) return null;
    const { list, byKey } = bookTable(index);
    if (byKey.has(key)) return byKey.get(key);
    if (!allowPrefix || key.length < 3) return null;
    return list.find(b => b.keys.some(k => k.startsWith(key))) || null;
  }

  // "1 Nephi 3:7", "alma 32 21", "first nephi 3", "D&C 4" -> { book, chapter, verse }
  const REF_RE = /^((?:[1-4]|first|1st|second|2nd|third|3rd|fourth|4th)?\s*[a-z&][a-z&\s—-]*?)\s*(?:(\d+)(?:\s*[:\s]\s*(\d+))?)?$/;
  function parseRef(index, query) {
    const q = query.toLowerCase().replace(/\./g, ' ').replace(/\s+/g, ' ').trim();
    const m = q.match(REF_RE);
    if (!m) return null;
    const book = matchBook(index, m[1], Boolean(m[2]));
    if (!book) return null;
    return { book, chapter: m[2] ? Number(m[2]) : null, verse: m[3] ? Number(m[3]) : null };
  }

  const plain = s => ' ' + s.toLowerCase().replace(/['’]/g, '').replace(/[^a-z]+/g, ' ').trim() + ' ';

  /**
   * Find a starting verse from a reference or from words in the verse.
   * Returns { results: [{id, kind: 'ref'|'text', phrase}], total, stems, unknown, note }
   */
  function search(index, query, opts = {}) {
    const limit = opts.limit ?? 10;
    const volumes = opts.volumes;
    const out = { results: [], total: 0, stems: [], unknown: [], note: '' };
    if (!query.trim()) return out;
    const seen = new Set();
    const push = (id, kind, phrase = false) => {
      if (seen.has(id)) return;
      seen.add(id);
      out.results.push({ id, kind, phrase });
    };

    // 1. References
    const ref = parseRef(index, query);
    if (ref && ref.chapter !== null) {
      const ch = ref.book.chapters.get(ref.chapter);
      if (!ch) {
        out.note = `${ref.book.name} has ${ref.book.chapters.size} chapter${ref.book.chapters.size > 1 ? 's' : ''}.`;
        return out;
      }
      if (ref.verse !== null) {
        if (ch[ref.verse - 1] !== undefined) push(ch[ref.verse - 1], 'ref');
        else out.note = `${ref.book.name} ${ref.chapter} has ${ch.length} verses.`;
        // Show the rest of the chapter after the exact verse, for context.
        ch.forEach(id => push(id, 'ref'));
      } else ch.forEach(id => push(id, 'ref'));
      out.total = out.results.length;
      out.results = out.results.slice(0, limit);
      return out;
    }
    if (ref) push(ref.book.chapters.get(Math.min(...ref.book.chapters.keys()))[0], 'ref');

    // 2. Words and phrases
    const toks = tokenize(query);
    const stems = [...new Set(toks.filter(t => !t.stop).map(t => t.stem))];
    const known = stems.filter(s => index.postings.has(s));
    out.stems = known;
    for (const t of toks) {
      if (!t.stop && !index.postings.has(t.stem) && !(ref && bookKey(t.form).length && matchBook(index, t.form) === ref.book)) {
        out.unknown.push({ word: t.form, suggestions: suggestWords(index, t.form) });
      }
    }
    const inVol = id => !volumes || volumes.has(index.verses[id][2]);
    const phrase = toks.length >= 2 ? plain(query) : null;
    if (phrase && !index.plainTexts) index.plainTexts = index.verses.map(v => plain(v[3]));

    const N = index.verses.length;
    const idf = s => Math.log(N / index.postings.get(s).length);
    const totalIdf = known.reduce((a, s) => a + idf(s), 0);
    const scores = new Map();
    for (const s of known) {
      for (const id of index.postings.get(s)) {
        if (inVol(id)) scores.set(id, (scores.get(id) || 0) + idf(s) / totalIdf);
      }
    }
    // An exact phrase can be all common words ("it came to pass"), so scan for it directly.
    const phraseHits = new Set();
    if (phrase) {
      index.plainTexts.forEach((t, id) => { if (inVol(id) && t.includes(phrase)) phraseHits.add(id); });
      phraseHits.forEach(id => scores.set(id, (scores.get(id) || 0) + 10));
    }
    const ranked = [...scores].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    ranked.forEach(([id]) => push(id, 'text', phraseHits.has(id)));

    out.total = out.results.length;
    out.results = out.results.slice(0, limit);
    if (!out.total && !out.unknown.length) out.note = 'No verses match in the selected volumes.';
    return out;
  }

  const api = { STOPWORDS, stem, tokenize, stemForms, buildIndex, normRef, findVerse, suggestRefs,
    suggestWords, editDistance, countByVolume, checkKeyword, parseRef, search };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VerseText = api;
})(typeof window !== 'undefined' ? window : globalThis);
