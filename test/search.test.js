const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../js/text.js');

const FIXTURE = {
  volumes: ['Old Testament', 'Book of Mormon'],
  verses: [
    ['Song of Solomon 1:1', 'Song 1:1', 0, 'The song of songs, which is Solomon\'s.'],      // 0
    ['Job 1:1', 'Job 1:1', 0, 'There was a man in the land of Uz, whose name was Job.'],  // 1
    ['1 Nephi 3:7', '1 Ne. 3:7', 1, 'I will go and do the things which the Lord hath commanded.'], // 2
    ['1 Nephi 3:8', '1 Ne. 3:8', 1, 'And it came to pass that my father was exceedingly glad.'],   // 3
    ['Moroni 7:45', 'Moro. 7:45', 1, 'And charity suffereth long, and is kind, and envieth not.'],  // 4
    ['Moroni 7:47', 'Moro. 7:47', 1, 'But charity is the pure love of Christ, and it endureth forever.'], // 5
    ['Alma 32:21', 'Alma 32:21', 1, 'Faith is not to have a perfect knowledge of things; if ye have faith ye hope.'], // 6
  ],
};
const I = T.buildIndex(FIXTURE);
const ids = r => r.results.map(x => x.id);

test('references in loose formats', () => {
  for (const q of ['1 Nephi 3:7', '1 nephi 3 7', 'first nephi 3:7', '1 Ne 3 7', '1ne3:7']) {
    assert.equal(ids(T.search(I, q))[0], 2, q);
  }
  assert.equal(ids(T.search(I, 'moro 7:47'))[0], 5, 'partial book name with a number');
});

test('a chapter lists its verses', () => {
  assert.deepEqual(ids(T.search(I, 'Moroni 7')), [4, 5]);
});

test('missing chapter or verse says why', () => {
  assert.match(T.search(I, 'Moroni 9').note, /Moroni has 1 chapter/);
  const r = T.search(I, 'Moroni 7:99');
  assert.match(r.note, /Moroni 7 has 47 verses/, 'count is the last verse number');
  assert.deepEqual(ids(r), [4, 5], 'still lists the chapter');
});

test('exact phrase ranks first, then most words', () => {
  const r = T.search(I, 'charity is the pure love');
  assert.equal(r.results[0].id, 5);
  assert.equal(r.results[0].phrase, true);
  assert.ok(ids(r).includes(4), 'partial match is listed too');
});

test('a phrase of only common words still matches', () => {
  const r = T.search(I, 'it came to pass');
  assert.deepEqual(ids(r), [3]);
});

test('a plain word is not mistaken for a book name', () => {
  // "son" starts "Song of Solomon" but has no chapter number
  const r = T.search(I, 'son');
  assert.ok(!ids(r).includes(0) || r.results.find(x => x.id === 0).kind === 'text');
});

test('unknown words get spelling suggestions', () => {
  const r = T.search(I, 'charty');
  assert.equal(r.unknown[0].word, 'charty');
  assert.ok(r.unknown[0].suggestions.includes('charity'));
});

test('volume filter limits word search', () => {
  const r = T.search(I, 'land', { volumes: new Set([1]) });
  assert.equal(r.total, 0);
  assert.match(r.note, /No verses/);
});

test('limit and total', () => {
  const r = T.search(I, 'charity', { limit: 1 });
  assert.equal(r.results.length, 1);
  assert.equal(r.total, 2);
});
