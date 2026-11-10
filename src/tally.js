// Vote counting for GEB club elections. Pure functions, no I/O: used by the API
// (functions/api) and by the tests. Ported from book-club-voting/sim.py
// (weighted_star + DebtSTAR), plus the official STAR tiebreak rules.
//
// Ballot: { voter: memberId, scores: { [candidateId]: 0..5 } }  (missing = 0)

export const METHODS = {
  'debt-star': 'Debt-weighted STAR',
  'star': 'Plain STAR (everyone weight 1)',
};

// Club-wide parameters for debt-weighted STAR. Changing these changes future
// tallies; closed elections keep the snapshot stored in their result.
export const DEBT_PARAMS = {
  beta: 1.0,     // how strongly debt moves your weight
  decay: 0.85,   // each round, old debt is multiplied by this (debt halves in ~4 rounds)
  floor: 0.3,    // minimum debt multiplier, so nobody's vote shrinks below 30%
  newcomerAttendance: 0.6, // attendance factor for a first-time voter
  rampRounds: 4, // rounds attended to reach full attendance factor (1.0)
  maxSeen: 8,
  missPenalty: 0.5,
};

const EPS = 1e-9;
const eq = (a, b) => Math.abs(a - b) < EPS;
const score = (b, c) => b.scores[c] ?? 0;

/**
 * How happy one voter was with the winner, measured within their own ballot:
 * 0 = the winner was their lowest-scored book, 1 = their highest.
 * stake = how much they cared, the spread of their scores / 5 (0 for a flat ballot).
 */
