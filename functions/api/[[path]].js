// All API routes. Auth is enforced in functions/_middleware.js.
import { passwordMatches, loginCookie, logoutCookie, hashPassword, verifyPassword, accountCookie, accountLogoutCookie, currentAccount } from '../../src/auth.js';
import { METHODS, DEBT_PARAMS, replay, trace, tally, debtsFor, weightsFor, attendance, standings } from '../../src/tally.js';
import { cleanSchedule } from '../../src/schedule.js';

const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers });
const bad = (msg, status = 400) => json({ error: msg }, status);
const SIGNED_OUT = () => bad('sign in to your account first', 403);
// Admin powers only count on an account with a password (a passwordless account is open to the whole club).
const isAdmin = (m) => !!(m?.is_admin && m.pw_hash);
const ADMINS_ONLY = () => bad('admins only', 403);
const publicMember = (m) => m && {
  id: m.id, name: m.name, first_name: m.first_name, discord: m.discord, has_password: !!m.pw_hash, created_at: m.created_at,
  storygraph_url: m.storygraph_url, goodreads_url: m.goodreads_url, favorite_book_id: m.favorite_book_id, is_admin: isAdmin(m),
};
const memberExists = async (db, id) => Number.isInteger(id) && !!(await db.prepare('SELECT id FROM members WHERE id = ?').bind(id).first());

// First name and Discord handle are each optional; at least one is required.
// The display name is "First (@handle)", or whichever one was given.
function identity(body) {
  const first_name = str(body.first_name, 40) || null;
  const discord = str(body.discord, 40).replace(/^@+/, '').trim() || null;
  if (!first_name && !discord) return { error: 'enter a first name or a Discord handle' };
  const name = first_name && discord ? `${first_name} (@${discord})` : first_name || `@${discord}`;
  return { first_name, discord, name };
}
const takenMessage = (err) => (/discord/i.test(String(err?.message)) ? 'that Discord handle is taken' : 'that name is taken');
// Covers are served from our own /covers/<bookId> route (stored in D1), not the original host.
// ?v= changes when the source URL changes, so browsers can cache each version forever.
// A #crop marker (scan with extra margins) is passed through for the pages to apply.
function coverPath(bookId, url) {
  if (!url || bookId == null) return null;
  let h = 2166136261;
  for (const ch of url) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return `/covers/${bookId}?v=${(h >>> 0).toString(36)}${url.endsWith('#crop') ? '#crop' : ''}`;
}
const withCover = (row, idKey = 'id', key = 'cover_url') => (row && { ...row, [key]: coverPath(row[idKey], row[key]) });
const withCovers = (rows, idKey, key) => rows.map((r) => withCover(r, idKey, key));

const str = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// ------------------------------------------------------------ data helpers

async function getElection(db, id) {
  const e = await db.prepare('SELECT * FROM elections WHERE id = ?').bind(id).first();
  if (e?.result) e.result = JSON.parse(e.result);
  return e;
}

const candidatesOf = (db, id) =>
  db.prepare(`SELECT c.*, m.name AS nominator FROM candidates c LEFT JOIN members m ON m.id = c.nominator_id
              WHERE election_id = ? ORDER BY c.id`).bind(id).all().then((r) => r.results);

const ballotsOf = (db, id) =>
  db.prepare('SELECT b.member_id, m.name, b.scores, b.updated_at FROM ballots b JOIN members m ON m.id = b.member_id WHERE election_id = ? ORDER BY m.name')
    .bind(id).all().then((r) => r.results.map((b) => ({ ...b, scores: JSON.parse(b.scores) })));

// Every closed election, oldest first, in the shape the tally functions take. Voters/candidates are keyed by id strings.
async function closedHistory(db, beforeId = null) {
  const closed = (await db.prepare(`SELECT id, title, winner_id FROM elections WHERE status = 'closed' AND winner_id IS NOT NULL
                                    ${beforeId ? 'AND id != ?' : ''} ORDER BY closed_at, id`)
    .bind(...(beforeId ? [beforeId] : [])).all()).results;
  const history = [];
  for (const e of closed) {
    const cands = (await candidatesOf(db, e.id)).map((c) => String(c.id));
    const ballots = (await ballotsOf(db, e.id)).map((b) => ({ voter: String(b.member_id), scores: b.scores }));
    history.push({ id: e.id, title: e.title, candidates: cands, ballots, winner: String(e.winner_id) });
  }
  return history;
}

// Debt state after those elections.
const debtState = async (db, beforeId = null) => replay(await closedHistory(db, beforeId), await startState(db));

