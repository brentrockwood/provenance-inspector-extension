/**
 * Differential tests against the reference implementations.
 *
 * Every number in these tests came out of Python — either google-deepmind/synthid-text
 * @ addb4a1 or transformers 5.15.1 — and was committed by tools/make_test_vectors.py.
 * Nothing here re-derives an expectation from the code under test, because a test that
 * recomputes the same expression the source uses will happily agree with a bug.
 */

import { describe, expect, it } from 'vitest';

import vectors from '../data/pinned/test-vectors.json';
import transformersVectors from '../data/pinned/test-vectors-transformers.json';
import texts from '../data/pinned/texts.json';
import samplingTableData from '../data/pinned/sampling-table.json';

import { accumulateHash, hashIvFromKeys, INT64_MAX, MULTIPLIER } from './hash.ts';
import { makeDeepMindConstruction, makeTransformersConstruction } from './constructions.ts';
import { computeGValues, positionHashes } from './gvalues.ts';
import { combinedMask, computeContextRepetitionMask, computeEosTokenMask } from './mask.ts';
import { paramsFromConfig, depth, withKeys } from './params.ts';
import { samplingTableFromPackedBase64, tableOnes } from './sampling-table.ts';
import { binomialUpperTail } from './frequentist.ts';
import { scoreTokens } from './score.ts';
import { sha256 } from '@noble/hashes/sha2.js';

const GPT2_EOS = 50256;

const params = paramsFromConfig({
  ngram_len: vectors.watermark.ngram_len,
  keys: vectors.watermark.keys,
  context_history_size: vectors.watermark.context_history_size,
  num_leaves: vectors.watermark.num_leaves,
  skip_first_ngram_calls: vectors.watermark.skip_first_ngram_calls,
});

const table = samplingTableFromPackedBase64(
  samplingTableData.packed_base64,
  samplingTableData.size,
);
const deepmind = makeDeepMindConstruction((d) => sha256(d), hashIvFromKeys);
const transformers = makeTransformersConstruction(table);

describe('the linear congruential hash', () => {
  it('reproduces the reference constants', () => {
    expect(MULTIPLIER).toBe(6364136223846793005n);
  });

  it.each(vectors.lcg_vectors)('folds $data into $seed', (vector) => {
    expect(accumulateHash(BigInt(vector.seed), vector.data)).toBe(BigInt(vector.hash));
  });

  it('wraps at 64 bits with a sign rather than growing without bound', () => {
    // A hash that never wrapped would exceed int64 within two steps of this size.
    const wrapped = accumulateHash(INT64_MAX, [50256, 50256]);
    expect(wrapped < 1n << 63n).toBe(true);
    expect(wrapped >= -(1n << 63n)).toBe(true);
  });
});

describe('the key-derived initialization vector', () => {
  it.each(Object.entries(vectors.chain_seeds))('matches the reference for %s', (name, expected) => {
    const keys = (vectors.key_sets as Record<string, number[]>)[name];
    expect(deepmind.chainSeed(keys)).toBe(BigInt(expected as string));
  });

  it('changes completely when a single key bit flips', () => {
    const configured = deepmind.chainSeed(vectors.key_sets.configured_keys);
    const flipped = deepmind.chainSeed(vectors.key_sets.one_bit_flipped);
    expect(flipped).not.toBe(configured);
  });

  it('is the literal 1 for the transformers construction, whatever the keys', () => {
    expect(transformers.chainSeed(vectors.key_sets.configured_keys)).toBe(1n);
    expect(transformers.chainSeed(vectors.key_sets.wrong_keys)).toBe(1n);
  });
});

describe('the pinned sampling table', () => {
  it('decodes to the size and balance the capture recorded', () => {
    expect(table.size).toBe(samplingTableData.size);
    expect(tableOnes(table)).toBe(samplingTableData.ones);
  });
});

describe('g-values against the DeepMind reference', () => {
  for (const [name, sequence] of Object.entries(vectors.sequences)) {
    for (const [keyName, expected] of Object.entries(sequence.per_key_set)) {
      it(`matches on ${name} under ${keyName}`, () => {
        const keyed = withKeys(params, (vectors.key_sets as Record<string, number[]>)[keyName]);
        expect(computeGValues(sequence.token_ids, keyed, deepmind)).toEqual(expected.g_values);
      });
    }
  }
});

describe('g-values against the transformers reference', () => {
  for (const [name, sequence] of Object.entries(transformersVectors.sequences)) {
    for (const [keyName, expected] of Object.entries(sequence.per_key_set)) {
      it(`matches on ${name} under ${keyName}`, () => {
        const keyed = withKeys(
          params,
          (transformersVectors.key_sets as Record<string, number[]>)[keyName],
        );
        expect(computeGValues(sequence.token_ids, keyed, transformers)).toEqual(
          expected.g_values,
        );
      });
    }
  }
});

