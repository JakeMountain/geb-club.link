// PUT /api/books/:id/schedule: any signed-in member can set or clear it; signed-out requests can't.
import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/[[path]].js';
import { accountCookie } from '../src/auth.js';

const env = { CLUB_PASSWORD: 'pw', SESSION_SECRET: 'secret' };

// Just enough of D1 for the schedule routes and the account lookup.
function fakeDb() {
  const members = [
    { id: 1, name: 'Member', is_admin: 0, pw_hash: 'h', pw_salt: 's' },
    { id: 2, name: 'Admin', is_admin: 1, pw_hash: 'h', pw_salt: 's' },
  ];
  const books = [{ id: 7 }];
  let sections = [];
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    async first() {
      if (/FROM members WHERE id = \?/.test(sql)) return members.find((m) => m.id === Number(args[0])) ?? null;
      if (/FROM books_read WHERE id = \?/.test(sql)) return books.find((b) => b.id === Number(args[0])) ?? null;
      throw new Error(`unexpected first(): ${sql}`);
    },
    async all() {
      if (/FROM reading_sections WHERE book_id = \?/.test(sql)) {
        return { results: sections.filter((s) => s.book_id === Number(args[0])).sort((a, b) => a.position - b.position)
          .map(({ unit, start_at, end_at, due_date }) => ({ unit, start_at, end_at, due_date })) };
      }
      throw new Error(`unexpected all(): ${sql}`);
    },
    async run() {
      if (/^DELETE FROM reading_sections/.test(sql)) sections = sections.filter((s) => s.book_id !== Number(args[0]));
      else if (/^INSERT INTO reading_sections/.test(sql)) {
        const [book_id, position, unit, start_at, end_at, due_date] = args;
        sections.push({ book_id: Number(book_id), position, unit, start_at, end_at, due_date });
      } else throw new Error(`unexpected run(): ${sql}`);
    },
  });
  return { prepare: (sql) => stmt(sql), batch: async (list) => { for (const s of list) await s.run(); } };
}

const cookieFor = async (m) => (await accountCookie(env, m)).split(';')[0];
const put = (DB, sections, cookie) => onRequest({
  env: { ...env, DB },
  request: new Request('https://geb-club.link/api/books/7/schedule', {
    method: 'PUT', body: JSON.stringify({ sections }),
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
  }),
});

const week1 = [{ unit: 'chapter', start_at: '1', end_at: '5', due_date: '2026-11-30' }];

test('schedule: a signed-in member who is not an admin can set and clear it', async () => {
  const DB = fakeDb();
  const cookie = await cookieFor({ id: 1, pw_hash: 'h' });
  let res = await put(DB, week1, cookie);
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).sections, week1);
  res = await put(DB, [], cookie);
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).sections, []);
});

test('schedule: an admin can still set it', async () => {
  const res = await put(fakeDb(), week1, await cookieFor({ id: 2, pw_hash: 'h' }));
  assert.equal(res.status, 200);
});

test('schedule: signed out, or with a bad account cookie, is refused', async () => {
  const DB = fakeDb();
  let res = await put(DB, week1, null);
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /sign in/);
  res = await put(DB, week1, 'geb_account=1.00ff');
  assert.equal(res.status, 403);
});

test('schedule: still checked before saving', async () => {
  const res = await put(fakeDb(), [{ unit: 'verse', start_at: '1', due_date: '2026-11-30' }], await cookieFor({ id: 1, pw_hash: 'h' }));
  assert.equal(res.status, 400);
});