// Founding members (joined before the first election closed) start at full attendance;
// debt_seeds holds starting debts.
async function startState(db) {
  const first = await db.prepare("SELECT MIN(closed_at) AS t FROM elections WHERE status = 'closed'").first();
  const founders = (await db.prepare(first?.t ? 'SELECT id FROM members WHERE created_at < ?' : 'SELECT id FROM members')
    .bind(...(first?.t ? [first.t] : [])).all()).results.map((r) => String(r.id));
  const seeds = Object.fromEntries((await db.prepare('SELECT member_id, debt FROM debt_seeds').all()).results.map((r) => [String(r.member_id), r.debt]));
  return { founders, seeds };
}

// ------------------------------------------------------------ routes

const routes = [];
const route = (method, pattern, fn) =>
  routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });

route('POST', '/api/login', async ({ env, body }) => {
  if (!env.CLUB_PASSWORD || !env.SESSION_SECRET) return bad('server is missing its secrets', 500);
  if (!(await passwordMatches(str(body.password, 200), env))) return bad('wrong password', 403);
  return json({ ok: true }, 200, { 'Set-Cookie': await loginCookie(env) });
});

route('POST', '/api/logout', () => {
  const h = new Headers({ 'Content-Type': 'application/json' });
  h.append('Set-Cookie', logoutCookie);
  h.append('Set-Cookie', accountLogoutCookie);
  return new Response(JSON.stringify({ ok: true }), { headers: h });
});

// Public: just the books, in order.
route('GET', '/api/public/books', async ({ db }) =>
  json(withCovers((await db.prepare('SELECT id, position, title, author, cover_url, storygraph_url FROM books_read ORDER BY position').all()).results)));

route('GET', '/api/books', async ({ db }) =>
  json(withCovers((await db.prepare('SELECT b.*, (SELECT COUNT(*) FROM book_notes n WHERE n.book_id = b.id) AS n_notes FROM books_read b ORDER BY position').all()).results)));

route('PATCH', '/api/books/:id', async ({ db, params, body }) => {
  const fields = ['title', 'author', 'nominator', 'read_date', 'notes'].filter((f) => f in body);
  if (!fields.length) return bad('nothing to update');
  await db.prepare(`UPDATE books_read SET ${fields.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`)
    .bind(...fields.map((f) => str(body[f], 1000) || null), params.id).run();
  return json({ ok: true });
});

// Everyone's list: no password info. (has_password is only shown to the account itself, via /api/me.)
route('GET', '/api/members', async ({ db }) =>
  json((await db.prepare(`SELECT m.id, m.name, m.first_name, m.discord, m.created_at, m.storygraph_url, m.goodreads_url,
      m.favorite_book_id, b.title AS favorite_title FROM members m LEFT JOIN books_read b ON b.id = m.favorite_book_id ORDER BY m.name`).all()).results));

route('GET', '/api/me', ({ me }) => json({ me: publicMember(me) }));

route('POST', '/api/accounts', async ({ env, db, body }) => {
  const id = identity(body);
  if (id.error) return bad(id.error);
  const pw = typeof body.password === 'string' ? body.password : '';
  const { salt, hash } = pw ? await hashPassword(pw) : {};
  let m;
  try {
    m = await db.prepare(`INSERT INTO members (name, first_name, discord, pw_hash, pw_salt, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now')) RETURNING *`)
      .bind(id.name, id.first_name, id.discord, hash ?? null, salt ?? null).first();
  } catch (err) { return bad(takenMessage(err)); }
  return json({ me: publicMember(m) }, 201, { 'Set-Cookie': await accountCookie(env, m) });
});

route('POST', '/api/accounts/login', async ({ env, db, body }) => {
  const m = await db.prepare('SELECT * FROM members WHERE id = ?').bind(Number(body.member_id)).first();
  if (!m) return bad('no such account', 404);
  if (!(await verifyPassword(typeof body.password === 'string' ? body.password : '', m))) return bad('wrong password', 403);
  return json({ me: publicMember(m) }, 200, { 'Set-Cookie': await accountCookie(env, m) });
});

route('POST', '/api/accounts/logout', () => json({ ok: true }, 200, { 'Set-Cookie': accountLogoutCookie }));

