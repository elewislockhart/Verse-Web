const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../js/text.js');

const FIXTURE = {
  volumes: ['Old Testament', 'Book of Mormon'],
  verses: [
    ['Genesis 1:1', 'Gen. 1:1', 0, 'In the beginning God created the heaven and the earth.'],
    ['Alma 32:21', 'Alma 32:21', 1, 'Faith is not to have a perfect knowledge; if ye have faith ye hope.'],
    ['1 Nephi 3:7', '1 Ne. 3:7', 1, 'I will go and do the things which the Lord hath commanded.'],
  ],
};

test('stemmer groups word forms', () => {
  const same = [
    ['faith', 'faithful', 'faithfulness'],
    ['repent', 'repentance', 'repenteth', 'repented'],
    ['believe', 'believeth', 'believed'],
    ['sin', 'sins', 'sinned', 'sinneth'],
    ['mercy', 'mercies', 'merciful'],
    ['day', 'days'],
    ['priest', 'priests'],
    ['affliction', 'afflictions', 'afflicted'],
    ['transgression', 'transgressed'],
  ];
  for (const group of same) {
    const stems = new Set(group.map(T.stem));
    assert.equal(stems.size, 1, `${group.join(', ')} -> ${[...stems].join(', ')}`);
  }
  assert.notEqual(T.stem('bless'), T.stem('blood'));
  assert.equal(T.stem('witness'), 'witness');
});

test('broad common-word list', () => {
  for (const w of ['the', 'for', 'it', 'said', 'came', 'why', 'through', 'unto', 'thee', 'hath', 'behold']) {
    assert.ok(T.STOPWORDS.has(w), w);
  }
  for (const w of ['faith', 'hope', 'christ', 'repentance', 'old', 'lord', 'pity', 'man', 'know', 'seven', 'first']) {
    assert.ok(!T.STOPWORDS.has(w), w);
  }
});

test('tokenize keeps positions and marks common words', () => {
  const text = "And Christ's faith came through hope.";
  const toks = T.tokenize(text);
  const christ = toks.find(t => t.form === 'christ');
  assert.equal(text.slice(christ.start, christ.end), "Christ's");
  assert.equal(toks.find(t => t.form === 'came').stop, true);
  assert.equal(toks.find(t => t.form === 'through').stop, true);
  assert.equal(toks.find(t => t.form === 'faith').stop, false);
});

test('index finds verses by full and short reference', () => {
  const I = T.buildIndex(FIXTURE);
  assert.equal(T.findVerse(I, 'Alma 32:21'), 1);
  assert.equal(T.findVerse(I, '1 Ne. 3:7'), 2);
  assert.equal(T.findVerse(I, '1 ne 3:7'), 2);
  assert.equal(T.findVerse(I, '1 nephi 3 : 7'), 2);
  assert.equal(T.findVerse(I, 'Moroni 99:1'), -1);
  assert.deepEqual(T.suggestRefs(I, '1 Ne'), [2]);
});

test('checkKeyword: stopword, not found with suggestions, other volumes, ok', () => {
  const I = T.buildIndex(FIXTURE);
  const all = new Set([0, 1]);
  assert.equal(T.checkKeyword(I, 'the', all).status, 'stopword');

  const nf = T.checkKeyword(I, 'knowlege', all);
  assert.equal(nf.status, 'notfound');
  assert.ok(nf.suggestions.includes('knowledge'));

  const nv = T.checkKeyword(I, 'heaven', new Set([1]));
  assert.equal(nv.status, 'novolumes');
  assert.equal(nv.inSelected, 0);
  assert.deepEqual(nv.byVolume, [1, 0]);

  const ok = T.checkKeyword(I, 'faithful', all);
  assert.equal(ok.status, 'ok');
  assert.equal(ok.total, 1);
});