export function happiness(scores, winner, candidates) {
  const vals = candidates.map((c) => scores[c] ?? 0);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  return {
    happiness: hi === lo ? 1 : ((scores[winner] ?? 0) - lo) / (hi - lo),
    stake: (hi - lo) / 5,
  };
}

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Deterministic "coin flip" so recounting an election always gives the same answer.
function lot(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/**
 * STAR with weighted voters. Each voter's weight multiplies their scores in the
 * scoring round, and counts as their single preference in the runoff (once per
 * round, never stacked).
 *
 * Tiebreaks (Equal Vote STAR rules, using weights):
 *  scoring round: head-to-head wins among the tied → most 5-star ratings → lot
 *  runoff:        higher score total → most 5-star ratings → lot
 */
export function weightedStar(candidates, ballots, weights = {}, seed = 'geb') {
  const w = (b) => weights[b.voter] ?? 1;
  const totals = {}, fives = {};
  for (const c of candidates) {
    totals[c] = ballots.reduce((s, b) => s + w(b) * score(b, c), 0);
    fives[c] = ballots.reduce((s, b) => s + (score(b, c) === 5 ? w(b) : 0), 0);
  }
  const pref = (a, c) => ballots.reduce((s, b) => s + (score(b, a) > score(b, c) ? w(b) : 0), 0);
  const rand = lot(seed);
  const tiebreaks = [];

  if (candidates.length === 0) return { winner: null, totals, fives, finalists: [], tiebreaks };
  if (candidates.length === 1) {
    return { winner: candidates[0], totals, fives, finalists: [candidates[0]], runoff: null, tiebreaks };
  }

  // Scoring round: order by total; resolve tie groups that straddle the top-2 cutoff.
  const order = [...candidates].sort((a, b) => totals[b] - totals[a]);
  const finalists = [];
  let i = 0;
  while (finalists.length < 2) {
    let j = i;
    while (j < order.length && eq(totals[order[j]], totals[order[i]])) j++;
    const group = order.slice(i, j);
    const need = 2 - finalists.length;
    if (group.length <= need) {
      finalists.push(...group);
    } else {
      const h2h = Object.fromEntries(group.map((c) => [c, group.filter((o) => o !== c && pref(c, o) > pref(o, c) + EPS).length]));
      const r = Object.fromEntries(group.map((c) => [c, rand()]));
      const ranked = [...group].sort((a, b) =>
        !eq(h2h[a], h2h[b]) ? h2h[b] - h2h[a] : !eq(fives[a], fives[b]) ? fives[b] - fives[a] : r[a] - r[b]);
      const cut = ranked[need - 1], next = ranked[need];
      const how = h2h[cut] !== h2h[next] ? 'head-to-head wins among tied books'
        : !eq(fives[cut], fives[next]) ? 'most 5-star ratings' : 'drawing lots';
      tiebreaks.push({ round: 'scoring', tied: group, advanced: ranked.slice(0, need), how });
      finalists.push(...ranked.slice(0, need));
    }
    i = j;
  }

  const [a, b] = finalists;
  const pa = pref(a, b), pb = pref(b, a);
  const noPref = ballots.reduce((s, x) => s + (score(x, a) === score(x, b) ? w(x) : 0), 0);
  let winner;
  if (!eq(pa, pb)) winner = pa > pb ? a : b;
  else {
    let how;
    if (!eq(totals[a], totals[b])) { winner = totals[a] > totals[b] ? a : b; how = 'higher score total'; }
    else if (!eq(fives[a], fives[b])) { winner = fives[a] > fives[b] ? a : b; how = 'most 5-star ratings'; }
    else { winner = rand() < 0.5 ? a : b; how = 'drawing lots'; }
    tiebreaks.push({ round: 'runoff', tied: [a, b], advanced: [winner], how });
  }
  return { winner, totals, fives, finalists, runoff: { [a]: pa, [b]: pb, noPreference: noPref }, tiebreaks };
}

// ---------------------------------------------------------------- debt state

/**
 * Starting state. founders: members who joined before the first election closed; they
 * start at full attendance. seeds: { memberId: startingDebt } (the Piranesi seeding).
 */
export function emptyState({ founders = [], seeds = {} } = {}, p = DEBT_PARAMS) {
  const state = { debt: {}, seen: {} };
  for (const v of founders) { state.seen[v] = p.rampRounds; state.debt[v] = 0; }
  for (const [v, d] of Object.entries(seeds)) state.debt[v] = d;
  return state;
}

export function attendance(state, voter, p = DEBT_PARAMS) {
  const seen = state.seen[voter] ?? 0;
  return p.newcomerAttendance + (1 - p.newcomerAttendance) * Math.min(1, seen / p.rampRounds);
}

/** Debt each voter would carry into a round (newcomers enter at the current median). */
export function debtsFor(state, voters) {
  const med = median(Object.values(state.debt));
  return Object.fromEntries(voters.map((v) => [v, state.debt[v] ?? med]));
}

export function weightsFor(state, voters, p = DEBT_PARAMS) {
  const d = debtsFor(state, voters);
  return Object.fromEntries(voters.map((v) => [v, attendance(state, v, p) * Math.max(p.floor, 1 + p.beta * d[v])]));
}

/** Apply one finished round to the state (mutates and returns it). */
export function applyRound(state, candidates, ballots, winner, p = DEBT_PARAMS) {
  if (!ballots.length || winner == null) return state;
  const voters = ballots.map((b) => b.voter);
  Object.assign(state.debt, Object.fromEntries(
    Object.entries(debtsFor(state, voters)).filter(([v]) => !(v in state.debt))));
  // Each voter moves by stake x (stake-weighted average happiness - their happiness),
  // so flat ballots don't move debt and debts still sum to zero.
  const h = Object.fromEntries(ballots.map((b) => [b.voter, happiness(b.scores, winner, candidates)]));
  const totalStake = voters.reduce((t, v) => t + h[v].stake, 0);
  const mean = totalStake ? voters.reduce((t, v) => t + h[v].stake * h[v].happiness, 0) / totalStake : 0;
  for (const v in state.debt) state.debt[v] *= p.decay;
  for (const v of voters) {
    state.debt[v] += h[v].stake * (mean - h[v].happiness);
    state.seen[v] = Math.min(p.maxSeen, (state.seen[v] ?? 0) + 1);
  }
  for (const v in state.seen) if (!voters.includes(v)) state.seen[v] = Math.max(0, state.seen[v] - p.missPenalty);
  return state;
}

/** Replay closed elections (oldest first): [{candidates, ballots, winner}]. */
export function replay(history, start = {}, p = DEBT_PARAMS) {
  const state = emptyState(start, p);
  for (const e of history) applyRound(state, e.candidates, e.ballots, e.winner, p);
  return state;
}

/**
 * One voter's debt and weight going into the first round, then after each round:
 * [{ debt, weight, voted }], one entry longer than history (entry 0 has voted: null).
 */
export function trace(history, voter, start = {}, p = DEBT_PARAMS) {
  const state = emptyState(start, p);
  const point = (voted) => ({ debt: debtsFor(state, [voter])[voter], weight: weightsFor(state, [voter], p)[voter], voted });
  const out = [point(null)];
  for (const e of history) {
    applyRound(state, e.candidates, e.ballots, e.winner, p);
    out.push(point(e.ballots.some((b) => b.voter === voter)));
  }
  return out;
}

/** Full count for one election given the state from all earlier rounds. */
export function tally({ method, candidates, ballots, seed }, state = emptyState(), p = DEBT_PARAMS) {
  const voters = ballots.map((b) => b.voter);
  const weights = method === 'debt-star' ? weightsFor(state, voters, p) : Object.fromEntries(voters.map((v) => [v, 1]));
  const debts = method === 'debt-star' ? debtsFor(state, voters) : null;
  const result = weightedStar(candidates, ballots, weights, seed);
  const plain = method === 'debt-star' ? weightedStar(candidates, ballots, {}, seed).winner : result.winner;
  return { method, params: method === 'debt-star' ? p : null, weights, debts, ...result, plainStarWinner: plain, voters: voters.length };
}

/** A count with the per-member parts (weights, debts) taken out: totals, runoff and winner only. */
export function standings(result) {
  const { weights, debts, ...rest } = result;
  return rest;
}
