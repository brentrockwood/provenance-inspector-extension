/**
 * Two reference implementations of the same scheme, which do not agree.
 *
 * SynthID-Text has more than one published implementation, and they compute different
 * g-values from the same text and the same keys. That is not a bug in either of them; it
 * is what "the watermark configuration" means in practice. A detector built against one
 * reads the other's output as unwatermarked noise, which is the whole point of Act VII
 * made concrete and measurable rather than argued.
 *
 * DEEPMIND (default here)
 *   google-deepmind/synthid-text @ addb4a158143c7c6851a1308f78b89fceed59683, the official
 *   reference implementation. Chain seed is a SHA-256 initialization vector derived from
 *   the key sequence; the g-value comes from re-hashing the layer hash twelve times,
 *   shifting right five bits each time, and reading bit 30.
 *
 * TRANSFORMERS
 *   transformers 5.15.1, `SynthIDTextWatermarkLogitsProcessor`. Chain seed is the literal
 *   1; the g-value is a lookup into a pinned table of random bits indexed by the layer
 *   hash modulo the table size.
 *
 * The official repository removed its sampling table in PR #32 (merged 2025-06-13, the
 * commit pinned above); the version in transformers still has one. Both are labelled
 * REFERENCE-IMPLEMENTATION-FAITHFUL here because both are faithful — to different
 * references.
 */

import { accumulateStep, shiftRight, tableIndex, TRANSFORMERS_HASH_SEED } from './hash.ts';
import type { SamplingTable } from './sampling-table.ts';

export type ConstructionId = 'deepmind-addb4a1' | 'transformers-5.15.1';

export interface GValueConstruction {
  readonly id: ConstructionId;
  readonly label: string;
  readonly source: string;
  /** Value the hash chain starts from, which may itself depend on the keys. */
  chainSeed(keys: readonly number[]): bigint;
  /** g-value for one candidate hash under one layer key. */
  gValue(candidateHash: bigint, key: number): number;
  /** One-line statement of what makes this construction different. */
  readonly distinguishingFeature: string;
}

/** Number of re-hash rounds in `get_gvals`. */
export const DEEPMIND_NUM_APPLY_HASH = 12;

/**
 * Effective shift per round.
 *
 * The reference signature is `get_gvals(ngram_keys, num_apply_hash=12, shift=0)` and the
 * body opens with `shift = shift or (64 // num_apply_hash)`. Because 0 is falsy, passing
 * shift=0 does not mean "do not shift" — the effective value is 64 // 12 = 5.
 */
export const DEEPMIND_SHIFT = 5;

/** Bit read out of the final hash. */
export const DEEPMIND_OUTPUT_BIT = 30;

/**
 * The official DeepMind construction.
 *
 * `get_gvals` (logits_processing.py:328-356) reads, verbatim:
 *
 *     for _ in range(num_apply_hash):
 *       ngram_keys = (hashing_function.accumulate_hash(ngram_keys, torch.LongTensor([1])) >> shift)
 *     return (ngram_keys >> 30) % 2
 *
 * Its docstring says the routine "iteratively take[s] the lowest three bits of the ngram
 * keys and add[s] it to the previous gval". The code does not do that. The docstring is
 * stale with respect to the body it ships alongside, so this port follows the code.
 *
 * `% 2` on a signed value follows Python semantics and is never negative; for modulus 2
 * that is exactly the low bit of the two's-complement representation, which is what the
 * mask below reads.
 */
export function makeDeepMindConstruction(
  sha256: (data: Uint8Array) => Uint8Array,
  hashIvFromKeys: (keys: readonly number[], sha: (d: Uint8Array) => Uint8Array) => bigint,
): GValueConstruction {
  return {
    id: 'deepmind-addb4a1',
    label: 'DeepMind reference (synthid-text @ addb4a1)',
    source: 'https://github.com/google-deepmind/synthid-text',
    distinguishingFeature:
      'chain seeded by a SHA-256 initialization vector over the keys; g-value is bit 30 after twelve re-hash rounds',
    chainSeed(keys) {
      return hashIvFromKeys(keys, sha256);
    },
    gValue(candidateHash, key) {
      let h = accumulateStep(candidateHash, key);
      for (let i = 0; i < DEEPMIND_NUM_APPLY_HASH; i++) {
        h = shiftRight(accumulateStep(h, 1), DEEPMIND_SHIFT);
      }
      return Number(shiftRight(h, DEEPMIND_OUTPUT_BIT) & 1n);
    },
  };
}

/**
 * The transformers construction.
 *
 * `sample_g_values` (logits_process.py) indexes a pinned table of random bits:
 *
 *     ngram_keys = ngram_keys % sampling_table_size
 *     return torch.take_along_dim(sampling_table, indices=ngram_keys, dim=2)
 *
 * The table is built by a torch RNG, which a browser cannot reproduce, so it travels with
 * this lab as pinned data (src/data/pinned/sampling-table.json).
 */
export function makeTransformersConstruction(table: SamplingTable): GValueConstruction {
  return {
    id: 'transformers-5.15.1',
    label: 'transformers 5.15.1',
    source: 'https://github.com/huggingface/transformers',
    distinguishingFeature:
      'chain seeded by the literal 1; g-value is a lookup into a pinned table of random bits',
    chainSeed() {
      return TRANSFORMERS_HASH_SEED;
    },
    gValue(candidateHash, key) {
      return table.at(tableIndex(accumulateStep(candidateHash, key), table.size));
    },
  };
}
