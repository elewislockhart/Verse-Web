"""Tests for tools/scrape_conference.py, using small made-up pages shaped like the site's.

Run with:  python -m unittest discover tools/tests
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import scrape_conference as s  # noqa: E402

BOOKS = {
    ('bofm', 'alma'): 'Alma',
    ('dc-testament', 'dc'): 'Doctrine and Covenants',
    ('pgp', 'moses'): 'Moses',
    ('nt', 'john'): 'John',
}

INDEX = """<html><head><title>April 2030 general conference</title></head><body>
<header><a href="/study/general-conference/2030/04?lang=eng">Contents</a></header>
<nav><ul>
<li><a class="sectionTitle-x1" href="/study/general-conference/2030/04/saturday-morning-session?lang=eng">
  <div><p><span>Saturday Morning Session</span></p></div></a>
  <ul>
  <li><a class="item-x" href="/study/general-conference/2030/04/11smith?lang=eng">
    <div><p><span>A Talk About Faith</span></p><p class="subtitle-ab12">Jane Q. Smith</p></div></a></li>
  <li><a class="item-x" href="/study/general-conference/2030/04/12jones?lang=eng">
    <div><p><span>Hope in Christ</span></p><p class="subtitle-ab12">John Jones</p></div></a></li>
  </ul></li>
<li><a class="sectionTitle-x1" href="/study/general-conference/2030/04/sunday-morning-session?lang=eng">
  <div><p><span>Sunday Morning Session</span></p></div></a>
  <ul><li><a class="item-x" href="/study/general-conference/2030/04/21brown?lang=eng">
    <div><p><span>Charity Never Faileth</span></p><p class="subtitle-ab12">Ann Brown</p></div></a></li></ul></li>
</ul></nav>
<main><a href="/study/general-conference/2030/04/11smith?lang=eng">A Talk About Faith (again)</a></main>
</body></html>"""

TALK = """<html><body>
<header class="site"><nav>Site banner</nav></header>
<article><header>
<h1 data-aid="1" id="t1">A Talk About Faith</h1>
<div class="byline"><p class="author-name">By Sister Jane&nbsp;Q. Smith</p>
<p class="author-role">Of the Example Presidency</p></div>
<p class="kicker">Faith is a principle of action.</p>
</header>
<div class="body-block">
<p data-aid="9" id="p_aB3dE">Faith is not to have a perfect knowledge.<a class="note-ref" href="#note1" data-scroll-id="note1"><sup class="marker" data-value="1"></sup></a></p>
<h2 id="title2">Faith and Works</h2>
<p>As Alma taught, see <a class="scripture-ref" href="/study/scriptures/bofm/alma/32?lang=eng&amp;id=p27#p27">Alma 32:27</a>.</p>
<blockquote><p>&ldquo;For God so loved the world.&rdquo;<a class="note-ref" href="#note2" data-scroll-id="note2"><sup class="marker" data-value="2"></sup></a></p></blockquote>
<figure><img src="x.jpg"><figcaption><p>A picture caption</p></figcaption></figure>
<p>   </p>
<p>Read the whole chapter.<a class="note-ref" href="#note3" data-scroll-id="note3"><sup class="marker" data-value="3"></sup></a></p>
</div>
<footer class="notes"><p class="title">Notes</p><ol>
<li id="note1"><p>See <a class="scripture-ref" href="/study/scriptures/bofm/alma/32?lang=eng&amp;id=p21#p21">Alma 32:21</a>;
 <a class="scripture-ref" href="/study/scriptures/dc-testament/dc/132?lang=eng&amp;id=p7,p18-p19#p7">Doctrine and Covenants 132:7, 18&ndash;19</a>.</p></li>
<li id="note2"><p><a class="scripture-ref" href="/study/scriptures/nt/john/3?lang=eng&amp;id=p16#p16">John 3:16</a>;
 Guide to the Scriptures, <a class="scripture-ref" href="/study/scriptures/gs/faith?lang=eng&amp;id=p1#p1">Faith</a>.</p></li>
