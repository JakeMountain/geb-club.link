// Reading progress on the current book: entered by hand, or read from a member's public
// Goodreads updates feed (which includes progress synced from Kindle).

const MAX_PAGE = 100000;

// '' / null / undefined = not given; otherwise a whole number, or NaN.
const int = (v) => (v == null || v === '' ? null : Number.isInteger(Number(v)) ? Number(v) : NaN);

/**
 * body: { page, pages } or { percent }. Returns { page, pages, percent } cleaned up,
 * { clear: true } when nothing was entered, or { error }.
 */
export function cleanProgress(body) {
  const page = int(body?.page), pages = int(body?.pages), percent = int(body?.percent);
  if ([page, pages, percent].some(Number.isNaN)) return { error: 'enter whole numbers' };
  if (percent != null) {
    if (page != null || pages != null) return { error: 'enter a page or a percent, not both' };
    if (percent < 0 || percent > 100) return { error: 'percent must be 0 to 100' };
    return { page: null, pages: null, percent };
  }
  if (page == null) return pages == null ? { clear: true } : { error: 'enter the page you are on' };
  if (page < 1 || page > MAX_PAGE) return { error: 'enter the page you are on' };
  if (pages != null && (pages < page || pages > MAX_PAGE)) return { error: 'page count must be at least the page you are on' };
  return { page, pages, percent: null };
}

// Numeric user id from a profile link like https://www.goodreads.com/user/show/12345-name.
export function goodreadsUserId(url) {
  try {
    const u = new URL(url);
    if (!['www.goodreads.com', 'goodreads.com'].includes(u.hostname)) return null;
    return u.pathname.match(/^\/(?:user\/show|review\/list|user_status\/list)\/(\d+)/)?.[1] ?? null;
  } catch { return null; }
}

export const goodreadsFeedUrl = (id) => `https://www.goodreads.com/user/updates_rss/${id}`;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m);
const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1') : '';
};
// Visible text of an HTML fragment, first line only (a status comment can follow a <br>).
const text = (html) => decode(decode(html).split(/<br\s*\/?>/i)[0].replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

// "… is on page 120 of 400 of Title", "… is on page 120 of Title", "… is 35% done with Title"
function readLine(line) {
  let m = line.match(/\bis on page (\d+) of (\d+) of (.+)$/i);
  if (m) return { page: +m[1], pages: +m[2], percent: null, title: m[3] };
  m = line.match(/\bis on page (\d+) of (.+)$/i);
  if (m) return { page: +m[1], pages: null, percent: null, title: m[2] };
  m = line.match(/\bis (\d{1,3})% done with (.+)$/i);
  if (m && +m[1] <= 100) return { page: null, pages: null, percent: +m[1], title: m[2] };
  return null;
}

// SQLite-style UTC timestamp, so it sorts against datetime('now').
const sqlTime = (d) => {
  const t = new Date(d);
  return Number.isNaN(t.getTime()) ? null : t.toISOString().slice(0, 19).replace('T', ' ');
};

/** Progress updates in an updates feed: [{ page, pages, percent, title, updated_at }]. Other updates are skipped. */
export function parseUpdates(xml) {
  const out = [];
  for (const [, item] of String(xml).matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const found = readLine(text(tag(item, 'title'))) ?? readLine(text(tag(item, 'description')));
    if (found) out.push({ ...found, updated_at: sqlTime(text(tag(item, 'pubDate'))) });
  }
  return out;
}

// Comparable form of a title: no series "(…, #1)", subtitle, punctuation, case or leading article.
export function titleKey(title) {
  return String(title).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\)/g, ' ').split(/[:–—]/)[0]
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/^(the|a|an) /, '');
}

/** The newest update for a book, or null. */
export function latestFor(updates, bookTitle) {
  const key = titleKey(bookTitle);
  if (!key) return null;
  const match = updates.filter((u) => u.updated_at && titleKey(u.title) === key)
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))[0];
  return match ? { page: match.page, pages: match.pages, percent: match.percent, updated_at: match.updated_at } : null;
}
