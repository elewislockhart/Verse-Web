const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../js/text.js');
const Q = require('../js/talks.js');

const VERSES = {
  volumes: ['Book of Mormon'],
  verses: [
    ['Alma 32:21', 'Alma 32:21', 0, 'Faith is not to have a perfect knowledge of things; if ye have faith ye hope for things which are not seen, which are true.'], // 0
    ['Alma 32:27', 'Alma 32:27', 0, 'Awake and arouse your faculties, even to an experiment upon my words.'], // 1
    ['Moroni 7:47', 'Moro. 7:47', 0, 'Charity is the pure love of Christ, and it endureth forever.'], // 2
  ],
};
const I = T.buildIndex(VERSES);

const para = (text, extra = {}) => ({ id: 'p_' + text.slice(0, 5).replace(/\W/g, ''), text, ...extra });
const talk = (slug, name, paragraphs) => ({
  slug, title: 'Talk ' + slug, speaker: 'Elder ' + name, name, role: 'Role', kicker: '',
  session: 'Saturday Morning Session', url: `https://example.org/gc/${slug}?lang=eng`, paragraphs, notes: {},
});
const CONFS = [
  { conference: { id: '2025-04', title: 'April 2025 general conference' }, talks: [
    talk('a', 'Ann', [
      para('Faith Is Action', { heading: true }),
      para('Too short to quote.'),
      para('Alma taught that faith is a hope for things which are not seen, which are true.', { cites: ['Alma 32:21'], notes: [1] }),
      para('Charity is the pure love of Christ; it never faileth and endureth forever.', { cites: ['Moroni 7:47', 'Moroni 7:46', 'Moroni 7:48'] }),
    ]),
  ] },
  { conference: { id: '2026-10', title: 'October 2026 general conference' }, talks: [
    talk('b', 'Ben', [
      para('Plant the seed and try the experiment upon the word, and you will feel it grow.', { cites: ['Alma 32:27'] }),
      para('Read the whole chapter about the seed and the tree of life with your family.', { chapters: ['Alma 32'] }),
      para('Hope and faith and perfect knowledge come line upon line to the faithful who seek truth.'),
      para('Faith hope faith hope: these words alone with nothing rare in common at all here.'),
      para('A paragraph about tithing and temples and nothing to do with that verse at all.'),
      para('Charity is the pure love of Christ.', { cites: ['Moroni 7:47'] }),
    ]),
  ] },
];
const TI = Q.buildTalkIndex(I, CONFS);
const texts = qs => qs.map(q => Q.paragraphOf(TI, q).paragraph.text);

test('index skips headings and very short paragraphs, newest conference first', () => {
  assert.equal(TI.paras.length, 8);
  assert.equal(TI.conferences[0].conference.id, '2026-10');
  assert.ok(!texts(TI.paras.map((p, idx) => ({ ...p, idx }))).some(t => t === 'Too short to quote.'));
  assert.equal(TI.unmatched, 2); // Moroni 7:46 and 7:48 are not in the fixture verses
});

test('a paragraph citing the verse comes first, then same-chapter citations, then shared words', () => {
  // The default rarity threshold is tuned for thousands of paragraphs; this fixture has 8.
  const r = Q.findQuotes(TI, I, 0, { minWeight: 1 });
  assert.equal(r[0].reason, 'cites');
  assert.match(texts(r)[0], /Alma taught/);
  assert.deepEqual(r.slice(1, 3).map(q => q.reason), ['chapter', 'chapter']);
  assert.ok(r.some(q => q.reason === 'words' && /perfect knowledge/.test(texts([q])[0])));
  assert.ok(!texts(r).some(t => /tithing/.test(t)), 'unrelated paragraph left out');
});

test('a footnote citing only this verse ranks above one citing several', () => {
  const r = Q.findQuotes(TI, I, 2);
  assert.deepEqual(texts(r.filter(q => q.reason === 'cites')), [
    'Charity is the pure love of Christ.',
    'Charity is the pure love of Christ; it never faileth and endureth forever.',
  ]);
});

test('selected keywords restrict quotes to paragraphs containing all of them', () => {
  const hope = Q.findQuotes(TI, I, 0, { keywords: [T.stem('hope')] });
  assert.ok(hope.length >= 3);
  assert.ok(texts(hope).every(t => /hope/i.test(t)));
  // A keyword-only match counts once the user asked for that word.
  assert.ok(texts(hope).some(t => /nothing rare/.test(t)));

  const both = Q.findQuotes(TI, I, 0, { keywords: [T.stem('hope'), T.stem('knowledge')] });
  assert.ok(texts(both).every(t => /hope/i.test(t) && /knowledge/i.test(t)));
  assert.deepEqual(Q.findQuotes(TI, I, 0, { keywords: [T.stem('tithing'), T.stem('hope')] }), []);
});

test('quotes from one talk are spread out', () => {
  const r = Q.findQuotes(TI, I, 0, { keywords: [T.stem('faith')] });
  const talks = r.map(q => q.talk + '/' + q.conf);
  assert.ok(talks.length >= 3);
  assert.notEqual(talks[0], talks[1]);
});

test('links go straight to the paragraph, or to the talk without an id', () => {
  const t = CONFS[0].talks[0];
  assert.equal(Q.quoteLink(t, { id: 'p_abc' }), 'https://example.org/gc/a?lang=eng&id=p_abc#p_abc');
  assert.equal(Q.quoteLink(t, { text: 'x' }), 'https://example.org/gc/a?lang=eng');
});

test('no talk data gives no quotes', () => {
  assert.deepEqual(Q.findQuotes(Q.buildTalkIndex(I, []), I, 0), []);
  assert.deepEqual(Q.findQuotes(null, I, 0), []);
});
