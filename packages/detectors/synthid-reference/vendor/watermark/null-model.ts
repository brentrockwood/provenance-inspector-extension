/**
 * What a score looks like when there is nothing to find.
 *
 * A watermark score means nothing on its own. The question is always "how surprising is
 * this number if the text does not carry a mark for this key?", and answering it needs a
 * null distribution. Two different nulls answer two different questions, and this lab
 * builds both rather than picking one and hoping:
 *
 *   WRONG-KEY NULL (computed live, in the browser)
 *     Hold the text fixed, score it under many random keys. Answers: for THIS text, is
 *     the configured key special? It conditions on the text, so it is immune to the text
 *     being unusual — which is exactly the confound the Hero is about.
 *
 *   CORPUS NULL (pinned; see tools/capture_null_corpus.py)
 *     Hold the key fixed, score many unwatermarked texts. Answers: for THIS key, is this
 *     text unusual? It is the null a deployed detector would actually face.
 *
 * Neither of these replaces the exact null in frequentist.ts, and neither is decoration.
 * The paper's closed form is exact GIVEN that the masked g-values are independent fair
 * coins, and that argument is made about an idealised pseudorandom function. The
 * implementations use a linear congruential generator whose own repository says it
 * "does not provide any guarantees of cryptographic security". Measuring the null is how
 * this lab checks the assumption instead of inheriting it. See docs/MATH.md and the open
 * questions in verification/manifest.yaml.
 */

import type { GValueConstruction } from './constructions.ts';
import { positionHashes } from './gvalues.ts';
import type { WatermarkParams } from './params.ts';
import { withKeys } from './params.ts';
import { scoreFromHashes } from './score.ts';

export interface NullDistribution {
  /** Scores under each drawn key, in draw order. */
  readonly scores: number[];
  readonly mean: number;
  /** Sample standard deviation (n - 1 denominator). */
  readonly sd: number;
  readonly min: number;
  readonly max: number;
  /** Positions that were scored — identical for every key, since masking is key-independent. */
  readonly scoredPositions: number;
  readonly depth: number;
}

/** A small deterministic PRNG, so a "random keys" run is reproducible from its seed. */
export function makeKeyStream(seed: number): () => number {
  // xorshift32. Not cryptographic, and it does not need to be: it draws demonstration
  // keys for a wrong-key experiment. The keys it draws are recorded so any run can be
  // repeated exactly.
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state;
  };
}

export function drawKeySets(
  seed: number,
  count: number,
  depth: number,
  exclude: readonly number[],
): number[][] {
  const next = makeKeyStream(seed);
  const excluded = exclude.join(',');
  const sets: number[][] = [];
  while (sets.length < count) {
    const keys = Array.from({ length: depth }, () => next() % 1048576);
    if (keys.join(',') === excluded) continue; // drawing the real key back is not a null sample
    sets.push(keys);
  }
  return sets;
}

/**
 * Score one text under many key sets.
 *
 * The text never changes and neither does the set of positions that count, because two
 * identical contexts collide under any chain seed. What changes is the key, which is the
 * whole claim being tested.
 *
 * `onProgress` exists because this is the one computation in the lab heavy enough to be
 * felt: at the reference implementation's default depth of 30, each key set walks the
 * whole sequence again. Callers chunk it so the page stays responsive and can announce
 * progress rather than freezing silently.
 */
export function wrongKeyNull(
  tokenIds: readonly number[],
  params: WatermarkParams,
  construction: GValueConstruction,
  keySets: readonly number[][],
  eosTokenId: number | null = null,
  onProgress?: (done: number, total: number) => void,
): NullDistribution {
  const scores: number[] = [];
  let scoredPositions = 0;
  for (const [index, keys] of keySets.entries()) {
    const trialParams = withKeys(params, keys);
    const seed = construction.chainSeed(trialParams.keys);
    const hashes = positionHashes(tokenIds, trialParams, seed);
    const result = scoreFromHashes(tokenIds, trialParams, hashes, construction, seed, eosTokenId);
    if (result.score !== null) {
      scores.push(result.score);
      scoredPositions = result.scoredPositions;
    }
    onProgress?.(index + 1, keySets.length);
  }
  return summarize(scores, scoredPositions, params.keys.length);
}

export function summarize(
  scores: number[],
  scoredPositions: number,
  depth: number,
): NullDistribution {
  const n = scores.length;
  const mean = n ? scores.reduce((a, b) => a + b, 0) / n : Number.NaN;
  const sd = n > 1
    ? Math.sqrt(scores.reduce((a, s) => a + (s - mean) ** 2, 0) / (n - 1))
    : Number.NaN;
  return {
    scores,
    mean,
    sd,
    min: n ? Math.min(...scores) : Number.NaN,
    max: n ? Math.max(...scores) : Number.NaN,
    scoredPositions,
    depth,
  };
}

export interface EmpiricalTailResult {
  /** Null draws that reached or exceeded the observed score. */
  readonly atOrAbove: number;
  readonly nullSamples: number;
  /**
   * (r + 1) / (N + 1). The +1 is not decoration: with N null draws the smallest
   * defensible p-value is 1/(N + 1), and reporting 0 would claim more resolution than
   * the experiment has.
   */
  readonly pValue: number;
  /** How far above the null mean, in units of the null's own measured spread. */
  readonly zAgainstEmpiricalNull: number | null;
}

export function empiricalTail(observed: number, nullDist: NullDistribution): EmpiricalTailResult {
  const atOrAbove = nullDist.scores.filter((s) => s >= observed).length;
  const n = nullDist.scores.length;
  return {
    atOrAbove,
    nullSamples: n,
    pValue: (atOrAbove + 1) / (n + 1),
    zAgainstEmpiricalNull:
      Number.isFinite(nullDist.sd) && nullDist.sd > 0
        ? (observed - nullDist.mean) / nullDist.sd
        : null,
  };
}

/** Quantile by nearest-rank on the sorted null draws. */
export function quantile(nullDist: NullDistribution, p: number): number {
  if (!nullDist.scores.length) return Number.NaN;
  const sorted = [...nullDist.scores].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}
