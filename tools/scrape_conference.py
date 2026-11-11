"""Download general conference talks into data files the app can load.

Usage:
    python tools/scrape_conference.py 2026/10 [2026/04 ...] [--delay 1.5] [--refresh]

Each conference is written to data/talks/YYYY-MM.js, and data/talks/manifest.js
lists the conferences that have been downloaded. Downloaded pages are cached in
tools/cache/, so running again only re-parses (pass --refresh to download again).

Each paragraph keeps the site's paragraph id, so a quote can link straight to
its place in the talk:  <talk url>&id=<paragraph id>#<paragraph id>

Scripture citations come from the links in each talk's footnotes (and any
inline scripture links). They are resolved to verse titles such as
"Alma 32:21" using the book slugs in the source SQLite database, so they match
data/verses.js exactly.

Uses only the Python standard library.
"""
import argparse
import html
import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = 'https://www.churchofjesuschrist.org'
DB_PATH = os.path.join(ROOT, 'tools', 'source', 'lds-scriptures-sqlite.db')
CACHE_DIR = os.path.join(ROOT, 'tools', 'cache', 'general-conference')
OUT_DIR = os.path.join(ROOT, 'data', 'talks')
USER_AGENT = 'verse-web personal study tool (Python urllib)'
MONTHS = {4: 'April', 10: 'October'}

# ---------------------------------------------------------------------------
# A tiny DOM, so the parsing below can ask for "the p elements inside
# div.body-block" instead of matching raw HTML with regular expressions.

VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
        'meta', 'source', 'track', 'wbr'}


class Node:
    __slots__ = ('tag', 'attrs', 'children', 'parent')

    def __init__(self, tag, attrs=None, parent=None):
        self.tag = tag
        self.attrs = dict(attrs or {})
        self.children = []
        self.parent = parent

    @property
    def classes(self):
        return (self.attrs.get('class') or '').split()

    def has_class(self, name):
        return name in self.classes

    def iter(self):
        for child in self.children:
            if isinstance(child, Node):
                yield child
                yield from child.iter()

    def find_all(self, tag=None, cls=None):
        return [n for n in self.iter()
                if (tag is None or n.tag == tag) and (cls is None or n.has_class(cls))]

    def find(self, tag=None, cls=None):
        for n in self.iter():
            if (tag is None or n.tag == tag) and (cls is None or n.has_class(cls)):
                return n
        return None

    def ancestors(self):
        p = self.parent
        while p is not None:
            yield p
            p = p.parent

    def text(self, skip=None):
        out = []
        for child in self.children:
            if isinstance(child, str):
                out.append(child)
            elif skip is None or not skip(child):
                out.append(child.text(skip))
        return ''.join(out)


class TreeBuilder(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node('#root')
        self.cur = self.root

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs, self.cur)
        self.cur.children.append(node)
        if tag not in VOID:
            self.cur = node

    def handle_startendtag(self, tag, attrs):
        self.cur.children.append(Node(tag, attrs, self.cur))

    def handle_endtag(self, tag):
        n = self.cur
        while n is not None and n.tag != tag:
            n = n.parent
        if n is not None and n.parent is not None:
            self.cur = n.parent

    def handle_data(self, data):
        self.cur.children.append(data)


def parse_html(text):
    b = TreeBuilder()
    b.feed(text)
    b.close()
    return b.root


def clean(text):
    text = text.replace(' ', ' ').replace('​', '')
    return re.sub(r'\s+', ' ', text).strip()


# ---------------------------------------------------------------------------
# Scripture links

SCRIPTURE_HREF = re.compile(r'^/study/scriptures/([^/?#]+)/([^/?#]+)(?:/(\d+))?')


def verse_numbers(idspec):
    """'p7,p18-p19,p26' -> [7, 18, 19, 26]. Ids that are not verses are ignored."""
    nums = []
    for part in (idspec or '').split(','):
        m = re.fullmatch(r'p(\d+)(?:-p(\d+))?', part.strip())
        if not m:
            continue
        a = int(m.group(1))
        b = int(m.group(2) or a)
        if b < a or b - a > 200:
            b = a
        nums.extend(range(a, b + 1))
    return nums


