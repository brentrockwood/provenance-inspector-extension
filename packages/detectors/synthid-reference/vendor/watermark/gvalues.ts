/**
 * g-values: the evidence the detector looks for.
 *
 * REFERENCE-IMPLEMENTATION-FAITHFUL — google-deepmind/synthid-text @ addb4a1,
 * `_compute_keys` / `compute_ngram_keys` / `get_gvals`. The chain is:
 *
 *   h_context   = accumulateHash(IV, [x_{t-n+1} … x_{t-1}])   ← context only
 *   h_candidate = accumulateStep(h_context, x_t)              ← the token being scored
 *   h_layer_d   = accumulateStep(h_candidate, key_d)          ← the key for layer d
 *   g_d(x_t)    = construction.gValue(h_candidate, key_d)     ← a 0 or a 1
 *
 * The paper defines g differently in form — g_ℓ(x, r) := F_g^{-1}(h(x, ℓ, r) / 2^n_sec),
 * inverse-transform sampling on a pseudorandom function — and notes that any g-value
 * distribution can be chosen, with Bernoulli(0.5) used for its headline results. Both
 * implementations here realise the Bernoulli(0.5) case: one by reading a bit out of a
 * re-hashed value, the other by indexing a table of random bits. Neither realises the
 * Uniform[0,1] case the paper also defines, and this lab does not claim to.
 *
 * The key entering last is not a stylistic choice — it is what makes the wrong-key
 * experiment cheap on the per-layer step, because the context and candidate hashing can
 * be done once per position.
 */

import { accumulateHash, accumulateStep } from './hash.ts';
import type { GValueConstruction } from './constructions.ts';
import type { WatermarkParams } from './params.ts';
import { candidatePositionCount } from './params.ts';

/** Per-position hashes that do not depend on which layer key is being applied. */
export interface PositionHashes {
  /** Index of the scored token in the token array. */
  readonly tokenIndex: number;
  /** Hash of the ngram_len - 1 context tokens alone — also the repeated-context identity. */
  readonly contextHash: bigint;
  /** Context hash with the candidate token folded in. */
  readonly candidateHash: bigint;
}

/**
 * Walk the sliding window once.
 *
 * Mirrors `input_ids.unfold(dimension=1, size=ngram_len, step=1)`: the first scored token
 * is at index ngram_len - 1, so the opening ngram_len - 1 tokens are context only.
 *
 * The reference reaches the same hashes by two routes — at generation it hashes the
 * context and then the candidate; at detection it hashes the whole n-gram in one call —
 * and they agree because the hash satisfies f(x, data[:T]) = f(f(x, data[:T-1]), data[T]).
 * This code takes the generation route, because it is the one that shows where the key
 * enters.
 */
export function positionHashes(
  tokenIds: readonly number[],
  params: WatermarkParams,
  chainSeed: bigint,
): PositionHashes[] {
  const n = params.ngramLen;
  const out: PositionHashes[] = [];
  for (let t = n - 1; t < tokenIds.length; t++) {
    const contextHash = accumulateHash(chainSeed, tokenIds.slice(t - (n - 1), t));
    out.push({
      tokenIndex: t,
      contextHash,
      candidateHash: accumulateStep(contextHash, tokenIds[t]),
    });
  }
  return out;
}

/**
 * g-values for every candidate position: one row per position, one column per layer.
 *
 * Shape matches the reference implementation's
 * (input_len - (ngram_len - 1), depth).
 */
export function computeGValues(
  tokenIds: readonly number[],
  params: WatermarkParams,
  construction: GValueConstruction,
): number[][] {
  const hashes = positionHashes(tokenIds, params, construction.chainSeed(params.keys));
  return gValuesFromHashes(hashes, params.keys, construction);
}

/** g-values from hashes already walked, reusing the per-position work. */
export function gValuesFromHashes(
  hashes: readonly PositionHashes[],
  keys: readonly number[],
  construction: GValueConstruction,
): number[][] {
  return hashes.map((p) => keys.map((key) => construction.gValue(p.candidateHash, key)));
}

/** How many rows `computeGValues` will return for a token count. */
export function gValueRowCount(tokenCount: number, params: WatermarkParams): number {
  return candidatePositionCount(tokenCount, params);
}
