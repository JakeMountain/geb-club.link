import test from 'node:test';
import assert from 'node:assert/strict';
import { weightedStar, tally, replay, trace, applyRound, emptyState, weightsFor, happiness, standings, DEBT_PARAMS } from '../src/tally.js';

const B = (voter, scores) => ({ voter, scores });

test('plain STAR: runoff can overturn the score leader', () => {
  // A has the higher total thanks to one fan, but more voters prefer B.
  const ballots = [B('x', { A: 5, B: 0 }), B('y', { A: 3, B: 4 }), B('z', { A: 3, B: 4 })];
  const r = weightedStar(['A', 'B'], ballots);
  assert.equal(r.totals.A, 11);
  assert.equal(r.totals.B, 8);
  assert.equal(r.winner, 'B');
});

test('weights scale scores and runoff votes once each', () => {
  const ballots = [B('x', { A: 5, B: 0 }), B('y', { A: 0, B: 5 })];
  const r = weightedStar(['A', 'B'], ballots, { x: 2, y: 1 });
  assert.equal(r.totals.A, 10);
  assert.equal(r.runoff.A, 2);
  assert.equal(r.runoff.B, 1);
  assert.equal(r.winner, 'A');
});

test('scoring-round tie broken head-to-head', () => {
  // B and C tie for 2nd on totals (6 each); C beats B head-to-head 2-1.
  const ballots = [B('x', { A: 5, B: 4, C: 0 }), B('y', { A: 5, B: 1, C: 3 }), B('z', { A: 5, B: 1, C: 3 })];
  const r = weightedStar(['A', 'B', 'C'], ballots);
  assert.deepEqual(r.finalists, ['A', 'C']);
  assert.equal(r.tiebreaks[0].how, 'head-to-head wins among tied books');
});

test('runoff tie broken by score total, then five-stars', () => {
  const ballots = [B('x', { A: 5, B: 0 }), B('y', { A: 1, B: 2 })];
  const r = weightedStar(['A', 'B'], ballots);
  assert.equal(r.winner, 'A');
  assert.equal(r.tiebreaks[0].how, 'higher score total');

  const b2 = [B('x', { A: 5, B: 0 }), B('y', { A: 0, B: 4 }), B('z', { A: 0, B: 1 }), B('w', { A: 0, B: 0 })];
  // runoff A 1 vs B 2 → B wins outright; make a true tie instead:
  const b3 = [B('x', { A: 5, B: 3 }), B('y', { A: 3, B: 5 })];
  const r3 = weightedStar(['A', 'B'], b3);
  assert.equal(r3.tiebreaks[0].how, 'drawing lots');
  assert.equal(weightedStar(['A', 'B'], b3).winner, r3.winner, 'lots are deterministic');
  assert.equal(weightedStar(['A', 'B'], b2).winner, 'B');
});

test('debt goes to the unhappy, sums to zero, and raises their weight next time', () => {
  const st = emptyState();
  const cands = ['A', 'B'];
  applyRound(st, cands, [B('x', { A: 5, B: 0 }), B('y', { A: 5, B: 1 }), B('z', { A: 0, B: 5 })], 'A');
  assert.ok(st.debt.z > 0 && st.debt.x < 0);
  assert.ok(Math.abs(st.debt.x + st.debt.y + st.debt.z) < 1e-9);
  const w = weightsFor(st, ['x', 'y', 'z']);
  assert.ok(w.z > w.x);
});

test('newcomers start at median debt with reduced attendance weight', () => {
  const st = replay([{ candidates: ['A', 'B'], ballots: [B('x', { A: 5, B: 0 }), B('y', { A: 0, B: 5 }), B('z', { A: 4, B: 5 })], winner: 'A' }]);
  const w = weightsFor(st, ['new']);
  const med = [...Object.values(st.debt)].sort((a, b) => a - b)[1];
  assert.ok(Math.abs(w.new - DEBT_PARAMS.newcomerAttendance * Math.max(DEBT_PARAMS.floor, 1 + med)) < 1e-9);
});

test('plain STAR method ignores debt', () => {
  const st = emptyState();
  st.debt = { x: 5, y: -5 };
  const r = tally({ method: 'star', candidates: ['A', 'B'], ballots: [B('x', { A: 5, B: 0 }), B('y', { A: 0, B: 5 }), B('z', { A: 0, B: 5 })] }, st);
  assert.equal(r.winner, 'B');
  assert.deepEqual(r.weights, { x: 1, y: 1, z: 1 });
});

