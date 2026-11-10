// GET /covers/<bookId>: a book's cover image, from our own copy in D1.
// On first request (or after the book's cover_url changes) we fetch the image once
// from its source, store it, and serve it. Public, like the history page.

const SOURCES = ['covers.openlibrary.org', 'images.penguinrandomhouse.com', 'books.google.com'];
const MAX_BYTES = 1_500_000; // D1 rows top out around 2 MB
const YEAR = 60 * 60 * 24 * 365;

const imageResponse = (data, type) => new Response(data, {
  headers: { 'Content-Type': type, 'Cache-Control': `public, max-age=${YEAR}, immutable` },
});

export async function onRequestGet({ request, env, params, waitUntil }) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return new Response('not found', { status: 404 });

  const cache = caches.default;
  const hit = await cache.match(request);
  if (hit) return hit;

  const book = await env.DB.prepare('SELECT cover_url FROM books_read WHERE id = ?').bind(id).first();
  if (!book?.cover_url) return new Response('no cover', { status: 404 });
  const source = book.cover_url.replace(/#crop$/, '');

  // A cover file of our own (public/cover-files/), for books no source has a good image of.
  if (source.startsWith('/')) {
    const own = await env.ASSETS.fetch(new URL(source, request.url));
    if (!own.ok) return new Response('no cover', { status: 404 });
    const res = imageResponse(await own.arrayBuffer(), own.headers.get('Content-Type') || 'image/webp');
    waitUntil(cache.put(request, res.clone()));
    return res;
  }

  let res;
  const stored = await env.DB.prepare('SELECT source_url, content_type, data FROM cover_cache WHERE book_id = ?').bind(id).first();
  if (stored && stored.source_url === source) {
    res = imageResponse(new Uint8Array(stored.data), stored.content_type);
  } else {
    if (!SOURCES.includes(new URL(source).hostname)) return new Response('cover host not allowed', { status: 400 });
    const upstream = await fetch(source, { redirect: 'follow', headers: { 'User-Agent': 'geb-club.link cover cache' } });
    const type = upstream.headers.get('Content-Type') || '';
    if (!upstream.ok || !type.startsWith('image/')) {
      return new Response('cover source unavailable', { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }
    const data = new Uint8Array(await upstream.arrayBuffer());
    if (data.byteLength > MAX_BYTES) return new Response('cover too large', { status: 502 });
    await env.DB.prepare(`INSERT INTO cover_cache (book_id, source_url, content_type, data) VALUES (?, ?, ?, ?)
      ON CONFLICT (book_id) DO UPDATE SET source_url = excluded.source_url, content_type = excluded.content_type,
      data = excluded.data, fetched_at = datetime('now')`).bind(id, source, type, data).run();
    res = imageResponse(data, type);
  }
  waitUntil(cache.put(request, res.clone()));
  return res;
}
