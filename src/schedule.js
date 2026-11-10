// Checks a reading schedule sent by the current book page before it is saved.

export const UNITS = ['chapter', 'page'];
export const MAX_SECTIONS = 60;

export function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === s;
}

const text = (v) => (typeof v === 'string' ? v.trim().slice(0, 40) : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

/**
 * sections: [{ unit, start_at, end_at, due_date }] in reading order.
 * Returns { sections } cleaned up, or { error }. An empty end means the section is one chapter or page.
 */
export function cleanSchedule(sections) {
  if (!Array.isArray(sections)) return { error: 'sections required' };
  if (sections.length > MAX_SECTIONS) return { error: `at most ${MAX_SECTIONS} sections` };
  const out = [];
  for (const [i, s] of sections.entries()) {
    const n = i + 1;
    const unit = UNITS.includes(s?.unit) ? s.unit : null;
    if (!unit) return { error: `section ${n}: pick chapters or pages` };
    const start_at = text(s.start_at);
    if (!start_at) return { error: `section ${n}: enter where it starts` };
    const end_at = text(s.end_at) || start_at;
    if (!isDate(s.due_date)) return { error: `section ${n}: enter a date` };
    out.push({ unit, start_at, end_at, due_date: s.due_date });
  }
  return { sections: out };
}