<li id="note3"><p>See <a class="scripture-ref" href="/study/scriptures/bofm/alma/32?lang=eng">Alma 32</a>.</p></li>
</ol></footer>
</article></body></html>"""


class VerseNumbers(unittest.TestCase):
    def test_lists_ranges_and_junk(self):
        self.assertEqual(s.verse_numbers('p7,p18-p19,p26'), [7, 18, 19, 26])
        self.assertEqual(s.verse_numbers('p39-p43'), [39, 40, 41, 42, 43])
        self.assertEqual(s.verse_numbers('title1,intro'), [])
        self.assertEqual(s.verse_numbers(''), [])

    def test_scripture_href(self):
        self.assertEqual(s.parse_scripture_href('/study/scriptures/bofm/alma/32?lang=eng&amp;id=p21#p21'),
                         ('bofm', 'alma', 32, [21]))
        self.assertEqual(s.parse_scripture_href('/study/scriptures/gs/faith?lang=eng'), ('gs', 'faith', None, []))
        self.assertIsNone(s.parse_scripture_href('/study/general-conference/2023/10/17oaks'))


class Index(unittest.TestCase):
    def test_sessions_and_talks_in_order(self):
        idx = s.parse_index(INDEX, 2030, 4)
        self.assertEqual(idx['title'], 'April 2030 general conference')
        self.assertEqual([x['name'] for x in idx['sessions']],
                         ['Saturday Morning Session', 'Sunday Morning Session'])
        self.assertEqual(idx['sessions'][0]['talks'], [
            {'slug': '11smith', 'title': 'A Talk About Faith', 'name': 'Jane Q. Smith'},
            {'slug': '12jones', 'title': 'Hope in Christ', 'name': 'John Jones'},
        ])
        # The repeated link further down the page is not counted twice.
        self.assertEqual([t['slug'] for t in idx['sessions'][1]['talks']], ['21brown'])


class Talk(unittest.TestCase):
    def setUp(self):
        self.parsed = s.parse_talk(TALK)
        self.talk = s.build_talk(self.parsed, BOOKS, '11smith', 'Saturday Morning Session',
                                 'https://example/11smith', 'Jane Q. Smith')

    def test_header_fields(self):
        t = self.talk
        self.assertEqual(t['title'], 'A Talk About Faith')
        self.assertEqual(t['speaker'], 'Sister Jane Q. Smith')
        self.assertEqual(t['name'], 'Jane Q. Smith')
        self.assertEqual(t['role'], 'Of the Example Presidency')
        self.assertEqual(t['kicker'], 'Faith is a principle of action.')
        self.assertEqual(t['session'], 'Saturday Morning Session')

    def test_paragraphs_skip_captions_and_blanks(self):
        texts = [p['text'] for p in self.talk['paragraphs']]
        self.assertEqual(texts, [
            'Faith is not to have a perfect knowledge.',
            'Faith and Works',
            'As Alma taught, see Alma 32:27.',
            '“For God so loved the world.”',
            'Read the whole chapter.',
        ])
        self.assertTrue(self.talk['paragraphs'][1].get('heading'))
        self.assertTrue(self.talk['paragraphs'][3].get('quote'))
        self.assertNotIn('quote', self.talk['paragraphs'][0])

    def test_citations_from_notes_and_inline_links(self):
        p = self.talk['paragraphs']
        self.assertEqual(p[0]['notes'], [1])
        self.assertEqual(p[0]['cites'], ['Alma 32:21', 'Doctrine and Covenants 132:7',
                                         'Doctrine and Covenants 132:18', 'Doctrine and Covenants 132:19'])
        self.assertEqual(p[2]['cites'], ['Alma 32:27'])       # inline link, no footnote
        self.assertEqual(p[3]['cites'], ['John 3:16'])        # Guide to the Scriptures link left out
        self.assertEqual(p[4]['chapters'], ['Alma 32'])       # whole-chapter link
        self.assertNotIn('cites', p[4])
        self.assertNotIn('cites', p[1])

    def test_paragraph_ids_for_deep_links(self):
        p = self.talk['paragraphs']
        self.assertEqual(p[0]['id'], 'p_aB3dE')
        self.assertEqual(p[1]['id'], 'title2')
        self.assertNotIn('id', p[2])          # no id on the page, so none saved

    def test_notes_kept_as_text(self):
        self.assertEqual(sorted(self.talk['notes']), ['1', '2', '3'])
        self.assertTrue(self.talk['notes']['3'].startswith('See Alma 32'))


class Resolve(unittest.TestCase):
    def test_unknown_books_go_to_other(self):
        verses, chapters, other = s.resolve_refs(
            [('bofm', 'alma', 32, [21, 21]), ('gs', 'faith', None, []), ('ot', 'nope', 1, [1])], BOOKS)
        self.assertEqual(verses, ['Alma 32:21'])
        self.assertEqual(chapters, [])
        self.assertEqual(other, ['gs/faith', 'ot/nope/1'])


if __name__ == '__main__':
    unittest.main()
