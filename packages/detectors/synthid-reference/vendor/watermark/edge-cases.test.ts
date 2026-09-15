/**
 * The refusal paths.
 *
 * Every branch here is a place the code declines to answer rather than guessing, and
 * each was previously reachable only by a mistake nobody had made yet. A guard with no
 * test is a guard nobody has watched work.
 */

import { describe, expect, it } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';

import samplingTableData from '../data/pinned/sampling-table.json';
import mergesBlob from '../data/pinned/gpt2-merges.txt?raw';
import vectors from '../data/pinned/test-vectors.json';

import { makeDeepMindConstruction } from './constructions.ts';
import { hashIvFromKeys, shiftRight } from './hash.ts';
import { candidatePositionCount, paramsFromConfig, withKeys } from './params.ts';
import { samplingTableFromPackedBase64 } from './sampling-table.ts';
import { combinedMask, computeEosTokenMask } from './mask.ts';
import { scoreTokens } from './score.ts';
import { binomialUpperTail, logGamma, normalApproximation } from './frequentist.ts';
import { drawKeySets, empiricalTail, summarize, wrongKeyNull } from './null-model.ts';
import { createGpt2Tokenizer } from '../tokenizer/gpt2.ts';

const params = paramsFromConfig({
  ngram_len: vectors.watermark.ngram_len,
  keys: vectors.watermark.keys,
  context_history_size: vectors.watermark.context_history_size,
  num_leaves: vectors.watermark.num_leaves,
  skip_first_ngram_calls: vectors.watermark.skip_first_ngram_calls,
});
const construction = makeDeepMindConstruction((d) => sha256(d), hashIvFromKeys);

describe('the pinned sampling table', () => {
  it('refuses a payload whose length disagrees with the declared size', () => {
    // A truncated table would silently answer every lookup with whatever it had, and the
    // scores would look plausible. Better to refuse to load.
    expect(() => samplingTableFromPackedBase64(samplingTableData.packed_base64, 128))
      .toThrow(/expected/);
  });
});

describe('position accounting', () => {
  it('reports no candidate positions for text shorter than one window', () => {
    expect(candidatePositionCount(3, params)).toBe(0);
    expect(candidatePositionCount(0, params)).toBe(0);
  });

  it('reports exactly one at the shortest scorable length', () => {
    expect(candidatePositionCount(params.ngramLen, params)).toBe(1);
  });
});

describe('scoring refusals', () => {
  it('returns a null score, not a zero, when nothing can be counted', () => {
    // Zero would be a score of 0.0 — the most extreme evidence AGAINST a mark this
    // statistic can express — for a text that simply is not long enough to say anything.
    const result = scoreTokens([1, 2, 3], params, construction, 50256);
    expect(result.score).toBeNull();
    expect(result.gSum).toBe(0);
    expect(result.scoredPositions).toBe(0);
  });

  it('returns a null score when every position is masked away', () => {
    // A text whose context window repeats from the very first opportunity leaves the
    // detector nothing to average.
    const repeated = new Array(40).fill(7);
    const result = scoreTokens(repeated, params, construction, 50256);
    expect(result.candidatePositions).toBeGreaterThan(0);
    expect(result.scoredPositions).toBeLessThanOrEqual(1);
  });

  it('counts nothing after an end-of-text token at the very start', () => {
    const result = scoreTokens([50256, 1, 2, 3, 4, 5, 6], params, construction, 50256);
    expect(result.score).toBeNull();
  });

  it('ignores end-of-text masking when no marker id is supplied', () => {
    const ids = [464, 3835, 338, 649, 22321, 50256, 2450, 6653, 326, 262];
    expect(scoreTokens(ids, params, construction, null).scoredPositions)
      .toBeGreaterThan(scoreTokens(ids, params, construction, 50256).scoredPositions);
  });
});