// Update your own first name / Discord handle, and/or password ('' removes it).
route('PATCH', '/api/me', async ({ env, db, me, body }) => {
  if (!me) return SIGNED_OUT();
  let m = me;
  if ('first_name' in body || 'discord' in body) {
    const id = identity({ first_name: body.first_name ?? me.first_name, discord: body.discord ?? me.discord });
    if (id.error) return bad(id.error);
    try {
      m = await db.prepare('UPDATE members SET name = ?, first_name = ?, discord = ? WHERE id = ? RETURNING *')
        .bind(id.name, id.first_name, id.discord, me.id).first();
    } catch (err) { return bad(takenMessage(err)); }
  }
  for (const field of ['storygraph_url', 'goodreads_url']) {
    if (!(field in body)) continue;
    const link = profileLink(field, body[field]);
    if (link.error) return bad(link.error);
    m = await db.prepare(`UPDATE members SET ${field} = ? WHERE id = ? RETURNING *`).bind(link.value, me.id).first();
  }
  if ('favorite_book_id' in body) {
    const fav = body.favorite_book_id == null || body.favorite_book_id === '' ? null : Number(body.favorite_book_id);
    if (fav != null && !(await db.prepare('SELECT id FROM books_read WHERE id = ?').bind(fav).first())) return bad('no such book');
    m = await db.prepare('UPDATE members SET favorite_book_id = ? WHERE id = ? RETURNING *').bind(fav, me.id).first();
  }
  if (typeof body.password === 'string') {
    const { salt, hash } = body.password ? await hashPassword(body.password) : {};
    m = await db.prepare('UPDATE members SET pw_hash = ?, pw_salt = ? WHERE id = ? RETURNING *')
      .bind(hash ?? null, salt ?? null, me.id).first();
  }
  return json({ me: publicMember(m) }, 200, { 'Set-Cookie': await accountCookie(env, m) });
});

// ------------------------------------------------------------ print gallery

const MAX_PRINT_BYTES = 1_500_000; // D1 rows top out around 2 MB, same limit as cover_cache

function decodeBase64(b64) {
  const bin = atob(b64);
  const data = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
  return data;
}

route('GET', '/api/prints', async ({ db }) =>
  json((await db.prepare(`SELECT p.id, p.member_id, m.name, p.created_at FROM prints p
    JOIN members m ON m.id = p.member_id ORDER BY p.created_at DESC, p.id DESC`).all()).results));

route('POST', '/api/me/prints', async ({ db, me, body }) => {
  const type = str(body.content_type, 40);
  if (!/^image\/(png|jpeg)$/.test(type)) return bad('image must be a PNG or JPEG');
  if (typeof body.data !== 'string' || !body.data) return bad('image data required');
  let data;
  try { data = decodeBase64(body.data); } catch { return bad('invalid image data'); }
  if (!data.length || data.length > MAX_PRINT_BYTES) return bad('image is too large');
  const r = await db.prepare('INSERT INTO prints (member_id, content_type, data) VALUES (?, ?, ?) RETURNING id, member_id, created_at')
    .bind(me.id, type, data).first();
  return json({ ...r, name: me.name }, 201);
});

route('DELETE', '/api/me/prints/:id', async ({ db, me, params }) => {
  await db.prepare('DELETE FROM prints WHERE id = ? AND member_id = ?').bind(params.id, me.id).run();
  return json({ ok: true });
});

// ------------------------------------------------------------ hall of shame votes

// Counts only, no names; plus which ones you voted for. Keyed by the title in shame.json.
const shameVotes = async (db, me) => ({
  counts: Object.fromEntries((await db.prepare('SELECT title, COUNT(*) AS n FROM shame_votes GROUP BY title').all()).results.map((r) => [r.title, r.n])),
  mine: me ? (await db.prepare('SELECT title FROM shame_votes WHERE member_id = ?').bind(me.id).all()).results.map((r) => r.title) : [],
});

route('GET', '/api/shame/votes', async ({ db, me }) => json(await shameVotes(db, me)));

// { title, vote: true | false }
route('PUT', '/api/shame/votes', async ({ db, me, body }) => {
  const title = str(body.title, 300);
  if (!title) return bad('title required');
  await db.prepare(body.vote === false ? 'DELETE FROM shame_votes WHERE title = ? AND member_id = ?'
    : 'INSERT OR IGNORE INTO shame_votes (title, member_id) VALUES (?, ?)').bind(title, me.id).run();
  return json(await shameVotes(db, me));
});

// ------------------------------------------------------------ member center

// Profile links must point at the real sites (also keeps javascript: URLs out).
const LINK_HOSTS = {
  storygraph_url: ['app.thestorygraph.com', 'thestorygraph.com'],
  goodreads_url: ['www.goodreads.com', 'goodreads.com'],
};
function profileLink(field, v) {
  const s = str(v, 300);
  if (!s) return { value: null };
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (u.protocol === 'https:' && LINK_HOSTS[field].includes(u.hostname)) return { value: u.toString() };
  } catch {}
  return { error: field === 'storygraph_url' ? 'StoryGraph link must be an app.thestorygraph.com URL' : 'Goodreads link must be a goodreads.com URL' };
}

