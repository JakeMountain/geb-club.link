import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanProgress, goodreadsUserId, goodreadsFeedUrl, parseUpdates, titleKey, latestFor } from '../src/progress.js';

test('cleanProgress: a page, a page of a count, or a percent', () => {
  assert.deepEqual(cleanProgress({ page: '120', pages: '400' }), { page: 120, pages: 400, percent: null });
  assert.deepEqual(cleanProgress({ page: 12, pages: '' }), { page: 12, pages: null, percent: null });
  assert.deepEqual(cleanProgress({ page: '', pages: '', percent: '35' }), { page: null, pages: null, percent: 35 });
  assert.deepEqual(cleanProgress({ percent: 0 }), { page: null, pages: null, percent: 0 });
  assert.deepEqual(cleanProgress({}), { clear: true });
  assert.deepEqual(cleanProgress({ page: '', pages: '', percent: '' }), { clear: true });
});

test('cleanProgress: rejects bad input', () => {
  for (const body of [{ page: '1.5' }, { page: 'abc' }, { page: 0 }, { page: 50, pages: 40 }, { percent: 101 },
    { percent: -1 }, { page: 10, percent: 5 }, { pages: 300 }]) {
    assert.ok(cleanProgress(body).error, JSON.stringify(body));
  }
});

test('goodreadsUserId: from profile links', () => {
  assert.equal(goodreadsUserId('https://www.goodreads.com/user/show/12345-some-name'), '12345');
  assert.equal(goodreadsUserId('https://goodreads.com/user/show/987'), '987');
  assert.equal(goodreadsUserId('https://www.goodreads.com/review/list/555-x?shelf=read'), '555');
  assert.equal(goodreadsUserId('https://www.goodreads.com/book/show/1.Title'), null);
  assert.equal(goodreadsUserId('https://example.com/user/show/1'), null);
  assert.equal(goodreadsUserId(null), null);
  assert.equal(goodreadsFeedUrl('12345'), 'https://www.goodreads.com/user/updates_rss/12345');
});

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Updates</title>
<item>
  <guid><![CDATA[https://www.goodreads.com/user_status/show/3]]></guid>
  <pubDate><![CDATA[Sat, 21 Nov 2026 20:15:00 -0800]]></pubDate>
  <title><![CDATA[Someone is 42% done with The Left Hand of Darkness (Hainish Cycle, #4)]]></title>
  <description><![CDATA[<a href="https://www.goodreads.com/book/show/18423.x">The Left Hand of Darkness</a>]]></description>
</item>
<item>
  <pubDate>Fri, 20 Nov 2026 09:00:00 +0000</pubDate>
  <title>Someone is on page 120 of 304 of The Left Hand of Darkness</title>
</item>
<item>
  <pubDate>Thu, 19 Nov 2026 09:00:00 +0000</pubDate>
  <title>Someone is on page 88 of Gödel, Escher, Bach: An Eternal Golden Braid</title>
</item>
<item>
  <pubDate>Wed, 18 Nov 2026 09:00:00 +0000</pubDate>
  <title>Someone wants to read Dune</title>
</item>
<item>
  <pubDate>Tue, 17 Nov 2026 09:00:00 +0000</pubDate>
  <title>Someone added a status</title>
  <description>&lt;a href="/user/show/1"&gt;Someone&lt;/a&gt; is on page 50 of 600 of &lt;a href="/book/show/2"&gt;War &amp;amp; Peace&lt;/a&gt;&lt;br/&gt;slow going</description>
</item>
</channel></rss>`;

test('parseUpdates: page and percent updates, from the title or the description', () => {
  const u = parseUpdates(FEED);
  assert.equal(u.length, 4);
  assert.deepEqual(u[0], { page: null, pages: null, percent: 42, title: 'The Left Hand of Darkness (Hainish Cycle, #4)', updated_at: '2026-11-22 04:15:00' });
  assert.deepEqual(u[1], { page: 120, pages: 304, percent: null, title: 'The Left Hand of Darkness', updated_at: '2026-11-20 09:00:00' });
  assert.equal(u[2].page, 88);
  assert.equal(u[2].pages, null);
  assert.deepEqual([u[3].page, u[3].pages, u[3].title], [50, 600, 'War & Peace']);
  assert.deepEqual(parseUpdates('not xml'), []);
  assert.deepEqual(parseUpdates(''), []);
});

test('titleKey: ignores series, subtitle, case, punctuation and a leading article', () => {
  assert.equal(titleKey('The Left Hand of Darkness (Hainish Cycle, #4)'), titleKey('left hand of darkness'));
  assert.equal(titleKey('Gödel, Escher, Bach: An Eternal Golden Braid'), titleKey('Godel Escher Bach'));
  assert.equal(titleKey('War & Peace'), titleKey('War and Peace'));
  assert.notEqual(titleKey('Dune Messiah'), titleKey('Dune'));
});

test('latestFor: the newest matching update, or null', () => {
  const u = parseUpdates(FEED);
  assert.deepEqual(latestFor(u, 'The Left Hand of Darkness'), { page: null, pages: null, percent: 42, updated_at: '2026-11-22 04:15:00' });
  assert.deepEqual(latestFor([...u].reverse(), 'The Left Hand of Darkness')?.percent, 42);
  assert.equal(latestFor(u, 'Gödel, Escher, Bach')?.page, 88);
  assert.equal(latestFor(u, 'Dune'), null);
  assert.equal(latestFor(u, ''), null);
  assert.equal(latestFor([], 'Dune'), null);
});