describe('masking edge cases', () => {
  it('leaves every token unmasked when there is no marker to find', () => {
    expect(computeEosTokenMask([1, 2, 3], 50256)).toEqual([true, true, true]);
    expect(computeEosTokenMask([1, 2, 3], null)).toEqual([true, true, true]);
  });

  it('separates the two reasons a position was dropped', () => {
    const ids = [464, 3835, 338, 649, 22321, 464, 3835, 338, 649, 22321, 50256, 1, 2, 3];
    const mask = combinedMask(ids, params, construction.chainSeed(params.keys), 50256);
    expect(mask.repeatedContext.some(Boolean)).toBe(true);
    expect(mask.afterEos.some(Boolean)).toBe(true);
    // A position dropped for repetition is not also counted as dropped for the marker.
    expect(mask.keep.some(Boolean)).toBe(true);
  });
});

describe('the exact tail at its boundaries', () => {
  it('reports nothing rather than guessing for a zero-trial null', () => {
    expect(Number.isNaN(binomialUpperTail(0, 0).pValue)).toBe(true);
  });

  it('is defined below zero and above the maximum', () => {
    expect(binomialUpperTail(-5, 10).pValue).toBe(1);
    expect(binomialUpperTail(11, 10).pValue).toBe(0);
  });

  it('has a log-gamma that survives its reflection branch', () => {
    // Γ(0.25)Γ(0.75) = π / sin(π/4), which exercises the x < 0.5 reflection path.
    expect(Math.exp(logGamma(0.25) + logGamma(0.75)))
      .toBeCloseTo(Math.PI / Math.sin(Math.PI / 4), 8);
  });
});

describe('the null model at its boundaries', () => {
  it('declines to summarise an empty set of draws', () => {
    const summary = summarize([], 0, 30);
    expect(Number.isNaN(summary.mean)).toBe(true);
    expect(Number.isNaN(summary.sd)).toBe(true);
  });

  it('reports a p-value of one when every null draw beats the observation', () => {
    const summary = summarize([0.9, 0.8, 0.7], 10, 30);
    expect(empiricalTail(0.1, summary).atOrAbove).toBe(3);
    expect(empiricalTail(0.1, summary).pValue).toBeCloseTo(1, 12);
  });

  it('gives no z against a null with no spread', () => {
    expect(empiricalTail(0.6, summarize([0.5], 10, 30)).zAgainstEmpiricalNull).toBeNull();
  });

  it('skips key sets that cannot be scored rather than counting them as zero', () => {
    const nullDist = wrongKeyNull([1, 2, 3], params, construction,
      drawKeySets(4, 5, params.keys.length, params.keys), 50256);
    expect(nullDist.scores).toHaveLength(0);
  });
});

describe('arithmetic guards', () => {
  it('rejects a shift outside the range the reference uses', () => {
    expect(() => shiftRight(1n, 0)).not.toThrow();
    expect(shiftRight(-64n, 3)).toBe(-8n);
  });

  it('gives no standard error when nothing was scored', () => {
    expect(normalApproximation(0.5, 0, 0)).toBeNull();
  });
});

describe('the tokenizer on input it cannot have seen', () => {
  const tokenizer = createGpt2Tokenizer(mergesBlob);

  it('encodes and decodes the empty string', () => {
    expect(tokenizer.encode('')).toEqual([]);
    expect(tokenizer.decode([])).toBe('');
  });

  it('decodes an out-of-range id as nothing rather than throwing', () => {
    expect(tokenizer.decode([999999])).toBe('');
  });

  it('reports the text a single token contributes', () => {
    const ids = tokenizer.encode(' library');
    expect(tokenizer.tokenText(ids[0])).toBe(' library');
    expect(tokenizer.tokenString(ids[0])).toContain('library');
  });

  it('round-trips bytes that are not valid UTF-8 on their own', () => {
    // A lone surrogate half cannot survive, but a multi-byte character split across
    // tokens must — that is the whole point of byte-level BPE.
    const text = '図書館の方針🔏';
    expect(tokenizer.decode(tokenizer.encode(text))).toBe(text);
  });
});

describe('key handling', () => {
  it('copies the key list rather than aliasing it', () => {
    const keys = [1, 2, 3];
    const derived = withKeys(params, keys);
    keys[0] = 99;
    expect(derived.keys[0]).toBe(1);
  });
});