route('GET', '/api/me/want-to-read', async ({ db, me }) => {
  if (!me) return SIGNED_OUT();
  return json((await db.prepare('SELECT * FROM want_to_read WHERE member_id = ? ORDER BY added_at DESC, id DESC').bind(me.id).all()).results);
});

route('POST', '/api/me/want-to-read', async ({ db, me, body }) => {
  const title = str(body.title, 200);
  if (!title) return bad('title required');
  const int = (v) => (Number.isInteger(v) ? v : null);
  const r = await db.prepare(`INSERT INTO want_to_read (member_id, title, author, ol_key, cover_id, year)
    VALUES (?, ?, ?, ?, ?, ?) RETURNING *`).bind(me.id, title, str(body.author, 200) || null,
    str(body.ol_key, 60) || null, int(body.cover_id), int(body.year)).first();
  return json(r, 201);
});

route('DELETE', '/api/me/want-to-read/:wid', async ({ db, me, params }) => {
  await db.prepare('DELETE FROM want_to_read WHERE id = ? AND member_id = ?').bind(params.wid, me.id).run();
  return json({ ok: true });
});

route('GET', '/api/me/notes', async ({ db, me }) => {
  if (!me) return SIGNED_OUT();
  return json(withCovers((await db.prepare(`SELECT n.book_id, n.note, n.updated_at, b.position, b.title, b.author, b.cover_url
    FROM book_notes n JOIN books_read b ON b.id = n.book_id WHERE n.member_id = ? ORDER BY b.position`).bind(me.id).all()).results, 'book_id'));
});

route('GET', '/api/books/:id', async ({ db, params }) => {
  const book = await db.prepare('SELECT * FROM books_read WHERE id = ?').bind(params.id).first();
  if (!book) return bad('no such book', 404);
  const notes = (await db.prepare(`SELECT n.member_id, m.name, n.note, n.updated_at FROM book_notes n
    JOIN members m ON m.id = n.member_id WHERE n.book_id = ? ORDER BY n.updated_at`).bind(book.id).all()).results;
  const favoriteOf = (await db.prepare('SELECT name FROM members WHERE favorite_book_id = ? ORDER BY name').bind(book.id).all()).results.map((r) => r.name);
  const election = book.election_id ? await db.prepare('SELECT id, title FROM elections WHERE id = ?').bind(book.election_id).first() : null;
  return json({ book: withCover(book), notes, favoriteOf, election });
});

// Your note on a past book; empty note deletes it.
route('PUT', '/api/books/:id/note', async ({ db, me, params, body }) => {
  const book = await db.prepare('SELECT id FROM books_read WHERE id = ?').bind(params.id).first();
  if (!book) return bad('no such book', 404);
  const note = str(body.note, 5000);
  if (!note) {
    await db.prepare('DELETE FROM book_notes WHERE member_id = ? AND book_id = ?').bind(me.id, book.id).run();
  } else {
    await db.prepare(`INSERT INTO book_notes (member_id, book_id, note) VALUES (?, ?, ?)
      ON CONFLICT (member_id, book_id) DO UPDATE SET note = excluded.note, updated_at = datetime('now')`).bind(me.id, book.id, note).run();
  }
  return json({ ok: true });
});

// ------------------------------------------------------------ reading schedule (on /members/current)

const scheduleOf = (db, bookId) =>
  db.prepare('SELECT unit, start_at, end_at, due_date FROM reading_sections WHERE book_id = ? ORDER BY position')
    .bind(bookId).all().then((r) => r.results);

route('GET', '/api/books/:id/schedule', async ({ db, params }) => json({ sections: await scheduleOf(db, params.id) }));

