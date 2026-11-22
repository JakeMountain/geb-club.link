// Each voter's part of an election count, for the colored result bars on the election page.
// Pure functions, no DOM. Ballots: [{ member_id, scores: { [candidateId]: 0..5 } }];
// weights: { [memberId]: weight } (missing = 1), as in src/tally.js.

const score = (bl, c) => bl.scores?.[c] ?? 0;

/**
 * Scoring round: for each candidate, [{ voter, score, weight, value }] with value = weight x score,
 * in ballot order, leaving out zero scores. Runoff (when there are two finalists a and b):
 * { a: [...], b: [...], none: [...] }, each voter's weight on the side they preferred.
 */
export function contributions(candidates, ballots, weights = {}, finalists = []) {
  const w = (bl) => weights[String(bl.member_id)] ?? 1;
  const scoring = Object.fromEntries(candidates.map((c) => {
    const cid = String(c.id ?? c);
    return [cid, ballots.filter((bl) => score(bl, cid) > 0)
      .map((bl) => ({ voter: String(bl.member_id), score: score(bl, cid), weight: w(bl), value: w(bl) * score(bl, cid) }))];
  }));
  const [a, b] = finalists.map(String);
  let runoff = null;
  if (a && b) {
    runoff = { [a]: [], [b]: [], none: [] };
    for (const bl of ballots) {
      const sa = score(bl, a), sb = score(bl, b);
      runoff[sa > sb ? a : sb > sa ? b : 'none'].push({ voter: String(bl.member_id), weight: w(bl), value: w(bl) });
    }
  }
  return { scoring, runoff };
}

// Distinct colors that read on both the light and the dark page.
const PALETTE = ['#4e79a7', '#f28e2b', '#59a14f', '#e15759', '#76b7b2', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#8cd17d', '#a0cbe8', '#d4a6c8'];

/** One color per voter, in ballot order. Past the palette, hues are spread by the golden angle. */
export function voterColors(ballots) {
  return Object.fromEntries(ballots.map((bl, i) => [String(bl.member_id),
    PALETTE[i] ?? `oklch(68% 0.14 ${Math.round((i * 137.508) % 360)})`]));
}
