import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, weekday, nextMonday, splitPages, sectionLabel, calendarMonths } from '../public/members/schedule.js';
import { cleanSchedule, isDate } from '../src/schedule.js';

test('dates: weekday is Monday-first, nextMonday is strictly after', () => {
  assert.equal(weekday('2026-11-09'), 0); // a Monday
  assert.equal(weekday('2026-11-15'), 6);
  assert.equal(nextMonday('2026-11-10'), '2026-11-16');
  assert.equal(nextMonday('2026-11-09'), '2026-11-16');
  assert.equal(addDays('2026-12-28', 7), '2027-01-04');
});

test('splitPages: even chunks of about the target, weekly, covering every page', () => {
  const s = splitPages(777, '2026-11-16');
  assert.equal(s.length, 6);
  assert.equal(s[0].start_at, '1');
  assert.equal(s.at(-1).end_at, '777');
  assert.deepEqual(s.map((x) => x.due_date), ['2026-11-16', '2026-11-23', '2026-11-30', '2026-12-07', '2026-12-14', '2026-12-21']);
  for (let i = 1; i < s.length; i++) assert.equal(Number(s[i].start_at), Number(s[i - 1].end_at) + 1);
  for (const x of s) {
    const len = Number(x.end_at) - Number(x.start_at) + 1;
    assert.ok(len >= 100 && len <= 150, `chunk of ${len}`);
    assert.equal(x.unit, 'page');
  }
  assert.equal(splitPages(60, '2026-11-16').length, 1);
  assert.equal(splitPages(300, '2026-11-16', 100).length, 3);
  assert.deepEqual(splitPages(0, '2026-11-16'), []);
  assert.deepEqual(splitPages(NaN, '2026-11-16'), []);
});

test('sectionLabel', () => {
  assert.equal(sectionLabel({ unit: 'chapter', start_at: '1', end_at: '5' }), 'Chapters 1–5');
  assert.equal(sectionLabel({ unit: 'chapter', start_at: '3', end_at: '3' }), 'Chapter 3');
  assert.equal(sectionLabel({ unit: 'page', start_at: '1', end_at: '125' }), 'Pages 1–125');
});

test('calendarMonths: every month from first to last date, weeks start Monday', () => {
  const months = calendarMonths(['2026-12-21', '2026-11-16', '2027-01-04']);
  assert.deepEqual(months.map((m) => [m.year, m.month]), [[2026, 11], [2026, 12], [2027, 1]]);
  const nov = months[0];
  assert.equal(nov.title, 'November 2026');
  assert.deepEqual(nov.weeks[0], [null, null, null, null, null, null, '2026-11-01']); // Nov 1 2026 is a Sunday
  assert.ok(nov.weeks.every((w) => w.length === 7));
  assert.equal(nov.weeks.flat().filter(Boolean).length, 30);
  assert.deepEqual(calendarMonths([]), []);
});

test('cleanSchedule: checks each section, fills an empty end', () => {
  assert.ok(isDate('2026-11-16'));
  assert.ok(!isDate('2026-02-30'));
  assert.ok(!isDate('11/16/2026'));
  const ok = cleanSchedule([{ unit: 'chapter', start_at: ' 1 ', end_at: '5', due_date: '2026-11-16' }, { unit: 'page', start_at: 200, end_at: '', due_date: '2026-11-23' }]);
  assert.deepEqual(ok.sections, [
    { unit: 'chapter', start_at: '1', end_at: '5', due_date: '2026-11-16' },
    { unit: 'page', start_at: '200', end_at: '200', due_date: '2026-11-23' },
  ]);
  assert.deepEqual(cleanSchedule([]), { sections: [] });
  assert.match(cleanSchedule(null).error, /required/);
  assert.match(cleanSchedule([{ unit: 'verse', start_at: '1', due_date: '2026-11-16' }]).error, /section 1/);
  assert.match(cleanSchedule([{ unit: 'page', start_at: '', due_date: '2026-11-16' }]).error, /starts/);
  assert.match(cleanSchedule([{ unit: 'page', start_at: '1', due_date: 'soon' }]).error, /date/);
});
