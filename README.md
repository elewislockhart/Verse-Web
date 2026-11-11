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
| `js/app.js` | Page wiring and drawing (Cytoscape.js) |
| `js/vendor/cytoscape.min.js` | Cytoscape.js 3.30.2, saved locally so the page works offline |
| `data/verses.js` | All 41,995 verses (generated) |
| `tools/build_data.py` | Rebuilds `data/verses.js` from the SQLite database |

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

It reads `tools/source/lds-scriptures-sqlite.db` by default, or a database path you pass as an argument.

## Tests

```bash
node --test
```
