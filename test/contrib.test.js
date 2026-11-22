import test from 'node:test';
import assert from 'node:assert/strict';
import { contributions, voterColors } from '../public/members/contrib.js';
import { weightedStar } from '../src/tally.js';

const ballots = [
  { member_id: 1, scores: { 10: 5, 11: 2, 12: 0 } },
  { member_id: 2, scores: { 10: 1, 11: 4, 12: 3 } },
  { member_id: 3, scores: { 10: 3, 11: 3 } },
];
const candidates = [{ id: 10 }, { id: 11 }, { id: 12 }];
const weights = { 1: 1.5, 2: 0.5, 3: 1 };

test('scoring parts are weight x score per voter, zero scores left out, and add up to the totals', () => {
  const { scoring } = contributions(candidates, ballots, weights, ['10', '11']);
  assert.deepEqual(scoring['10'].map((p) => [p.voter, p.value]), [['1', 7.5], ['2', 0.5], ['3', 3]]);
  assert.deepEqual(scoring['12'].map((p) => p.voter), ['2']);
  const r = weightedStar(['10', '11', '12'], ballots.map((b) => ({ voter: String(b.member_id), scores: b.scores })), weights);
  for (const c of ['10', '11', '12']) assert.equal(scoring[c].reduce((s, p) => s + p.value, 0), r.totals[c]);
});

test('runoff parts put each weight on the preferred finalist, ties under none, and match the runoff', () => {
  const { runoff } = contributions(candidates, ballots, weights, ['10', '11']);
  assert.deepEqual(runoff['10'].map((p) => p.voter), ['1']);
  assert.deepEqual(runoff['11'].map((p) => p.voter), ['2']);
  assert.deepEqual(runoff.none.map((p) => [p.voter, p.value]), [['3', 1]]);
  const r = weightedStar(['10', '11', '12'], ballots.map((b) => ({ voter: String(b.member_id), scores: b.scores })), weights);
  const sum = (xs) => xs.reduce((s, p) => s + p.value, 0);
  assert.equal(sum(runoff[r.finalists[0]]), r.runoff[r.finalists[0]]);
  assert.equal(sum(runoff[r.finalists[1]]), r.runoff[r.finalists[1]]);
  assert.equal(sum(runoff.none), r.runoff.noPreference);
});

test('missing weights count as 1; no runoff with fewer than two finalists', () => {
  const { scoring, runoff } = contributions(candidates, ballots, {}, ['10']);
  assert.equal(scoring['10'][0].value, 5);
  assert.equal(runoff, null);
});

test('every voter gets a different color', () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ member_id: i + 1 }));
  const colors = voterColors(many);
  assert.equal(Object.keys(colors).length, 30);
  assert.equal(new Set(Object.values(colors)).size, 30);
});
