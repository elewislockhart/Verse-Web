# Verse Web

A spider web of scripture verses. The verse you start from sits in the middle. Around it are verses that share keywords with it, and any two verses that share a keyword are joined by a line labeled with that word. Different forms of a word are shown together on the label, e.g. `faith/faithful`.

## Run it

Double-click `index.html`. It runs fully offline: no server and no internet needed. Cytoscape.js 3.30.2 (MIT licence) is saved in `js/vendor/`.

- Find a starting verse with the search box, or press **Random**. The box accepts:
  - references, typed loosely: `Alma 32:21`, `alma 32 21`, `first nephi 3:7`, `moro 7:45`;
  - a chapter, to list its verses: `Moroni 7`;
  - words or a phrase from the verse: `charity never faileth`. Exact phrases rank first, then verses with the most matching words (rare words count more). Misspelled words get "Try …" suggestions.
  Use the arrow keys and Enter, or click a result. The volume checkboxes also limit word searches.
- Click a circle to read the verse. The linking words are in bold. **Make this the center** moves the web to that verse.
- Click a line to highlight the two verses it joins.
- **Conference quotes** appear under the verse in the panel. One related quote shows when a verse opens; **Search Conference** adds three more, and **Show more** keeps adding three until there are none left. Each quote links to its paragraph in the original talk on churchofjesuschrist.org.
  - Quotes whose footnotes cite this exact verse come first (a footnote citing just this verse beats one citing a long passage), then quotes citing the same chapter, then quotes that share several rare words with the verse. Quotes from one talk are spread out so it doesn't fill the list.
  - Click any keyword in the verse to only show quotes containing it. Pick more words to narrow further: a quote must contain every picked word. Click a word again, or its × chip, to unpick it; **Clear** removes them all.
- Keyword chips:
  - Click an automatic keyword to stop linking on it.
  - Add your own words under **Your keywords**.
  - A word that isn't in the scriptures turns red and suggests spellings.
  - A word missing from the volumes you've ticked shows which volumes do have it.
  - A common word ("the") is refused.
  - An amber chip means the word is in the scriptures but didn't fit within the branch limit.
- **Word limit** (default 3) is the most lines any one word can appear on; slide it all the way right for no limit. Each chip shows how many of its lines are used. Because each line needs a word, a web can have at most *keywords × limit* lines. If that's fewer than the verses you asked for, the page says so; add keywords or raise the limit.
- Every verse on the ring has a line to the center and a line to each verse beside it (the green ring lines). Building the web can take a few seconds while it searches for such a ring.

The center verse is kept in the URL (`index.html#Alma%2032%3A21`), so you can bookmark a web.

## Files

| File | What it does |
|---|---|
| `js/stopwords.js` | Common words that never link verses. Edit freely. |
| `js/text.js` | Tokenizer, KJV-aware stemmer, word index, keyword checks |
| `js/graph.js` | Picks the verses for the web and the lines between them |
| `js/talks.js` | Indexes conference talk paragraphs and ranks quotes for a verse |
| `js/app.js` | Page wiring and drawing (Cytoscape.js) |
| `js/vendor/cytoscape.min.js` | Cytoscape.js 3.30.2, saved locally so the page works offline |
| `data/verses.js` | All 41,995 verses (generated) |
| `tools/build_data.py` | Rebuilds `data/verses.js` from the SQLite database |
| `tools/scrape_conference.py` | Downloads general conference talks into `data/talks/` |

## How verses are chosen

The page searches for a ring in which every verse has:
- a line to the center, using a keyword the center shares;
- a line to each neighbour, using a keyword they share;

and in which no word goes over the word limit.

The search is depth-first. It grows the ring one verse at a time and tries the six most promising verses at each step. It backs up when it reaches a dead end and keeps the largest ring that closes. It stops after 3 seconds and keeps the best ring found. A verse scores well for rare shared words, keywords not yet on the web, and words with uses left.

A ring needs two lines per verse, so with a word limit the size is capped: 5 keywords × limit 3 = 15 lines, which is enough for 7 verses. The page says when that's the reason. Any word uses left over then go to lines between other verses that share a word, and then to extra words on existing labels.

## Rebuild the data

The data comes from the public-domain export at github.com/beandog/lds-scriptures (tag 2020.12.08).

```bash
python tools/build_data.py
```

It reads `tools/source/lds-scriptures-sqlite.db` by default, or a database path you pass as an argument. That file isn't in the repo; download it once:

```bash
curl -L -o tools/source/lds-scriptures-sqlite.db https://raw.githubusercontent.com/beandog/lds-scriptures/2020.12.08/sqlite/lds-scriptures-sqlite.db
```

## Conference talks

`tools/scrape_conference.py` downloads general conference talks from churchofjesuschrist.org, with permission. The parsed talks in `data/talks/` are committed. Wherever the app shows a quote, it must link to the original talk (see "Linking back to the source" below). The raw downloaded pages in `tools/cache/` are in `.gitignore`.

```bash
python tools/scrape_conference.py 2026/10 2026/04
```

- It waits 1.5 seconds between downloads (`--delay` changes this) and caches every page in `tools/cache/`. Running it again re-parses from the cache; `--refresh` downloads again.
- It needs the source database above to turn scripture links into verse titles.
- Each conference is written to `data/talks/YYYY-MM.js`, and `data/talks/manifest.js` lists the conferences downloaded.

Each conference file adds one entry to `window.TALK_DATA`:

```js
{
  conference: { id: '2026-10', title: 'October 2026 general conference', year: 2026, month: 10,
                url, sessions: ['Saturday Morning Session', ...] },
  talks: [{
    slug: '12gong', title: 'Come to the Lord in His Holy House',
    speaker: 'Elder Gerrit W. Gong',          // as printed on the talk
    name: 'Gerrit W. Gong',                   // name only
    role: 'Of the Quorum of the Twelve Apostles',
    kicker, session: 'Saturday Morning Session', url,
    paragraphs: [{
      id: 'p_bEYFr',                          // the site's paragraph id, for deep links
      text,
      notes: [1],                             // footnote numbers in this paragraph
      cites: ['Moses 1:39'],                  // verses cited; same titles as data/verses.js
      chapters: ['Alma 32'],                  // whole chapters cited
      heading: true, quote: true,             // only when true
    }],
    notes: { '1': 'See Moses 1:39.' },
  }],
}
```

### Linking back to the source

Every quote shown in the app should link to where it came from. Each talk has its `url`, and each paragraph its `id`, so a link can go straight to the paragraph:

```js
const link = `${talk.url}&id=${para.id}#${para.id}`;
// https://www.churchofjesuschrist.org/study/general-conference/2026/10/12gong?lang=eng&id=p_bEYFr#p_bEYFr
```

Fall back to `talk.url` if a paragraph has no `id`.

Citations come from the scripture links in each talk's footnotes and text, so they're exact. Links to the Guide to the Scriptures and other study helps are left out. The site gives only the month and year for each conference, not the date of each session.

## Tests

```bash
node --test
python -m unittest discover tools/tests
```
