// Head-to-head (pairwise) counts and Condorcet methods, for the election page's
// "Head to head" section. Pure functions, no DOM.
//
// Ballots are score ballots: { voter, scores: { [candidateId]: 0..5 } } (missing = 0).
// A voter prefers a over b when they scored a higher; equal scores count for neither.

const EPS = 1e-9;
const score = (b, c) => b.scores[c] ?? 0;

/** d[a][b] = total weight of voters who scored a above b. */
export function pairwise(ids, ballots, weights = {}) {
  const d = Object.fromEntries(ids.map((a) => [a, Object.fromEntries(ids.map((b) => [b, 0]))]));
  for (const bl of ballots) {
    const w = weights[bl.voter] ?? 1;
    for (const a of ids) for (const b of ids) if (a !== b && score(bl, a) > score(bl, b)) d[a][b] += w;
  }
  return d;
}

const beats = (d, a, b) => d[a][b] > d[b][a] + EPS;
const ties = (d, a, b) => Math.abs(d[a][b] - d[b][a]) <= EPS;

// Transitive closure of a relation over ids: reach[a][b] = a path from a to b exists.
function closure(ids, rel) {
  const r = Object.fromEntries(ids.map((a) => [a, Object.fromEntries(ids.map((b) => [b, a !== b && rel(a, b)]))]));
  for (const k of ids) for (const a of ids) if (r[a][k]) for (const b of ids) if (r[k][b]) r[a][b] = true;
  return r;
}

/** The candidate who beats every other head to head, or null. */
export function condorcetWinner(ids, d) {
  return ids.find((a) => ids.every((b) => a === b || beats(d, a, b))) ?? null;
}

/** Smallest set whose members each beat every candidate outside it. */
export function smithSet(ids, d) {
  const r = closure(ids, (a, b) => beats(d, a, b) || ties(d, a, b));
  return ids.filter((a) => ids.every((b) => a === b || r[a][b]));
}

/** Union of the smallest sets nobody outside beats (never larger than the Smith set). */
export function schwartzSet(ids, d) {
  const r = closure(ids, (a, b) => beats(d, a, b));
  return ids.filter((a) => ids.every((b) => a === b || !r[b][a] || r[a][b]));
}

const best = (ids, val) => {
  const top = Math.max(...ids.map(val));
  return ids.filter((c) => Math.abs(val(c) - top) <= EPS);
};

/** Copeland score: 1 per head-to-head win, ½ per tie. */
export const copelandScore = (ids, d, a) => ids.reduce((s, b) => s + (a === b ? 0 : beats(d, a, b) ? 1 : ties(d, a, b) ? 0.5 : 0), 0);

export const copeland = (ids, d) => best(ids, (a) => copelandScore(ids, d, a));

/** Minimax: the winner's worst defeat is the mildest, measured by margin or by the winner's votes. */
export function minimax(ids, d, by = 'margins') {
  const worst = (a) => Math.max(0, ...ids.filter((b) => b !== a).map((b) =>
    by === 'margins' ? d[b][a] - d[a][b] : beats(d, b, a) ? d[b][a] : 0));
  return best(ids, (a) => -worst(a));
}

/**
 * Ranked pairs (Tideman): lock in wins from the largest margin down (ties broken by the
 * larger winning side), skipping any that would make a cycle. Winner: nobody locked over them.
 */
export function rankedPairs(ids, d) {
  const pairs = [];
  for (const a of ids) for (const b of ids) if (a !== b && beats(d, a, b)) pairs.push([a, b, d[a][b] - d[b][a], d[a][b]]);
  pairs.sort((x, y) => (Math.abs(y[2] - x[2]) > EPS ? y[2] - x[2] : y[3] - x[3]));
  const locked = Object.fromEntries(ids.map((a) => [a, new Set()]));
  const reaches = (from, to, seen = new Set()) => from === to
    || [...locked[from]].some((n) => !seen.has(n) && (seen.add(n), reaches(n, to, seen)));
  for (const [a, b] of pairs) if (!reaches(b, a)) locked[a].add(b);
  return ids.filter((c) => !ids.some((o) => locked[o].has(c)));
}