describe('masking', () => {
  for (const [name, sequence] of Object.entries(vectors.sequences)) {
    const expected = sequence.per_key_set.configured_keys;
    it(`reproduces the repeated-context mask on ${name}`, () => {
      const seed = deepmind.chainSeed(params.keys);
      expect(computeContextRepetitionMask(sequence.token_ids, params, seed)).toEqual(
        expected.context_repetition_mask,
      );
    });
    it(`reproduces the end-of-text mask on ${name}`, () => {
      expect(computeEosTokenMask(sequence.token_ids, GPT2_EOS)).toEqual(expected.eos_mask);
    });
  }

  it('actually fires on a repeated context, so the test above is not vacuous', () => {
    const seed = deepmind.chainSeed(params.keys);
    const mask = computeContextRepetitionMask(vectors.sequences.repeated_context.token_ids,
      params, seed);
    expect(mask.filter((keep) => !keep).length).toBeGreaterThan(0);
  });

  it('drops everything from the first end-of-text token onward', () => {
    const ids = vectors.sequences.with_eos.token_ids;
    const eosAt = ids.indexOf(GPT2_EOS);
    const mask = computeEosTokenMask(ids, GPT2_EOS);
    expect(mask.slice(0, eosAt).every(Boolean)).toBe(true);
    expect(mask.slice(eosAt).some(Boolean)).toBe(false);
  });

  it('does not depend on the key, so wrong-key runs score the same positions', () => {
    const ids = texts.samples.watermarked.token_ids;
    const configured = combinedMask(ids, params, deepmind.chainSeed(params.keys), GPT2_EOS);
    const wrongParams = withKeys(params, vectors.key_sets.wrong_keys);
    const wrong = combinedMask(ids, wrongParams, deepmind.chainSeed(wrongParams.keys), GPT2_EOS);
    expect(wrong.keep).toEqual(configured.keep);
  });
});

describe('the mean g-score', () => {
  for (const [name, perKey] of Object.entries(vectors.pinned_sample_scores)) {
    for (const [keyName, expected] of Object.entries(perKey)) {
      it(`matches the reference on ${name} under ${keyName}`, () => {
        const sample = (texts.samples as Record<string, { token_ids: number[] }>)[name];
        const keyed = withKeys(params, (vectors.key_sets as Record<string, number[]>)[keyName]);
        const result = scoreTokens(sample.token_ids, keyed, deepmind, GPT2_EOS);
        expect(result.scoredPositions).toBe(expected.scored_positions);
        expect(result.candidatePositions).toBe(expected.candidate_positions);
        expect(result.depth).toBe(expected.depth);
        expect(result.score).toBeCloseTo(expected.score as number, 12);
      });
    }
  }

  it('reports no score at all when the text is shorter than one n-gram', () => {
    const result = scoreTokens(vectors.sequences.too_short.token_ids, params, deepmind, GPT2_EOS);
    expect(result.score).toBeNull();
    expect(result.candidatePositions).toBe(0);
  });

  it('offers exactly one scored position at the shortest scorable length', () => {
    const result = scoreTokens(vectors.sequences.shortest_scorable.token_ids, params,
      deepmind, GPT2_EOS);
    expect(result.candidatePositions).toBe(1);
    expect(result.gValueCount).toBe(depth(params));
  });

  it('reads the DeepMind-watermarked sample as unmarked under the transformers construction',
    () => {
      // Two published reference implementations of the same scheme, the same text, the
      // same keys — and the mark is only visible to the one that made it. Both sides are
      // held to their own reference value rather than to a threshold picked by hand.
      const ids = texts.samples.watermarked.token_ids;
      const mine = scoreTokens(ids, params, deepmind, GPT2_EOS);
      const other = scoreTokens(ids, params, transformers, GPT2_EOS);

      expect(mine.score).toBeCloseTo(
        vectors.pinned_sample_scores.watermarked.configured_keys.score as number, 12);
      expect(other.score).toBeCloseTo(
        transformersVectors.pinned_sample_scores.watermarked.configured_keys.score as number, 12);
      expect(other.scoredPositions).toBe(mine.scoredPositions);

      // The separation is stated in the currency the page uses — the exact null — not as
      // a hand-picked gap between two decimals.
      const mineTail = binomialUpperTail(mine.gSum, mine.gValueCount);
      const otherTail = binomialUpperTail(other.gSum, other.gValueCount);
      expect(mineTail.log10PValue).toBeLessThan(-10);
      expect(otherTail.log10PValue).toBeGreaterThan(-1);
    });
});

describe('position bookkeeping', () => {
  it('starts scoring at the first token with a full context window', () => {
    const ids = vectors.sequences.plain.token_ids;
    const hashes = positionHashes(ids, params, deepmind.chainSeed(params.keys));
    expect(hashes[0].tokenIndex).toBe(params.ngramLen - 1);
    expect(hashes.length).toBe(ids.length - (params.ngramLen - 1));
  });
});
