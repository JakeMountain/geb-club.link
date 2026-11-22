import test from 'node:test';
import assert from 'node:assert/strict';
import { pairwise, condorcetWinner, smithSet, schwartzSet, copeland, minimax, rankedPairs, schulze, firstChoices, irv, smithIrv, tidemanAlternative, analyze } from '../public/members/condorcet.js';

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
  assert.deepEqual(smithIrv(ids, d, ballots), ids);
  assert.deepEqual(tidemanAlternative(ids, d, ballots), ids);
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

test('center squeeze: plain IRV drops the Condorcet winner, Smith/IRV and Tideman\'s alternative keep it', () => {
  const ballots = ranked([['LCR', 35], ['RCL', 33], ['CLR', 16], ['CRL', 16]]);
  const ids = ['L', 'C', 'R'];
  const d = pairwise(ids, ballots);
  assert.equal(condorcetWinner(ids, d), 'C');
  assert.deepEqual(irv(ids, ballots), ['L']);
  assert.deepEqual(smithIrv(ids, d, ballots), ['C']);
  assert.deepEqual(tidemanAlternative(ids, d, ballots), ['C']);
});

test('first choices split evenly between top-scored ties, and follow the weights', () => {
  const ballots = [{ voter: 'x', scores: { a: 5, b: 5, c: 2 } }, { voter: 'y', scores: { c: 4 } }];
  assert.deepEqual(firstChoices(['a', 'b', 'c'], ballots, { y: 3 }), { a: 0.5, b: 0.5, c: 3 });
  assert.deepEqual(firstChoices(['a', 'c'], ballots), { a: 1, c: 1 });
});

test("Tideman's alternative on a cycle: drop the fewest first choices, then the head-to-head decides", () => {
  // a beats b 6-4, b beats c 8-2, c beats a 6-4, and d loses to all. In the Smith set, first choices
  // are a 4, b 4 (with d's ballot), c 2: c goes, and a beats b.
  const ballots = ranked([['abcd', 4], ['bcad', 3], ['cabd', 2], ['dbca', 1]]);
  const ids = ['a', 'b', 'c', 'd'];
  const d = pairwise(ids, ballots);
  assert.deepEqual(smithSet(ids, d), ['a', 'b', 'c']);
  assert.deepEqual(tidemanAlternative(ids, d, ballots), ['a']);
});