test('happiness is measured from your lowest score; stake is your spread / 5', () => {
  assert.deepEqual(happiness({ A: 0, B: 1, C: 2 }, 'A', ['A', 'B', 'C']), { happiness: 0, stake: 0.4 });
  assert.deepEqual(happiness({ A: 2, B: 3, C: 4 }, 'A', ['A', 'B', 'C']), { happiness: 0, stake: 0.4 });
  assert.deepEqual(happiness({ A: 2, B: 3, C: 4 }, 'B', ['A', 'B', 'C']), { happiness: 0.5, stake: 0.4 });
  assert.deepEqual(happiness({ A: 1, B: 1 }, 'A', ['A', 'B']), { happiness: 1, stake: 0 });
});

test('flat ballot does not move debt; others still sum to zero', () => {
  const st = emptyState({ founders: ['ana', 'ben', 'cal'] });
  applyRound(st, ['A', 'B', 'C'], [
    B('ana', { A: 1, B: 1, C: 1 }), B('ben', { A: 5, B: 3, C: 0 }), B('cal', { A: 0, B: 4, C: 5 })], 'B');
  assert.equal(st.debt.ana, 0);
  assert.ok(Math.abs(st.debt.ben - 0.1) < 1e-9 && Math.abs(st.debt.cal + 0.1) < 1e-9, JSON.stringify(st.debt));
});

test('a 2-4 ballot moves debt exactly like a 0-2 ballot', () => {
  const run = (ana) => {
    const st = emptyState({ founders: ['ana', 'ben'] });
    applyRound(st, ['A', 'B'], [B('ana', ana), B('ben', { A: 5, B: 0 })], 'A');
    return st.debt.ana;
  };
  assert.ok(Math.abs(run({ A: 0, B: 2 }) - run({ A: 2, B: 4 })) < 1e-9);
});

test('founding members start at weight 1; seeds set starting debt', () => {
  const st = emptyState({ founders: ['ana', 'ben'], seeds: { ben: 0.2 } });
  const w = weightsFor(st, ['ana', 'ben', 'new']);
  assert.equal(w.ana, 1);
  assert.ok(Math.abs(w.ben - 1.2) < 1e-9);
  assert.ok(Math.abs(w.new - DEBT_PARAMS.newcomerAttendance * (1 + 0.1)) < 1e-9, 'newcomer: median debt (0.1), reduced attendance');
});

test('trace follows one voter through each round', () => {
  const history = [
    { candidates: ['A', 'B'], ballots: [B('x', { A: 5, B: 0 }), B('y', { A: 0, B: 5 })], winner: 'A' },
    { candidates: ['A', 'B'], ballots: [B('x', { A: 5, B: 0 })], winner: 'A' },
  ];
  const start = { founders: ['x', 'y'] };
  const steps = trace(history, 'y', start);
  assert.equal(steps.length, 3);
  assert.deepEqual(steps[0], { debt: 0, weight: 1, voted: null });
  assert.equal(steps[1].voted, true);
  assert.ok(steps[1].debt > 0);            // y lost round one, so is owed
  assert.equal(steps[2].voted, false);
  assert.ok(Math.abs(steps[2].debt - steps[1].debt * DEBT_PARAMS.decay) < 1e-9);  // sat out: debt only decays
  const end = replay(history, start);
  assert.ok(Math.abs(steps[2].debt - end.debt.y) < 1e-9);
});

test('standings keep totals, runoff and winner but drop per-member weights and debts', () => {
  const st = emptyState();
  st.debt = { x: 1, y: -1 };
  const r = tally({ method: 'debt-star', candidates: ['A', 'B'], ballots: [B('x', { A: 5, B: 0 }), B('y', { A: 0, B: 5 })] }, st);
  const s = standings(r);
  assert.equal(s.winner, r.winner);
  assert.deepEqual(s.totals, r.totals);
  assert.deepEqual(s.runoff, r.runoff);
  assert.equal(s.voters, 2);
  assert.ok(!('weights' in s) && !('debts' in s));
  assert.ok(!/"[xy]"/.test(JSON.stringify(s)), 'no voter ids anywhere');
});
