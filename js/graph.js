// Graph builder: picks the verses for the web and the lines between them.
// No DOM here, so Node tests can load it.
(function (root) {
  const T = typeof module !== 'undefined' && module.exports ? require('./text.js') : root.VerseText;

  const PER_STEM_CAP = 500;   // most candidate verses taken per keyword
  const USER_BONUS = 100;     // makes sure each found user word gets a branch
  const DEFAULT_WORD_LIMIT = 3;

  function intersect(a, b) {
    const out = [];
    for (const x of a) if (b.has(x)) out.push(x);
    return out;
  }

  // Evenly spaced sample so a common word doesn't only pull from Genesis.
  function sample(list, cap) {
    if (list.length <= cap) return list;
    const out = [];
    const step = list.length / cap;
    for (let i = 0; i < cap; i++) out.push(list[Math.floor(i * step)]);
    return out;
  }

  /**
   * @param index      from VerseText.buildIndex
   * @param centerId   verse id in the middle
   * @param opts.userWords      words the user added
   * @param opts.disabledStems  Set of stems the user switched off
   * @param opts.volumes        Set of volume indexes to search
   * @param opts.maxBranches    how many verses around the center
   * @param opts.wordLimit      most lines any one word may appear on (0 = no limit)
   */
  function buildWeb(index, centerId, opts = {}) {
    const volumes = opts.volumes || new Set(index.volumes.map((_, i) => i));
    const disabled = opts.disabledStems || new Set();
    const maxBranches = opts.maxBranches ?? 12;
    const wordLimit = opts.wordLimit ?? DEFAULT_WORD_LIMIT;
    const N = index.verses.length;

    const df = s => (index.postings.get(s) || []).length;
    const weight = s => Math.max(0.1, Math.log(N / Math.max(1, df(s))));
    const inSelected = s => (index.postings.get(s) || []).filter(id => volumes.has(index.verses[id][2])).length;

    // 1. Keywords
    const centerStemsAll = index.stemsByVerse[centerId];
    const centerSet = new Set(centerStemsAll);
    const userChecks = (opts.userWords || []).map(w => T.checkKeyword(index, w, volumes));
    const userStems = new Set(userChecks.filter(c => c.status === 'ok' && !disabled.has(c.stem)).map(c => c.stem));
    const keywordSet = new Set(centerStemsAll.filter(s => !disabled.has(s)));
    for (const s of userStems) keywordSet.add(s);

    // 2. Candidates and the keywords each one has
    const ks = new Map(); // id -> stems ∩ keywordSet
    for (const s of keywordSet) {
      const ids = (index.postings.get(s) || []).filter(id => id !== centerId && volumes.has(index.verses[id][2]));
      for (const id of sample(ids, PER_STEM_CAP)) {
        if (!ks.has(id)) ks.set(id, intersect(index.stemsByVerse[id], keywordSet));
      }
    }
    ks.set(centerId, intersect(centerStemsAll, keywordSet));
    const pool = new Set([...ks.keys()].filter(id => id !== centerId));
    const candidateCount = pool.size;

    // 3. Search for a ring where EVERY verse has a line to the center and a line to
    //    each verse beside it, with every word staying within its limit.
    //    Depth-first search with a time budget: grow the ring one verse at a time,
    //    try the most promising few verses at each step, back up on dead ends, and
    //    keep the longest ring that closes. Afterwards, words with uses left add
    //      c) lines between other verses that share a word,
    //      d) extra shared words on existing labels.
    const usage = new Map();
    const left = s => (wordLimit ? wordLimit - (usage.get(s) || 0) : Infinity);
    const use = s => usage.set(s, (usage.get(s) || 0) + 1);
    const unuse = s => usage.set(s, usage.get(s) - 1);
    const edges0 = [];
    const key = (a, b) => `${Math.min(a, b)}-${Math.max(a, b)}`;
    const edgeByPair = new Map();
    const addEdge = (a, b, s, ring = false) => {
      use(s);
      const e = { a, b, stems: [s], toCenter: a === centerId || b === centerId, ring };
      if (e.toCenter && e.a !== centerId) { e.a = centerId; e.b = a; }
      edges0.push(e);
      edgeByPair.set(key(a, b), e);
    };

    const centerKs = new Set(ks.get(centerId));
    // Only verses that share a word with the center can have a center line.
    for (const id of pool) if (!ks.get(id).some(s => centerKs.has(s))) pool.delete(id);
    const byStem = new Map(); // stem -> candidates containing it
    for (const id of pool) for (const s of ks.get(id)) {
      if (!byStem.has(s)) byStem.set(s, []);
      byStem.get(s).push(id);
    }

    // Most verses possible: each needs a center line (a center word) and a ring line.
    const capOf = stems => (wordLimit ? stems.length * wordLimit : Infinity);
    const centerCap = capOf([...centerKs]);
    const otherCap = capOf([...keywordSet].filter(s => !centerKs.has(s)));
    const ringBound = n => (n >= 3 ? 2 * n : n === 2 ? 3 : 1); // lines a ring of n needs
    let bound = Math.min(maxBranches, pool.size);
    while (bound > 0 && (bound > centerCap || ringBound(bound) > centerCap + otherCap)) bound--;

    // Pick a word for a line: shared, uses left, the one with the most uses left, then rarest.
    const pick = (stems, avoid) => {
      let best = null;
      for (const s of stems) {
        if (s === avoid || left(s) <= 0) continue;
        if (!best || left(s) > left(best) || (left(s) === left(best) && weight(s) > weight(best))) best = s;
      }
      return best;
    };
    const shared = (x, y) => {
      const theirs = new Set(ks.get(y));
      return ks.get(x).filter(s => theirs.has(s));
    };
    const spokeStems = id => ks.get(id).filter(s => centerKs.has(s));

    // Try to give `c` a ring line to `prev` and a center line. Returns the words used, or null.
    const assign = (c, prev) => {
      const ringOpts = prev === null ? [null] : shared(c, prev).filter(s => left(s) > 0)
        .sort((x, y) => left(y) - left(x) || weight(y) - weight(x));
      for (const r of ringOpts) {
        if (r) use(r);
        const sp = pick(spokeStems(c));
        if (sp) { use(sp); return { ring: r, spoke: sp }; }
        if (r) unuse(r);
      }
      return null;
    };
    const release = a => { if (a.ring) unuse(a.ring); unuse(a.spoke); };

    const seenCount = new Map();
    const coverage = id => {
      let b = 0;
      for (const s of ks.get(id)) {
        if (seenCount.get(s) || left(s) <= 0) continue;
        b += userStems.has(s) && !centerSet.has(s) ? USER_BONUS : weight(s) * 2;
      }
      return b;
    };
    const openness = id => ks.get(id).reduce((t, s) => t + (left(s) > 0 ? 1 : 0), 0);

    const deadline = Date.now() + (opts.timeBudgetMs ?? 3000);
    const BEAM = 6;
    const chain = [];
    const words = []; // per verse: { ring, spoke }
    const inChain = new Set();
    let best = { chain: [], words: [], closing: null };
    let timedOut = false;

    const record = closing => {
      if (chain.length > best.chain.length) best = { chain: chain.slice(), words: words.map(w => ({ ...w })), closing };
    };

    const step = () => {
      const n = chain.length;
      // Can the ring close here? (2 verses just need the one line between them)
      if (n === 1 || n === 2) record(null);
      if (n >= 3) {
        const cs = pick(shared(chain[n - 1], chain[0]));
        if (cs) record(cs);
      }
      if (n >= bound && best.chain.length >= bound) return true;
      if (n >= bound) return false;
      if (Date.now() > deadline) { timedOut = true; return true; }

      // Candidates: verses sharing a word (with uses left) with the end of the ring.
      const prev = n ? chain[n - 1] : null;
      const cands = new Set();
      if (prev === null) pool.forEach(c => cands.add(c));
      else for (const s of ks.get(prev)) if (left(s) > 0) for (const c of byStem.get(s) || []) if (!inChain.has(c)) cands.add(c);
      const scored = [];
      for (const c of cands) {
        if (inChain.has(c)) continue;
        const a = assign(c, prev);
        if (!a) continue;
        let sc = (a.ring ? weight(a.ring) : 0) + weight(a.spoke) + coverage(c) + openness(c) * 0.5;
        if (n + 1 === bound && n >= 2 && !pick(shared(c, chain[0]))) sc -= 1000; // can't close the ring
        else if (n >= 1 && shared(c, chain[0]).length) sc += 0.5;
        release(a);
        scored.push({ c, sc });
      }
      scored.sort((x, y) => y.sc - x.sc || x.c - y.c);
      for (const { c } of scored.slice(0, BEAM)) {
        const a = assign(c, prev);
        if (!a) continue;
        chain.push(c); words.push(a); inChain.add(c);
        ks.get(c).forEach(s => seenCount.set(s, (seenCount.get(s) || 0) + 1));
        const done = step();
        ks.get(c).forEach(s => seenCount.set(s, seenCount.get(s) - 1));
        chain.pop(); words.pop(); inChain.delete(c);
        release(a);
        if (done) return true;
      }
      return false;
    };
    if (bound > 0) step();

    // Lay down the best ring found: center lines, ring lines, and the closing line.
    const ringChain = best.chain;
    best.words.forEach((w, i) => {
      addEdge(centerId, ringChain[i], w.spoke);
      if (w.ring) addEdge(ringChain[i - 1], ringChain[i], w.ring, true);
    });
    const closed = Boolean(best.closing);
    if (closed) addEdge(ringChain[ringChain.length - 1], ringChain[0], best.closing, true);
    const chain0 = ringChain;

    // c) lines between other pairs, strongest shared word first
    const pairs = [];
    for (let i = 0; i < chain0.length; i++) {
      for (let j = i + 1; j < chain0.length; j++) {
        const a = chain0[i], b = chain0[j];
        const theirs = new Set(ks.get(b));
        const shared = ks.get(a).filter(s => theirs.has(s)).sort((x, y) => weight(y) - weight(x));
        if (shared.length) pairs.push({ a, b, shared });
      }
    }
    pairs.sort((p, q) => weight(q.shared[0]) - weight(p.shared[0]));
    for (const p of pairs) {
      if (edgeByPair.has(key(p.a, p.b))) continue;
      const s = p.shared.find(x => left(x) > 0);
      if (s) addEdge(p.a, p.b, s);
    }
    // d) remaining shared words on existing labels
    for (const e of edges0) {
      const theirs = new Set(ks.get(e.b));
      for (const s of ks.get(e.a)) if (theirs.has(s) && !e.stems.includes(s) && left(s) > 0) { use(s); e.stems.push(s); }
      e.stems.sort((x, y) => weight(y) - weight(x));
    }
    const web = { chosen: chain0, edges: edges0, usage };

    // 4. Labels: the word forms each verse uses, e.g. faith/faithful
    const formsCache = new Map();
    const formsOf = id => {
      if (!formsCache.has(id)) formsCache.set(id, T.stemForms(index.verses[id][3]));
      return formsCache.get(id);
    };
    const nodes = [centerId, ...web.chosen];
    const highlight = new Map(nodes.map(id => [id, new Set()]));
    const edges = web.edges.map(e => {
      const label = e.stems.map(s => {
        const forms = [...(formsOf(e.a).get(s) || [])];
        for (const f of formsOf(e.b).get(s) || []) if (!forms.includes(f)) forms.push(f);
        return forms.join('/');
      }).join(' · ');
      e.stems.forEach(s => { highlight.get(e.a).add(s); highlight.get(e.b).add(s); });
      return { ...e, label };
    });

    // 5. Ring order is the chain order. If the ends don't share a word, the ring is
    //    left open (drawn with a gap) so no side-by-side verses are unlinked.
    const ring = chain0.slice();

    // 6. Keyword report for the chips
    const shownStems = new Set();
    web.chosen.forEach(id => ks.get(id).forEach(s => shownStems.add(s)));
    const uses = s => web.usage.get(s) || 0;
    const centerForms = formsOf(centerId);
    const auto = centerStemsAll.map(s => ({
      stem: s, label: centerForms.get(s).join('/'), count: inSelected(s) - (centerSet.has(s) ? 1 : 0),
      enabled: !disabled.has(s), shown: shownStems.has(s), uses: uses(s), atLimit: wordLimit > 0 && uses(s) >= wordLimit,
    }));
    const user = userChecks.map(c => ({
      ...c, enabled: !c.stem || !disabled.has(c.stem), shown: c.status === 'ok' && shownStems.has(c.stem),
      uses: c.stem ? uses(c.stem) : 0, atLimit: Boolean(c.stem) && wordLimit > 0 && uses(c.stem) >= wordLimit,
      matchedForms: c.stem && index.formsByStem.get(c.stem) ? [...index.formsByStem.get(c.stem)].slice(0, 6) : [],
    }));

    let message = '';
    if (!keywordSet.size) message = 'This verse has no keywords to link on. Add a keyword, or pick another verse.';
    else if (!web.chosen.length) message = 'No verses share these keywords in the selected volumes.';
    else if (web.chosen.length < maxBranches) {
      const n = web.chosen.length;
      const k = centerKs.size;
      if (bound < maxBranches && wordLimit && n === bound) {
        message = `Only ${n} verse${n > 1 ? 's' : ''} fit. Each verse needs a line to the center and a line to each neighbour, ` +
          `and ${k} keyword${k > 1 ? 's' : ''} with a limit of ${wordLimit} line${wordLimit > 1 ? 's' : ''} each ` +
          `allow${k > 1 ? '' : 's'} at most ${n}. Raise the word limit or add keywords.`;
      } else {
        message = `Only ${n} verse${n > 1 ? 's' : ''} fit: no larger ring was found where every verse links to the center and both neighbours` +
          (timedOut ? ' in the time allowed.' : '.') +
          (wordLimit ? ' Raise the word limit or add keywords.' : ' Add keywords or include more volumes.');
      }
    }

    return {
      centerId,
      nodes: nodes.map(id => ({ id, isCenter: id === centerId, highlightStems: [...highlight.get(id)] })),
      edges, ring, closed, keywords: { auto, user }, candidateCount, wordLimit, message, timedOut,
    };
  }

  // Number of side-by-side ring neighbours with no line between them.
  // An open ring has a gap between its ends, so they aren't neighbours.
  function unlinkedNeighbours(ring, edges, closed = true) {
    if (ring.length < 2) return 0;
    const linked = new Set(edges.map(e => `${Math.min(e.a, e.b)}-${Math.max(e.a, e.b)}`));
    const pairs = ring.length - (closed && ring.length > 2 ? 0 : 1);
    let n = 0;
    for (let i = 0; i < pairs; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      if (!linked.has(`${Math.min(a, b)}-${Math.max(a, b)}`)) n++;
    }
    return n;
  }

  const api = { buildWeb, unlinkedNeighbours, DEFAULT_WORD_LIMIT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VerseGraph = api;
})(typeof window !== 'undefined' ? window : globalThis);