def parse_scripture_href(href):
    """Return (volume_slug, book_slug, chapter, [verses]) or None."""
    href = html.unescape(href or '')
    m = SCRIPTURE_HREF.match(href)
    if not m:
        return None
    vol, book, chapter = m.group(1), m.group(2), m.group(3)
    q = re.search(r'[?&]id=([^&#]+)', href)
    return vol, book, int(chapter) if chapter else None, verse_numbers(q.group(1) if q else '')


def load_books(db_path=DB_PATH):
    """{(volume_slug, book_slug): book_title} from the source database."""
    if not os.path.exists(db_path):
        sys.exit(f'Missing {db_path}. Download it first (see README, "Rebuild the data").')
    con = sqlite3.connect(db_path)
    try:
        rows = con.execute(
            'SELECT volumes.volume_lds_url, books.book_lds_url, books.book_title '
            'FROM books JOIN volumes ON volumes.id = books.volume_id').fetchall()
    finally:
        con.close()
    return {(v, b): t for v, b, t in rows}


def resolve_refs(refs, books):
    """Turn parsed links into ('Alma 32:21' verse titles, 'Alma 32' chapter refs, other)."""
    verses, chapters, other = [], [], []
    for vol, book, chapter, nums in refs:
        title = books.get((vol, book))
        if not title or chapter is None:
            other.append(f'{vol}/{book}' + (f'/{chapter}' if chapter else ''))
        elif nums:
            verses.extend(f'{title} {chapter}:{n}' for n in nums)
        else:
            chapters.append(f'{title} {chapter}')
    return dedupe(verses), dedupe(chapters), dedupe(other)


def dedupe(items):
    seen = set()
    return [x for x in items if not (x in seen or seen.add(x))]


# ---------------------------------------------------------------------------
# Pages

def parse_index(page, year, month):
    """Sessions and talk slugs, in order, from a conference contents page."""
    root = parse_html(page)
    title_node = root.find('title')
    prefix = f'/study/general-conference/{year}/{month:02d}/'
    sessions, seen = [], set()
    current = None
    for a in root.find_all('a'):
        href = html.unescape(a.attrs.get('href') or '')
        if not href.startswith(prefix):
            continue
        slug = href[len(prefix):].split('?')[0].split('#')[0].strip('/')
        if not slug or '/' in slug:
            continue
        name = clean(a.find('span').text() if a.find('span') else a.text())
        subtitle = ''
        for p in a.find_all('p'):
            if any(c.startswith('subtitle') for c in p.classes):
                subtitle = clean(p.text())
        if slug.endswith('-session'):
            if slug in seen:
                continue
            seen.add(slug)
            current = {'slug': slug, 'name': name, 'talks': []}
            sessions.append(current)
        elif slug not in seen:
            seen.add(slug)
            if current is None:
                current = {'slug': '', 'name': '', 'talks': []}
                sessions.append(current)
            current['talks'].append({'slug': slug, 'title': name, 'name': subtitle})
    return {
        'title': clean(title_node.text()) if title_node else f'{MONTHS.get(month, month)} {year} general conference',
        'sessions': sessions,
    }


def is_marker(node):
    return node.tag == 'sup' and node.has_class('marker')


