import test from 'node:test';
import assert from 'node:assert/strict';
import { pairwise, condorcetWinner, smithSet, schwartzSet, copeland, minimax, rankedPairs, schulze, analyze } from '../public/members/condorcet.js';

// Turn ranked ballots ("ACBED" x 5) into score ballots: first place gets the top score.
const ranked = (groups) => groups.flatMap(([order, n], g) => Array.from({ length: n }, (_, i) => ({
  voter: `${g}-${i}`,
  scores: Object.fromEntries([...order].map((c, k) => [c, order.length - 1 - k])),
})));

test('pairwise counts weighted strict preferences; equal scores count for neither', () => {
  const ballots = [{ voter: 'x', scores: { a: 5, b: 3 } }, { voter: 'y', scores: { a: 2, b: 2 } }, { voter: 'z', scores: { b: 1 } }];
  const d = pairwise(['a', 'b'], ballots, { x: 2 });
  assert.equal(d.a.b, 2);
  assert.equal(d.b.a, 1);
});

test('Tennessee capital: Nashville is the Condorcet winner, and every method agrees', () => {
  const ballots = ranked([['MNCK', 42], ['NCKM', 26], ['CKNM', 15], ['KCNM', 17]]);
  const ids = ['M', 'N', 'C', 'K'];
  const d = pairwise(ids, ballots);
  assert.equal(condorcetWinner(ids, d), 'N');
  assert.deepEqual(smithSet(ids, d), ['N']);
  assert.deepEqual(schwartzSet(ids, d), ['N']);
  for (const m of analyze(ids, ballots, {}).methods) assert.deepEqual(m.winners, ['N'], m.label);
});

test('Schulze example (Wikipedia): a five-way cycle', () => {
  const ballots = ranked([['ACBED', 5], ['ADECB', 5], ['BEDAC', 8], ['CABED', 3], ['CAEBD', 7], ['CBADE', 2], ['DCEBA', 7], ['EBADC', 8]]);
  const ids = ['A', 'B', 'C', 'D', 'E'];
  const d = pairwise(ids, ballots);
  assert.equal(condorcetWinner(ids, d), null);
  assert.equal(smithSet(ids, d).length, 5);
  assert.deepEqual(schulze(ids, d), ['E']);
  assert.deepEqual(rankedPairs(ids, d), ['A']);
});

test('rock, paper, scissors: an exact three-way tie stays a tie', () => {
  const ballots = ranked([['RSP', 1], ['SPR', 1], ['PRS', 1]]);
  const ids = ['R', 'P', 'S'];
  const d = pairwise(ids, ballots);
  assert.equal(condorcetWinner(ids, d), null);
  assert.deepEqual(copeland(ids, d), ids);
  assert.deepEqual(minimax(ids, d), ids);
  assert.deepEqual(schulze(ids, d), ids);
});

test('Schwartz set can be smaller than the Smith set when there are head-to-head ties', () => {
  // a ties b, a beats c, c beats b: Smith = all three, Schwartz = {a}
  const d = { a: { b: 1, c: 2 }, b: { a: 1, c: 0 }, c: { a: 0, b: 2 } };
  const ids = ['a', 'b', 'c'];
  assert.deepEqual(smithSet(ids, d), ['a', 'b', 'c']);
  assert.deepEqual(schwartzSet(ids, d), ['a']);
});

test('a filter limits the field the methods choose from', () => {
  // d beats nobody, so restricting to the Smith set removes it
  const ballots = ranked([['abcd', 1], ['bcad', 1], ['cabd', 1]]);
  const r = analyze(['a', 'b', 'c', 'd'], ballots, {}, 'smith');
  assert.deepEqual(r.field, ['a', 'b', 'c']);
  assert.deepEqual(r.methods.find((m) => m.key === 'copeland').winners, ['a', 'b', 'c']);
});
