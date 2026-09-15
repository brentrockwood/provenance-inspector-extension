/**
 * Which positions are allowed to count.
 *
 * REFERENCE-IMPLEMENTATION-FAITHFUL — google-deepmind/synthid-text @ addb4a1,
 * `compute_context_repetition_mask` and `compute_eos_token_mask`.
 *
 * The repeated-context rule exists because a generator that met the same context twice
 * would be pushed toward the same token twice, which is both conspicuous and
 * self-reinforcing. The reference implementation therefore skips watermarking on a
 * repeated context at generation, and the detector skips scoring the very same
 * positions. Both sides have to make the same decision or the score is measuring two
 * different things.
 */

import { accumulateHash } from './hash.ts';
import type { WatermarkParams } from './params.ts';

export interface MaskResult {
  /** true where the position counts toward the score. */
  readonly keep: boolean[];
  /** Positions dropped because their context had already been seen. */
  readonly repeatedContext: boolean[];
  /** Positions dropped because they sit at or after the first end-of-sequence token. */
  readonly afterEos: boolean[];
}

/**
 * Rolling repeated-context detection.
 *
 * The reference implementation starts its history buffer as `torch.zeros(...)`, so a
 * context whose int64 hash is exactly 0 would collide with the empty history and be
 * masked. That is reproduced here rather than tidied away: the probability is about
 * 2^-64 per position, and a "fix" would put this scorer out of step with the
 * implementation it claims to follow. It is recorded as an open question in
 * verification/manifest.yaml rather than silently patched.
 *
 * Which positions get masked does not depend on the key, even though the hashes do: two
 * identical contexts hash identically under any seed. So the wrong-key experiment scores
 * exactly the same positions as the correct-key run, and the only thing that changes
 * between them is the key.
 */
export function computeContextRepetitionMask(
  tokenIds: readonly number[],
  params: WatermarkParams,
  chainSeed: bigint,
): boolean[] {
  const n = params.ngramLen;
  const history: bigint[] = new Array(params.contextHistorySize).fill(0n);
  const notRepeated: boolean[] = [];
  for (let t = n - 1; t < tokenIds.length; t++) {
    const contextHash = accumulateHash(chainSeed, tokenIds.slice(t - (n - 1), t));
    notRepeated.push(!history.includes(contextHash));
    history.unshift(contextHash);
    history.pop();
  }
  return notRepeated;
}

/**
 * End-of-sequence masking: everything from the first EOS token onward is dropped.
 * Returns a per-token mask, matching the reference implementation's shape before it is
 * sliced to the candidate positions.
 */
export function computeEosTokenMask(
  tokenIds: readonly number[],
  eosTokenId: number | null,
): boolean[] {
  const mask = new Array(tokenIds.length).fill(true);
  if (eosTokenId === null) return mask;
  const first = tokenIds.indexOf(eosTokenId);
  if (first === -1) return mask;
  for (let i = first; i < mask.length; i++) mask[i] = false;
  return mask;
}

/** The mask the detector actually uses: repeated-context AND not-after-EOS. */
export function combinedMask(
  tokenIds: readonly number[],
  params: WatermarkParams,
  chainSeed: bigint,
  eosTokenId: number | null,
): MaskResult {
  const notRepeated = computeContextRepetitionMask(tokenIds, params, chainSeed);
  const eosPerToken = computeEosTokenMask(tokenIds, eosTokenId);
  // The reference detector slices the per-token EOS mask by ngram_len - 1 so it lines up
  // with the candidate positions.
  const eos = eosPerToken.slice(params.ngramLen - 1);
  const keep: boolean[] = [];
  const repeatedContext: boolean[] = [];
  const afterEos: boolean[] = [];
  for (let i = 0; i < notRepeated.length; i++) {
    const eosOk = eos[i] ?? true;
    keep.push(notRepeated[i] && eosOk);
    repeatedContext.push(!notRepeated[i]);
    afterEos.push(!eosOk);
  }
  return { keep, repeatedContext, afterEos };
}
