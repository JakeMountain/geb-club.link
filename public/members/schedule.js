// Reading schedule helpers for /members/current. Pure functions (tested in test/schedule.test.js).
// Dates are 'YYYY-MM-DD' strings, worked on in UTC so time zones never shift a day.

const parse = (d) => new Date(`${d}T00:00:00Z`);
const iso = (t) => t.toISOString().slice(0, 10);

export const addDays = (d, n) => { const t = parse(d); t.setUTCDate(t.getUTCDate() + n); return iso(t); };

/** Day of the week, 0 = Monday ... 6 = Sunday. */
export const weekday = (d) => (parse(d).getUTCDay() + 6) % 7;

/** The first Monday after d. */
export const nextMonday = (d) => addDays(d, 7 - weekday(d));

/** Today's date where the browser is. */
export function today(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/**
 * Split a page count into sections of about perMeeting pages, one per weekly meeting
 * starting at firstDate. Returns [{ unit: 'page', start_at, end_at, due_date }].
 */
export function splitPages(pages, firstDate, perMeeting = 125) {
  pages = Math.floor(pages);
  if (!(pages > 0) || !(perMeeting > 0)) return [];
  const n = Math.max(1, Math.round(pages / perMeeting));
  const out = [];
  let start = 1;
  for (let i = 1; i <= n; i++) {
    const end = Math.round((pages * i) / n);
    out.push({ unit: 'page', start_at: String(start), end_at: String(end), due_date: addDays(firstDate, 7 * (i - 1)) });
    start = end + 1;
  }
  return out;
}

/** "Chapters 1–5", "Chapter 3", "Pages 1–125". */
export function sectionLabel(s) {
  const one = s.unit === 'page' ? 'Page' : 'Chapter';
  return s.start_at === s.end_at || !s.end_at ? `${one} ${s.start_at}` : `${one}s ${s.start_at}–${s.end_at}`;
}

/** "Mon, Nov 16" (with the year when it isn't thisYear). */
export function formatDate(d, thisYear) {
  const t = parse(d);
  const opts = { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' };
  if (thisYear && t.getUTCFullYear() !== Number(thisYear)) opts.year = 'numeric';
  return t.toLocaleDateString('en-US', opts);
}

/**
 * Month calendars covering every due date: [{ year, month (1-12), title, weeks }],
 * where weeks is a list of 7 days (Monday first), each a 'YYYY-MM-DD' or null outside the month.
 */
export function calendarMonths(dates) {
  const sorted = [...dates].filter(Boolean).sort();
  if (!sorted.length) return [];
  let [y, m] = sorted[0].split('-').map(Number);
  const [ly, lm] = sorted.at(-1).split('-').map(Number);
  const months = [];
  while (y < ly || (y === ly && m <= lm)) {
    const first = `${y}-${String(m).padStart(2, '0')}-01`;
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const cells = [...Array(weekday(first)).fill(null), ...Array.from({ length: days }, (_, i) => addDays(first, i))];
    while (cells.length % 7) cells.push(null);
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    const title = parse(first).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    months.push({ year: y, month: m, title, weeks });
    if (++m > 12) { m = 1; y++; }
  }
  return months;
}