/** Schulze (winning votes): the strongest beatpath from each winner to every rival is at least as strong as the way back. */
export function schulze(ids, d) {
  const p = Object.fromEntries(ids.map((a) => [a, Object.fromEntries(ids.map((b) => [b, a !== b && beats(d, a, b) ? d[a][b] : 0]))]));
  for (const k of ids) for (const a of ids) if (a !== k) for (const b of ids) if (b !== a && b !== k) {
    p[a][b] = Math.max(p[a][b], Math.min(p[a][k], p[k][b]));
  }
  return ids.filter((a) => ids.every((b) => a === b || p[a][b] >= p[b][a] - EPS));
}

// ---------------------------------------------------------------- instant runoff

/** First-choice weight of each book in the field: a ballot's highest-scored book, split evenly between top ties. */
export function firstChoices(field, ballots, weights = {}) {
  const f = Object.fromEntries(field.map((c) => [c, 0]));
  for (const bl of ballots) {
    const top = Math.max(...field.map((c) => score(bl, c)));
    const tops = field.filter((c) => score(bl, c) === top);
    for (const c of tops) f[c] += (weights[bl.voter] ?? 1) / tops.length;
  }
  return f;
}

// Drop the book(s) with the least first-choice weight. Books tied for last go out together,
// unless that would leave nobody: then the remaining books are a tie and nobody goes.
function eliminate(field, ballots, weights) {
  const f = firstChoices(field, ballots, weights);
  const low = Math.min(...field.map((c) => f[c]));
  const left = field.filter((c) => f[c] > low + EPS);
  return left.length ? left : field;
}

/** Instant runoff over score ballots, until one book has a majority of the first choices or the rest are tied. */
export function irv(field, ballots, weights = {}) {
  let left = [...field];
  while (left.length > 1) {
    const f = firstChoices(left, ballots, weights), total = left.reduce((s, c) => s + f[c], 0);
    const maj = left.find((c) => f[c] > total / 2 + EPS);
    if (maj) return [maj];
    const next = eliminate(left, ballots, weights);
    if (next.length === left.length) return left;
    left = next;
  }
  return left;
}

/** Smith/IRV: instant runoff among the Smith set. */
export const smithIrv = (ids, d, ballots, weights) => irv(smithSet(ids, d), ballots, weights);

/** Tideman's alternative: cut to the Smith set, drop the fewest first choices, and repeat. */
export function tidemanAlternative(ids, d, ballots, weights) {
  let left = smithSet(ids, d);
  while (left.length > 1) {
    const next = eliminate(left, ballots, weights);
    if (next.length === left.length) return left;
    left = smithSet(next, d);
  }
  return left;
}

export const METHODS = [
  ['condorcet', 'Condorcet winner', (ids, d) => { const w = condorcetWinner(ids, d); return w == null ? [] : [w]; }],
  ['copeland', 'Copeland', copeland],
  ['minimax-margins', 'Minimax (margins)', (ids, d) => minimax(ids, d, 'margins')],
  ['minimax-wv', 'Minimax (winning votes)', (ids, d) => minimax(ids, d, 'winning')],
  ['ranked-pairs', 'Ranked pairs', rankedPairs],
  ['schulze', 'Schulze', schulze],
  ['smith-irv', 'Smith/IRV', smithIrv],
  ['tideman-alt', "Tideman's alternative", tidemanAlternative],
];

/**
 * Everything the page shows. filter: 'all' | 'smith' | 'schwartz' limits the field
 * before each method runs. Returns the matrix, both sets, and each method's winners
 * (more than one winner = an unresolved tie).
 */
export function analyze(ids, ballots, weights, filter = 'all') {
  const d = pairwise(ids, ballots, weights);
  const smith = smithSet(ids, d), schwartz = schwartzSet(ids, d);
  const field = filter === 'smith' ? smith : filter === 'schwartz' ? schwartz : ids;
  return {
    d, smith, schwartz, field,
    methods: METHODS.map(([key, label, fn]) => ({ key, label, winners: fn(field, d, ballots, weights) })),
  };
}