// Admins: replace a book's whole schedule; an empty list clears it.
route('PUT', '/api/books/:id/schedule', async ({ db, me, params, body }) => {
  if (!isAdmin(me)) return ADMINS_ONLY();
  const book = await db.prepare('SELECT id FROM books_read WHERE id = ?').bind(params.id).first();
  if (!book) return bad('no such book', 404);
  const { sections, error } = cleanSchedule(body.sections);
  if (error) return bad(error);
  await db.batch([
    db.prepare('DELETE FROM reading_sections WHERE book_id = ?').bind(book.id),
    ...sections.map((s, i) => db.prepare('INSERT INTO reading_sections (book_id, position, unit, start_at, end_at, due_date) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(book.id, i, s.unit, s.start_at, s.end_at, s.due_date)),
  ]);
  return json({ sections: await scheduleOf(db, book.id) });
});

// ------------------------------------------------------------ tier lists

const TIERS = ['S', 'A', 'B', 'C', 'D', 'F', 'N']; // N = didn't read

async function tiersOf(db, memberId) {
  const rows = (await db.prepare(`SELECT t.tier, t.book_id, b.title, b.author, b.cover_url FROM tier_entries t
    JOIN books_read b ON b.id = t.book_id WHERE t.member_id = ? ORDER BY t.position`).bind(memberId).all()).results;
  return Object.fromEntries(TIERS.map((t) => [t, withCovers(rows.filter((r) => r.tier === t), 'book_id')]));
}

// Replace your whole tier list: { tiers: { S: [bookId, ...], A: [...], ... } }, best first.
route('PUT', '/api/me/tiers', async ({ db, me, body }) => {
  const input = body.tiers && typeof body.tiers === 'object' ? body.tiers : null;
  if (!input) return bad('tiers required');
  const valid = new Set((await db.prepare('SELECT id FROM books_read').all()).results.map((r) => r.id));
  const seen = new Set();
  const entries = [];
  for (const tier of TIERS) {
    for (const id of Array.isArray(input[tier]) ? input[tier] : []) {
      if (!valid.has(id) || seen.has(id)) return bad('invalid tier list');
      seen.add(id);
      entries.push([tier, id]);
    }
  }
  await db.batch([
    db.prepare('DELETE FROM tier_entries WHERE member_id = ?').bind(me.id),
    ...entries.map(([tier, id], i) =>
      db.prepare('INSERT INTO tier_entries (member_id, book_id, tier, position) VALUES (?, ?, ?, ?)').bind(me.id, id, tier, i)),
  ]);
  return json({ ok: true });
});

// Everyone's tier lists at once, for the club tier list and taste map.
route('GET', '/api/tiers', async ({ db }) => {
  const books = withCovers((await db.prepare('SELECT id, position, title, author, cover_url FROM books_read ORDER BY position').all()).results);
  const members = (await db.prepare(`SELECT id, name, first_name FROM members
    WHERE id IN (SELECT DISTINCT member_id FROM tier_entries) ORDER BY name`).all()).results;
  const entries = (await db.prepare('SELECT member_id, book_id, tier FROM tier_entries ORDER BY member_id, position').all()).results;
  return json({ books, members, entries });
});

// ------------------------------------------------------------ tags (on /members/almanac)

const tagsAll = async (db) => ({
  tags: (await db.prepare('SELECT t.id, t.name, t.created_by, m.name AS created_by_name FROM tags t LEFT JOIN members m ON m.id = t.created_by ORDER BY t.name').all()).results,
  book_tags: (await db.prepare('SELECT bt.book_id, bt.tag_id, bt.tagged_by, m.name AS tagged_by_name FROM book_tags bt LEFT JOIN members m ON m.id = bt.tagged_by').all()).results,
});

route('GET', '/api/tags', async ({ db }) => json(await tagsAll(db)));

route('POST', '/api/tags', async ({ db, me, body }) => {
  const name = str(body.name, 40).replace(/\s+/g, ' ');
  if (!name) return bad('enter a tag');
  const found = await db.prepare('SELECT id FROM tags WHERE name = ?').bind(name).first();
  if (!found) await db.prepare('INSERT INTO tags (name, created_by) VALUES (?, ?)').bind(name, me.id).run();
  return json(await tagsAll(db));
});

route('DELETE', '/api/tags/:id', async ({ db, params }) => {
  await db.batch([
    db.prepare('DELETE FROM book_tags WHERE tag_id = ?').bind(params.id),
    db.prepare('DELETE FROM tags WHERE id = ?').bind(params.id),
  ]);
  return json(await tagsAll(db));
});

route('PUT', '/api/books/:id/tags/:tag', async ({ db, me, params }) => {
  const ok = await db.prepare('SELECT (SELECT 1 FROM books_read WHERE id = ?) AS b, (SELECT 1 FROM tags WHERE id = ?) AS t').bind(params.id, params.tag).first();
  if (!ok?.b || !ok?.t) return bad('no such book or tag', 404);
  await db.prepare('INSERT OR IGNORE INTO book_tags (book_id, tag_id, tagged_by) VALUES (?, ?, ?)').bind(params.id, params.tag, me.id).run();
  return json(await tagsAll(db));
});

route('DELETE', '/api/books/:id/tags/:tag', async ({ db, params }) => {
  // a tag left on no books goes away
  await db.batch([
    db.prepare('DELETE FROM book_tags WHERE book_id = ? AND tag_id = ?').bind(params.id, params.tag),
    db.prepare('DELETE FROM tags WHERE id = ? AND NOT EXISTS (SELECT 1 FROM book_tags WHERE tag_id = ?)').bind(params.tag, params.tag),
  ]);
  return json(await tagsAll(db));
});

// A member's profile as other members see it (no password info).
route('GET', '/api/members/:id', async ({ db, params }) => {
  const m = await db.prepare(`SELECT m.id, m.name, m.first_name, m.discord, m.created_at, m.storygraph_url, m.goodreads_url,
      m.favorite_book_id, b.title AS favorite_title, b.cover_url AS favorite_cover FROM members m LEFT JOIN books_read b ON b.id = m.favorite_book_id
      WHERE m.id = ?`).bind(params.id).first();
  if (!m) return bad('no such member', 404);
  const notes = (await db.prepare(`SELECT n.book_id, n.note, n.updated_at, b.position, b.title, b.author, b.cover_url
    FROM book_notes n JOIN books_read b ON b.id = n.book_id WHERE n.member_id = ? ORDER BY b.position`).bind(m.id).all()).results;
  const wantToRead = (await db.prepare(`SELECT id, title, author, ol_key, cover_id, year, added_at FROM want_to_read
    WHERE member_id = ? ORDER BY added_at DESC, id DESC`).bind(m.id).all()).results;
  // debt and weight going into the first election, then after each one
  const history = await closedHistory(db);
  const steps = trace(history, String(m.id), await startState(db));
  const debtHistory = steps.map((s, i) => ({ ...s, election_id: history[i - 1]?.id ?? null, title: history[i - 1]?.title ?? null }));
  return json({ member: withCover(m, 'favorite_book_id', 'favorite_cover'), tiers: await tiersOf(db, m.id), notes: withCovers(notes, 'book_id'), wantToRead, debtHistory });
});

// Current debt/weight standings, for transparency.
route('GET', '/api/standings', async ({ db }) => {
  const members = (await db.prepare(`SELECT m.id, m.name, (SELECT COUNT(*) FROM ballots b JOIN elections e ON e.id = b.election_id
      WHERE b.member_id = m.id AND e.status = 'closed') AS voted FROM members m WHERE m.active = 1 ORDER BY m.name`).all()).results;
  const st = await debtState(db);
  const ids = members.map((m) => String(m.id));
  const debts = debtsFor(st, ids), weights = weightsFor(st, ids);
  return json({
    params: DEBT_PARAMS,
    members: members.map((m) => {
      const k = String(m.id);
      return { id: m.id, name: m.name, debt: debts[k], newcomer: !(k in st.debt), voted: m.voted,
        attendance: attendance(st, k), weight: weights[k] };
    }),
  });
});

route('GET', '/api/elections', async ({ db }) => {
  const rows = (await db.prepare(`
    SELECT e.id, e.title, e.method, e.status, e.created_at, e.closed_at, w.title AS winner,
      (SELECT COUNT(*) FROM candidates c WHERE c.election_id = e.id) AS n_candidates,
      (SELECT COUNT(*) FROM ballots b WHERE b.election_id = e.id) AS n_ballots
    FROM elections e LEFT JOIN candidates w ON w.id = e.winner_id
    ORDER BY e.status = 'closed', e.id DESC`).all()).results;
  return json({ elections: rows, methods: METHODS });
});

route('POST', '/api/elections', async ({ db, body }) => {
  const title = str(body.title, 120);
  const method = body.method in METHODS ? body.method : 'debt-star';
  if (!title) return bad('title required');
  const r = await db.prepare('INSERT INTO elections (title, method) VALUES (?, ?) RETURNING id').bind(title, method).first();
  return json(r, 201);
});

route('GET', '/api/elections/:id', async ({ db, params, me }) => {
  const e = await getElection(db, params.id);
  if (!e) return bad('no such election', 404);
  const candidates = await candidatesOf(db, e.id);
  const ballots = await ballotsOf(db, e.id);
  // While voting is open, show who has voted but not how, except to admins, who also get the count so far.
  // Members who have voted get the standings so far, without anyone's ballot, weight or debt.
  const admin = isAdmin(me);
  const hasVoted = !!me && ballots.some((b) => b.member_id === me.id);
  const shown = e.status === 'closed' || admin ? ballots : ballots.map(({ member_id, name, updated_at }) => ({ member_id, name, updated_at }));
  const counting = (admin || hasVoted) && e.status === 'voting' && ballots.length && candidates.length;
  const live = counting ? (admin ? await count(db, e) : standings(await count(db, e))) : null;
  const book = e.status === 'closed' ? await db.prepare('SELECT id, position, title FROM books_read WHERE election_id = ?').bind(e.id).first() : null;
  return json({ election: e, methods: METHODS, candidates, ballots: shown, live, book });
});

route('PATCH', '/api/elections/:id', async ({ db, params, body }) => {
  const e = await getElection(db, params.id);
  if (!e) return bad('no such election', 404);
  if (e.status === 'closed') return bad('election is closed');
  if (body.status && ['nominating', 'voting'].includes(body.status)) {
    if (body.status === 'voting' && (await candidatesOf(db, e.id)).length < 2) return bad('need at least two books first');
    await db.prepare('UPDATE elections SET status = ? WHERE id = ?').bind(body.status, e.id).run();
  }
  if (body.title) await db.prepare('UPDATE elections SET title = ? WHERE id = ?').bind(str(body.title, 120), e.id).run();
  if (body.method in METHODS) await db.prepare('UPDATE elections SET method = ? WHERE id = ?').bind(body.method, e.id).run();
  return json({ ok: true });
});

route('DELETE', '/api/elections/:id', async ({ db, params }) => {
  const e = await getElection(db, params.id);
  if (!e) return bad('no such election', 404);
  if (e.status === 'closed') return bad('closed elections are part of the debt history and cannot be deleted');
  await db.batch([
    db.prepare('DELETE FROM ballots WHERE election_id = ?').bind(e.id),
    db.prepare('DELETE FROM candidates WHERE election_id = ?').bind(e.id),
    db.prepare('DELETE FROM elections WHERE id = ?').bind(e.id),
  ]);
  return json({ ok: true });
});

route('POST', '/api/elections/:id/candidates', async ({ db, params, body, me }) => {
  const e = await getElection(db, params.id);
  if (!e) return bad('no such election', 404);
  if (e.status !== 'nominating') return bad('nominations are closed');
  const title = str(body.title, 200);
  if (!title) return bad('title required');
  const int = (v) => (Number.isInteger(v) ? v : null);
  // Admins can enter a nomination on someone else's behalf.
  let nominator = me.id;
  if (body.nominator_id != null && body.nominator_id !== me.id) {
    if (!isAdmin(me)) return ADMINS_ONLY();
    if (!(await memberExists(db, body.nominator_id))) return bad('no such member');
    nominator = body.nominator_id;
  }
  const r = await db.prepare(`INSERT INTO candidates (election_id, title, author, nominator_id, ol_key, cover_id, isbn, year, pitch)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`).bind(e.id, title, str(body.author, 200) || null,
    nominator, str(body.ol_key, 60) || null, int(body.cover_id), str(body.isbn, 20) || null,
    int(body.year), str(body.pitch, 1000) || null).first();
  return json(r, 201);
});

// Admins: fix a book's details or nominator. Ballots are keyed by candidate id, so votes carry over.
route('PATCH', '/api/elections/:id/candidates/:cid', async ({ db, params, body, me }) => {
  if (!isAdmin(me)) return ADMINS_ONLY();
  const e = await getElection(db, params.id);
  if (!e) return bad('no such election', 404);
  if (e.status === 'closed') return bad('election is closed');
  const sets = [], vals = [];
  const set = (col, v) => { sets.push(`${col} = ?`); vals.push(v); };
  if ('title' in body) { const t = str(body.title, 200); if (!t) return bad('title required'); set('title', t); }
  for (const [f, max] of [['author', 200], ['pitch', 1000], ['isbn', 20], ['ol_key', 60]]) if (f in body) set(f, str(body[f], max) || null);
  for (const f of ['year', 'cover_id']) {
    if (!(f in body)) continue;
    if (body[f] != null && body[f] !== '' && !Number.isInteger(body[f])) return bad(`${f} must be a whole number`);
    set(f, Number.isInteger(body[f]) ? body[f] : null);
  }
  if ('nominator_id' in body) {
    if (body.nominator_id != null && !(await memberExists(db, body.nominator_id))) return bad('no such member');
    set('nominator_id', body.nominator_id ?? null);
  }
  if (!sets.length) return bad('nothing to update');
  const r = await db.prepare(`UPDATE candidates SET ${sets.join(', ')} WHERE id = ? AND election_id = ?`).bind(...vals, params.cid, e.id).run();
  if (!r.meta.changes) return bad('no such book', 404);
  return json({ ok: true });
});

route('DELETE', '/api/elections/:id/candidates/:cid', async ({ db, params }) => {
  const e = await getElection(db, params.id);
  if (!e) return bad('no such election', 404);
  if (e.status !== 'nominating') return bad('books can only be removed while nominating');
  await db.prepare('DELETE FROM candidates WHERE id = ? AND election_id = ?').bind(params.cid, e.id).run();
  return json({ ok: true });
});

route('GET', '/api/elections/:id/ballot', async ({ db, params, me }) => {
  if (!me) return SIGNED_OUT();
  const b = await db.prepare('SELECT scores FROM ballots WHERE election_id = ? AND member_id = ?').bind(params.id, me.id).first();
  return json({ scores: b ? JSON.parse(b.scores) : null });
});

route('PUT', '/api/elections/:id/ballot', async ({ db, params, body, me }) => {
  const e = await getElection(db, params.id);
  if (!e) return bad('no such election', 404);
  if (e.status !== 'voting') return bad('voting is not open');
  const cands = await candidatesOf(db, e.id);
  const scores = {};
  for (const c of cands) {
    const v = body.scores?.[c.id];
    if (!Number.isInteger(v) || v < 0 || v > 5) return bad(`score every book 0-5 (missing: ${c.title})`);
    scores[c.id] = v;
  }
  await db.prepare(`INSERT INTO ballots (election_id, member_id, scores) VALUES (?, ?, ?)
    ON CONFLICT (election_id, member_id) DO UPDATE SET scores = excluded.scores, updated_at = datetime('now')`)
    .bind(e.id, me.id, JSON.stringify(scores)).run();
  return json({ ok: true });
});

route('DELETE', '/api/elections/:id/ballot', async ({ db, params, me }) => {
  const e = await getElection(db, params.id);
  if (e?.status !== 'voting') return bad('voting is not open');
  await db.prepare('DELETE FROM ballots WHERE election_id = ? AND member_id = ?').bind(params.id, me.id).run();
  return json({ ok: true });
});

// Admins: remove someone's ballot (a duplicate or test vote, say).
route('DELETE', '/api/elections/:id/ballots/:mid', async ({ db, params, me }) => {
  if (!isAdmin(me)) return ADMINS_ONLY();
  const e = await getElection(db, params.id);
  if (e?.status !== 'voting') return bad('voting is not open');
  await db.prepare('DELETE FROM ballots WHERE election_id = ? AND member_id = ?').bind(e.id, params.mid).run();
  return json({ ok: true });
});

// Count the votes.
async function count(db, e) {
  const cands = await candidatesOf(db, e.id);
  const ballots = (await ballotsOf(db, e.id)).map((b) => ({ voter: String(b.member_id), scores: b.scores }));
  const state = await debtState(db, e.id);
  return tally({ method: e.method, candidates: cands.map((c) => String(c.id)), ballots, seed: `election-${e.id}` }, state);
}

route('POST', '/api/elections/:id/close', async ({ db, params, body }) => {
  const e = await getElection(db, params.id);
  if (!e) return bad('no such election', 404);
  if (e.status !== 'voting') return bad('can only close an election that is voting');
  const result = await count(db, e);
  if (!result.voters) return bad('nobody has voted yet');
  const winner = await db.prepare('SELECT * FROM candidates WHERE id = ?').bind(Number(result.winner)).first();
  const stmts = [db.prepare(`UPDATE elections SET status = 'closed', closed_at = datetime('now'), winner_id = ?, result = ? WHERE id = ?`)
    .bind(winner.id, JSON.stringify(result), e.id)];
  if (body.addToHistory !== false) {
    const nominator = winner.nominator_id
      ? (await db.prepare('SELECT name FROM members WHERE id = ?').bind(winner.nominator_id).first())?.name : null;
    stmts.push(db.prepare(`INSERT INTO books_read (position, title, author, nominator, read_date, notes, election_id)
      VALUES ((SELECT COALESCE(MAX(position), 0) + 1 FROM books_read), ?, ?, ?, strftime('%Y-%m', 'now'), ?, ?)`)
      .bind(winner.title, winner.author, nominator, `${METHODS[e.method]}: "${e.title}"`, e.id));
  }
  await db.batch(stmts);
  return json({ ok: true, winner: winner.title });
});

// ------------------------------------------------------------ dispatch

const ACCOUNTLESS = ['/api/login', '/api/logout', '/api/accounts', '/api/accounts/login', '/api/accounts/logout'];

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  for (const r of routes) {
    const m = r.method === request.method && url.pathname.match(r.re);
    if (!m) continue;
    let body = {};
    if (!['GET', 'HEAD', 'DELETE'].includes(request.method)) {
      try { body = await request.json(); } catch { body = {}; }
    }
    try {
      const me = await currentAccount(request, env, env.DB);
      // Every change needs an account, except signing in/out and creating one.
      if (request.method !== 'GET' && !me && !ACCOUNTLESS.includes(url.pathname)) return SIGNED_OUT();
      return await r.fn({ request, env, db: env.DB, params: m.groups || {}, body, url, me });
    } catch (err) {
      console.error(err);
      return bad('server error: ' + err.message, 500);
    }
  }
  return bad('not found', 404);
}
