// Conference talk quotes: an index of talk paragraphs and a ranking of the ones
// related to a verse. No DOM here, so Node tests can use it too.
(function (root) {
  const T = typeof module !== 'undefined' && module.exports ? require('./text.js') : root.VerseText;

  const MIN_WORDS = 6;          // shorter paragraphs ("Welcome to conference!") aren't quotes
  const WORDS_MIN_SHARED = 2;   // a words-only match needs at least this many shared keywords…
  const WORDS_MIN_WEIGHT = 6;   // …and this much rarity (sum of IDF weights)
  const SAME_TALK_PENALTY = 0.75; // each further quote from one talk counts this much less

  const chapterOf = title => title.replace(/:\d+$/, '');

  // conferences: the window.TALK_DATA array, one entry per conference file.
  function buildTalkIndex(index, conferences) {
    const confs = [...(conferences || [])].sort((a, b) => b.conference.id.localeCompare(a.conference.id));
    const paras = [];
    const byVerse = new Map();    // verseId -> [paraIdx]
    const byChapter = new Map();  // "Alma 32" -> [paraIdx]
    const postings = new Map();   // stem -> [paraIdx]
    const push = (map, key, i) => { let a = map.get(key); if (!a) map.set(key, (a = [])); if (a[a.length - 1] !== i) a.push(i); };
    let unmatched = 0;
    confs.forEach((c, ci) => c.talks.forEach((talk, ti) => talk.paragraphs.forEach((p, pi) => {
      if (p.heading) return;
      const words = p.text.split(/\s+/).length;
      if (words < MIN_WORDS) return;
      const i = paras.length;
      const stems = new Set(T.tokenize(p.text).map(t => t.stem).filter(Boolean));
      const cites = [];
      for (const title of p.cites || []) {
        const id = index.byTitle.get(T.normRef(title));
        if (id === undefined) { unmatched++; continue; }
        cites.push(id);
        push(byVerse, id, i);
        push(byChapter, chapterOf(title), i);
      }
      for (const ch of p.chapters || []) push(byChapter, ch, i);
      for (const s of stems) push(postings, s, i);
      paras.push({ conf: ci, talk: ti, para: pi, stems, cites, citeCount: (p.cites || []).length });
    })));
    return { conferences: confs, paras, byVerse, byChapter, postings, unmatched };
  }

  function paragraphOf(tIndex, q) {
    const c = tIndex.conferences[q.conf];
    const talk = c.talks[q.talk];
    return { conference: c.conference, talk, paragraph: talk.paragraphs[q.para] };
  }

  // Link straight to the paragraph on the original site.
  function quoteLink(talk, paragraph) {
    return paragraph && paragraph.id ? `${talk.url}&id=${paragraph.id}#${paragraph.id}` : talk.url;
  }

  // Quotes related to a verse, best first.
  //   keywords: stems a quote must all contain (the words picked in the panel).
  //   minShared / minWeight: how close a words-only match must be (tuned for thousands of paragraphs).
  // Each result: { idx, score, reason: 'cites' | 'chapter' | 'words', shared: [stems] }
  function findQuotes(tIndex, index, verseId,
    { keywords = [], minShared = WORDS_MIN_SHARED, minWeight = WORDS_MIN_WEIGHT } = {}) {
    if (!tIndex || !tIndex.paras.length) return [];
    const N = tIndex.paras.length;
    const idf = s => Math.log((N + 1) / ((tIndex.postings.get(s) || []).length + 1));
    const verseStems = index.stemsByVerse[verseId] || [];
    const required = [...new Set(keywords)];
    const cand = new Set();
    for (const i of tIndex.byVerse.get(verseId) || []) cand.add(i);
    for (const i of tIndex.byChapter.get(chapterOf(index.verses[verseId][0])) || []) cand.add(i);
    for (const s of verseStems) for (const i of tIndex.postings.get(s) || []) cand.add(i);
    for (const s of required) for (const i of tIndex.postings.get(s) || []) cand.add(i);

    const out = [];
    for (const i of cand) {
      const p = tIndex.paras[i];
      if (!required.every(s => p.stems.has(s))) continue;
      const cites = p.cites.includes(verseId);
      const chapter = !cites && tIndex.byChapter.get(chapterOf(index.verses[verseId][0]))?.includes(i);
      const shared = verseStems.filter(s => p.stems.has(s));
      const weight = shared.reduce((w, s) => w + idf(s), 0);
      const related = cites || chapter || required.length > 0 ||
        (shared.length >= minShared && weight >= minWeight);
      if (!related) continue;
      let score = weight;
      // A footnote that cites only this verse says more than one citing a whole chapter.
      if (cites) score += 100 + 50 / Math.max(1, p.citeCount);
      else if (chapter) score += 30;
      out.push({ idx: i, score, reason: cites ? 'cites' : chapter ? 'chapter' : 'words', shared });
    }
    // Spread quotes across talks: the nth quote from one talk counts 0.75^(n-1) as much.
    out.sort((a, b) => b.score - a.score || a.idx - b.idx);
    const seen = new Map();
    for (const q of out) {
      const p = tIndex.paras[q.idx];
      const key = p.conf + '/' + p.talk;
      const n = seen.get(key) || 0;
      seen.set(key, n + 1);
      q.rank = q.score * Math.pow(SAME_TALK_PENALTY, n);
    }
    out.sort((a, b) => b.rank - a.rank || a.idx - b.idx);
    for (const q of out) Object.assign(q, tIndex.paras[q.idx]);
    return out;
  }

  const api = { buildTalkIndex, findQuotes, paragraphOf, quoteLink, MIN_WORDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VerseTalks = api;
})(typeof window !== 'undefined' ? window : globalThis);