def parse_talk(page):
    """Title, speaker, role, kicker, paragraphs and footnotes from a talk page."""
    root = parse_html(page)

    def first_text(cls=None, tag=None):
        n = root.find(tag, cls)
        return clean(n.text()) if n else ''

    title = first_text(tag='h1')
    speaker = re.sub(r'^By\s+', '', first_text('author-name'))
    role = first_text('author-role')
    kicker = first_text('kicker')

    # Footnotes: number -> text and scripture links.
    notes = {}
    footer = root.find('footer', 'notes')
    if footer:
        for li in footer.find_all('li'):
            m = re.fullmatch(r'note(\d+)', li.attrs.get('id') or '')
            if not m:
                continue
            refs = [r for r in (parse_scripture_href(a.attrs.get('href'))
                                for a in li.find_all('a', 'scripture-ref')) if r]
            notes[int(m.group(1))] = {'text': clean(li.text()), 'refs': refs}

    paragraphs = []
    body = root.find('div', 'body-block')
    if body:
        for node in body.iter():
            if node.tag not in ('p', 'h2', 'h3', 'h4'):
                continue
            # Skip a p nested inside another p/heading we already took,
            # and figure captions / image credits.
            if any(a.tag in ('p', 'h2', 'h3', 'h4', 'figure', 'figcaption') for a in node.ancestors()
                   if a is not body and body in a.ancestors()):
                continue
            text = clean(node.text(skip=is_marker))
            if not text:
                continue
            note_nums = []
            for a in node.find_all('a', 'note-ref'):
                m = re.search(r'note(\d+)', a.attrs.get('data-scroll-id') or a.attrs.get('href') or '')
                if m:
                    note_nums.append(int(m.group(1)))
            inline = [r for r in (parse_scripture_href(a.attrs.get('href'))
                                  for a in node.find_all('a', 'scripture-ref')) if r]
            para = {'text': text, 'notes': note_nums, 'inline': inline,
                    'id': node.attrs.get('id') or ''}
            if node.tag != 'p':
                para['heading'] = True
            if any(a.tag == 'blockquote' for a in node.ancestors()):
                para['quote'] = True
            paragraphs.append(para)

    return {'title': title, 'speaker': speaker, 'role': role, 'kicker': kicker,
            'paragraphs': paragraphs, 'notes': notes}


def build_talk(parsed, books, slug, session, url, name=''):
    """Shape a parsed talk for the app, with citations resolved to verse titles."""
    paragraphs = []
    for p in parsed['paragraphs']:
        refs = list(p['inline'])
        for n in p['notes']:
            refs.extend(parsed['notes'].get(n, {}).get('refs', []))
        verses, chapters, _ = resolve_refs(refs, books)
        out = {'text': p['text']}
        if p.get('id'):
            out['id'] = p['id']
        if p['notes']:
            out['notes'] = p['notes']
        if verses:
            out['cites'] = verses
        if chapters:
            out['chapters'] = chapters
        if p.get('heading'):
            out['heading'] = True
        if p.get('quote'):
            out['quote'] = True
        paragraphs.append(out)
    return {
        'slug': slug,
        'title': parsed['title'],
        'speaker': parsed['speaker'],
        'name': name or re.sub(r'^(Elder|Sister|President|Bishop|Brother)\s+', '', parsed['speaker']),
        'role': parsed['role'],
        'kicker': parsed['kicker'],
        'session': session,
        'url': url,
        'paragraphs': paragraphs,
        'notes': {str(k): v['text'] for k, v in sorted(parsed['notes'].items())},
    }


# ---------------------------------------------------------------------------
# Fetching

class Fetcher:
    def __init__(self, delay=1.5, refresh=False):
        self.delay = delay
        self.refresh = refresh
        self.last = 0.0
        self.downloaded = 0

    def get(self, path, cache_file):
        if not self.refresh and os.path.exists(cache_file):
            with open(cache_file, encoding='utf-8') as f:
                return f.read()
        wait = self.delay - (time.monotonic() - self.last)
        if wait > 0:
            time.sleep(wait)
        url = SITE + path + ('&' if '?' in path else '?') + 'lang=eng'
        req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
        for attempt in (1, 2):
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    body = r.read().decode('utf-8')
                break
            except (urllib.error.URLError, TimeoutError) as e:
                self.last = time.monotonic()
                if attempt == 2:
                    raise
                print(f'  retrying {path} after error: {e}', file=sys.stderr)
                time.sleep(max(self.delay, 5))
        self.last = time.monotonic()
        self.downloaded += 1
        os.makedirs(os.path.dirname(cache_file), exist_ok=True)
        with open(cache_file, 'w', encoding='utf-8') as f:
            f.write(body)
        return body


