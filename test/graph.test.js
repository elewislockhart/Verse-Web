const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../js/text.js');
const G = require('../js/graph.js');

// Made-up verses. Volume 0 = "A", volume 1 = "B".
const FIXTURE = {
  volumes: ['A', 'B'],
  verses: [
    ['Center 1:1', 'C 1:1', 0, 'Faith and hope lead to repentance.'],          // 0
    ['One 1:1', 'O 1:1', 0, 'Be faithful and repent.'],                       // 1
    ['Two 1:1', 'T 1:1', 0, 'Hope is an anchor; repent today.'],              // 2
    ['Three 1:1', 'Th 1:1', 1, 'Faith without works is dead.'],               // 3
    ['Four 1:1', 'F 1:1', 1, 'Charity never faileth; hope endureth.'],        // 4
    ['Five 1:1', 'Fi 1:1', 0, 'Charity is the pure love of Christ.'],         // 5
    ['Six 1:1', 'S 1:1', 0, 'The mountains skipped like rams.'],              // 6
    ['Seven 1:1', 'Se 1:1', 1, 'Christ is the anchor of charity.'],           // 7
    ['Eight 1:1', 'E 1:1', 0, 'Faith and charity abide.'],                   // 8
  ],
};
const I = T.buildIndex(FIXTURE);
const both = new Set([0, 1]);
const pairKey = (a, b) => `${Math.min(a, b)}-${Math.max(a, b)}`;
const usesPerStem = W => {
  const n = {};
  W.edges.forEach(e => e.stems.forEach(s => { n[s] = (n[s] || 0) + 1; }));
  return n;
};

test('every branch links to the center or another branch', () => {
  const W = G.buildWeb(I, 0, { volumes: both, maxBranches: 10, userWords: ['charity'] });
  const linked = new Set(W.edges.flatMap(e => [e.a, e.b]));
  for (const n of W.nodes) if (!n.isCenter) assert.ok(linked.has(n.id), `verse ${n.id} has no line`);
  assert.ok(!W.nodes.some(n => n.id === 6), 'unrelated verse should not appear');
});

test('with no limit, every pair on screen that shares a word gets a line, labelled with both forms', () => {
  const W = G.buildWeb(I, 0, { volumes: both, maxBranches: 10, wordLimit: 0 });
  const ids = W.nodes.map(n => n.id);
  const stemsOf = id => new Set(T.stemForms(FIXTURE.verses[id][3]).keys());
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const shared = [...stemsOf(ids[i])].some(x => stemsOf(ids[j]).has(x));
    if (shared) assert.ok(W.edges.some(e => pairKey(e.a, e.b) === pairKey(ids[i], ids[j])), `no line ${ids[i]}-${ids[j]}`);
  }
  assert.ok(W.edges.some(e => /faith\/faithful|repentance\/repent/.test(e.label)), W.edges.map(e => e.label).join(' | '));
});

test('maxBranches is respected', () => {
  const W = G.buildWeb(I, 0, { volumes: both, maxBranches: 2 });
  assert.equal(W.nodes.length, 3);
});

test('volume filter is respected', () => {
  const W = G.buildWeb(I, 0, { volumes: new Set([0]), maxBranches: 10 });
  for (const n of W.nodes) assert.equal(FIXTURE.verses[n.id][2], 0);
});

test('a user word not in the center can join neighbours on the ring', () => {
  const W = G.buildWeb(I, 0, { volumes: both, maxBranches: 10, userWords: ['charity'], wordLimit: 0 });
  assert.ok(W.edges.some(e => !e.toCenter && e.stems.includes(T.stem('charity'))), W.edges.map(e => e.label).join(' | '));
  assert.equal(W.keywords.user[0].shown, true);
});

test('every verse links to the center and to both neighbours', () => {
  for (const limit of [0, 1, 2, 3]) {
    const W = G.buildWeb(I, 0, { volumes: both, maxBranches: 10, userWords: ['charity'], wordLimit: limit });
    const has = (a, b) => W.edges.some(e => pairKey(e.a, e.b) === pairKey(a, b));
    W.ring.forEach((id, i) => {
      assert.ok(has(0, id), `limit ${limit}: verse ${id} has no center line`);
      if (W.ring.length > 1) assert.ok(has(id, W.ring[(i + 1) % W.ring.length]), `limit ${limit}: ${id} not linked to its neighbour`);
    });
    if (W.ring.length >= 3) assert.equal(W.closed, true);
  }
});

test('a tight limit gives fewer verses and explains why', () => {
  // 3 center words x limit 1 = 3 lines. A ring of 3+ verses needs 2 lines per verse, so only 1-2 verses fit.
  const W = G.buildWeb(I, 0, { volumes: both, maxBranches: 10, wordLimit: 1 });
  assert.ok(W.ring.length <= 2, String(W.ring.length));
  assert.match(W.message, /Only \d+ verses? fit/);
});