def parse_conference_arg(arg):
    m = re.search(r'(\d{4})[/-](\d{1,2})', arg)
    if not m:
        sys.exit(f'Not a conference: {arg!r}. Use YYYY/MM, e.g. 2026/10.')
    return int(m.group(1)), int(m.group(2))


def scrape(year, month, fetcher, books):
    conf_id = f'{year}-{month:02d}'
    base = f'/study/general-conference/{year}/{month:02d}'
    cache = os.path.join(CACHE_DIR, str(year), f'{month:02d}')
    index = parse_index(fetcher.get(base, os.path.join(cache, 'index.html')), year, month)
    talks, problems = [], []
    total = sum(len(s['talks']) for s in index['sessions'])
    n = 0
    for session in index['sessions']:
        for item in session['talks']:
            slug = item['slug']
            n += 1
            path = f'{base}/{slug}'
            try:
                page = fetcher.get(path, os.path.join(cache, slug + '.html'))
            except Exception as e:  # keep going; report at the end
                problems.append(f'{slug}: download failed ({e})')
                continue
            parsed = parse_talk(page)
            if not parsed['paragraphs']:
                problems.append(f'{slug}: no paragraphs found')
                continue
            talk = build_talk(parsed, books, slug, session['name'], SITE + path + '?lang=eng', item['name'])
            talks.append(talk)
            cites = sum(len(p.get('cites', [])) for p in talk['paragraphs'])
            print(f'  [{n}/{total}] {talk["title"]} ({talk["speaker"]}): '
                  f'{len(talk["paragraphs"])} paragraphs, {cites} verse citations')
    conference = {
        'id': conf_id,
        'title': f'{MONTHS.get(month, month)} {year} general conference',
        'pageTitle': index['title'],
        'year': year,
        'month': month,
        'url': SITE + base + '?lang=eng',
        'sessions': [s['name'] for s in index['sessions'] if s['name']],
    }
    return {'conference': conference, 'talks': talks}, problems


def write_conference(data):
    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, data['conference']['id'] + '.js')
    body = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
    with open(path, 'w', encoding='utf-8') as f:
        f.write('(window.TALK_DATA=window.TALK_DATA||[]).push(' + body + ');\n')
    write_manifest()
    return path


def write_manifest():
    ids = sorted(f[:-3] for f in os.listdir(OUT_DIR)
                 if re.fullmatch(r'\d{4}-\d{2}\.js', f))
    with open(os.path.join(OUT_DIR, 'manifest.js'), 'w', encoding='utf-8') as f:
        f.write('window.TALK_MANIFEST=' + json.dumps(ids) + ';\n')


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('conferences', nargs='+', help='YYYY/MM, e.g. 2026/10 (or a conference URL)')
    ap.add_argument('--delay', type=float, default=1.5, help='seconds between downloads (default 1.5)')
    ap.add_argument('--refresh', action='store_true', help='download again instead of using the cache')
    args = ap.parse_args(argv)
    books = load_books()
    fetcher = Fetcher(delay=max(args.delay, 0.5), refresh=args.refresh)
    failed = False
    for arg in args.conferences:
        year, month = parse_conference_arg(arg)
        print(f'{year}/{month:02d}:')
        data, problems = scrape(year, month, fetcher, books)
        if not data['talks']:
            print(f'  No talks found for {year}/{month:02d}.', file=sys.stderr)
            failed = True
            continue
        path = write_conference(data)
        paras = sum(len(t['paragraphs']) for t in data['talks'])
        print(f'  Wrote {os.path.relpath(path, ROOT)}: {len(data["talks"])} talks, {paras} paragraphs.')
        for p in problems:
            print(f'  Problem: {p}', file=sys.stderr)
        failed = failed or bool(problems)
    print(f'Downloaded {fetcher.downloaded} page(s); the rest came from tools/cache/.')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