test('user words that are common, missing, or outside the volumes are reported', () => {
  const W = G.buildWeb(I, 0, { volumes: new Set([0]), maxBranches: 10, userWords: ['the', 'anchr', 'works'] });
  const [the, anchr, works] = W.keywords.user;
  assert.equal(the.status, 'stopword');
  assert.equal(anchr.status, 'notfound');
  assert.ok(anchr.suggestions.includes('anchor'));
  assert.equal(works.status, 'novolumes');
  assert.deepEqual(works.byVolume, [0, 1]);
});

test('switching off a keyword removes its links', () => {
  const W = G.buildWeb(I, 0, { volumes: both, maxBranches: 10, disabledStems: new Set([T.stem('hope')]) });
  assert.ok(!W.edges.some(e => e.stems.includes(T.stem('hope'))));
  assert.equal(W.keywords.auto.find(k => k.stem === T.stem('hope')).enabled, false);
});

test('word limit: no word appears on more lines than the limit', () => {
  for (const limit of [1, 2, 3]) {
    const W = G.buildWeb(I, 0, { volumes: both, maxBranches: 10, userWords: ['charity', 'anchor', 'christ'], wordLimit: limit });
    for (const [s, n] of Object.entries(usesPerStem(W))) assert.ok(n <= limit, `${s} used ${n} times with limit ${limit}`);
  }
});

test('word limit defaults to 3', () => {
  assert.equal(G.DEFAULT_WORD_LIMIT, 3);
  assert.equal(G.buildWeb(I, 0, { volumes: both }).wordLimit, 3);
});

test('word limit 0 means no limit', () => {
  // In this small fixture "faith" is shared by 3 verses, so it can appear on 3 lines.
  const unlimited = usesPerStem(G.buildWeb(I, 0, { volumes: both, maxBranches: 10, wordLimit: 0 }));
  const limited = usesPerStem(G.buildWeb(I, 0, { volumes: both, maxBranches: 10, wordLimit: 1 }));
  assert.ok(Math.max(...Object.values(unlimited)) > 1, JSON.stringify(unlimited));
  assert.equal(Math.max(...Object.values(limited)), 1);
});

test('word limit still links every verse it shows, and says when fewer fit', () => {
  const W = G.buildWeb(I, 0, { volumes: both, maxBranches: 10, wordLimit: 1 });
  const linked = new Set(W.edges.flatMap(e => [e.a, e.b]));
  for (const n of W.nodes) if (!n.isCenter) assert.ok(linked.has(n.id), `verse ${n.id} has no line`);
  assert.ok(W.nodes.length - 1 < 10);
  assert.match(W.message, /Only \d+ verses fit.*Raise the word limit/);
  assert.ok(W.keywords.auto.some(k => k.atLimit));
});

test('a verse with no keywords gives a message, not an empty web', () => {
  const data = { volumes: ['A'], verses: [['X 1:1', 'X 1:1', 0, 'And it came to pass.'], ['Y 1:1', 'Y 1:1', 0, 'Faith.']] };
  const W = G.buildWeb(T.buildIndex(data), 0, {});
  assert.equal(W.nodes.length, 1);
  assert.match(W.message, /no keywords/);
});

test('side-by-side verses on the ring always share a line', () => {
  for (const limit of [0, 1, 2, 3]) {
    for (const userWords of [[], ['charity'], ['charity', 'anchor', 'christ']]) {
      const W = G.buildWeb(I, 0, { volumes: both, maxBranches: 10, userWords, wordLimit: limit });
      assert.equal(G.unlinkedNeighbours(W.ring, W.edges, W.closed), 0, `limit ${limit}, words ${userWords}`);
      for (let i = 0; i + 1 < W.ring.length; i++) {
        const k = pairKey(W.ring[i], W.ring[i + 1]);
        assert.ok(W.edges.some(e => pairKey(e.a, e.b) === k), `no line for neighbours ${k}`);
      }
      if (W.closed) assert.ok(W.edges.some(e => pairKey(e.a, e.b) === pairKey(W.ring[0], W.ring.at(-1))));
    }
  }
});

test('unlinkedNeighbours counts the gap only when the ring is closed', () => {
  const edges = [{ a: 1, b: 2 }, { a: 2, b: 3 }];
  assert.equal(G.unlinkedNeighbours([1, 2, 3], edges, false), 0);
  assert.equal(G.unlinkedNeighbours([1, 2, 3], edges, true), 1);
});

test('the ring is always attached to the center, even when the limit is tight', () => {
  for (const limit of [1, 2, 3]) {
    const W = G.buildWeb(I, 0, { volumes: both, maxBranches: 10, userWords: ['charity', 'anchor', 'christ'], wordLimit: limit });
    if (W.nodes.length > 1) assert.ok(W.edges.some(e => e.toCenter), `limit ${limit}: no line to the center`);
  }
});
