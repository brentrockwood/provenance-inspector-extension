/**
 * The statistics, checked against values that do not come from this code.
 *
 * The exact null is a Binomial(mT, 1/2) upper tail, so most of these expectations are
 * either closed-form facts about that distribution or brute-force sums computed a
 * different way than the implementation computes them.
 */

import { describe, expect, it } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';

import texts from '../data/pinned/texts.json';
import vectors from '../data/pinned/test-vectors.json';

import { makeDeepMindConstruction } from './constructions.ts';
import { hashIvFromKeys } from './hash.ts';
import {
  binomialUpperTail, logBinomialCoefficient, logGamma, normalApproximation,
} from './frequentist.ts';
import { paramsFromConfig, withKeys } from './params.ts';
import {
  drawKeySets, empiricalTail, makeKeyStream, quantile, summarize, wrongKeyNull,
} from './null-model.ts';
import { scoreTokens } from './score.ts';

const construction = makeDeepMindConstruction((d) => sha256(d), hashIvFromKeys);
const params = paramsFromConfig({
  ngram_len: vectors.watermark.ngram_len,
  keys: vectors.watermark.keys,
  context_history_size: vectors.watermark.context_history_size,
  num_leaves: vectors.watermark.num_leaves,
  skip_first_ngram_calls: vectors.watermark.skip_first_ngram_calls,
});
const GPT2_EOS = 50256;

describe('log-gamma', () => {
  it('reproduces factorials', () => {
    // Γ(n+1) = n!, so these are integers arrived at by an entirely different route.
    expect(Math.exp(logGamma(1))).toBeCloseTo(1, 9);
    expect(Math.exp(logGamma(6))).toBeCloseTo(120, 6);
    expect(Math.exp(logGamma(11))).toBeCloseTo(3628800, 2);
  });

  it('reproduces Γ(1/2) = sqrt(pi)', () => {
    expect(Math.exp(logGamma(0.5))).toBeCloseTo(Math.sqrt(Math.PI), 9);
  });
});

describe('binomial coefficients', () => {
  it('matches small cases computed by hand', () => {
    expect(Math.exp(logBinomialCoefficient(5, 2))).toBeCloseTo(10, 6);
    expect(Math.exp(logBinomialCoefficient(10, 5))).toBeCloseTo(252, 4);
    expect(Math.exp(logBinomialCoefficient(52, 5))).toBeCloseTo(2598960, 0);
  });
});

describe('the exact Binomial upper tail', () => {
  it('is 1/2 at the median plus one for an even number of trials', () => {
    // P(X >= n/2 + 1) = (1 - P(X = n/2)) / 2 by symmetry.
    const n = 10;
    const centre = Math.exp(logBinomialCoefficient(n, n / 2)) / 2 ** n;
    expect(binomialUpperTail(n / 2 + 1, n).pValue).toBeCloseTo((1 - centre) / 2, 12);
  });

  it('reproduces the whole tail by brute force on a small case', () => {
    const n = 20;
    for (const k of [0, 1, 7, 10, 15, 20]) {
      let expected = 0;
      for (let i = k; i <= n; i++) {
        expected += Math.exp(logBinomialCoefficient(n, i)) / 2 ** n;
      }
      expect(binomialUpperTail(k, n).pValue).toBeCloseTo(expected, 12);
    }
  });

  it('gives probability 1 at or below zero and 2^-n at the maximum', () => {
    expect(binomialUpperTail(0, 8).pValue).toBe(1);
    expect(binomialUpperTail(8, 8).pValue).toBeCloseTo(1 / 256, 12);
    expect(binomialUpperTail(9, 8).pValue).toBe(0);
  });

  it('keeps reporting a log10 p-value after the p-value itself underflows', () => {
    // The scores this lab produces reach tails far past the smallest positive double.
    // Reporting "p = 0" would be a claim no finite experiment supports.
    const tail = binomialUpperTail(9000, 9420);
    expect(tail.pValue).toBe(0);
    expect(Number.isFinite(tail.log10PValue)).toBe(true);
    expect(tail.log10PValue).toBeLessThan(-1000);
  });
});

describe('the normal approximation', () => {
  it('uses the standard error the paper derives with unit weights', () => {
    // Per-step variance m/4 for the sum, so the mean over m*T draws has s.e. sqrt(1/(4mT)).
    const approx = normalApproximation(0.5, 100, 30);
    expect(approx?.standardError).toBeCloseTo(Math.sqrt(0.25 / 3000), 12);
    expect(approx?.z).toBe(0);
  });

  it('declines to answer when nothing was scored', () => {
    expect(normalApproximation(0.5, 0, 30)).toBeNull();
  });
});

describe('the wrong-key null', () => {
  const ids = texts.samples.watermarked.token_ids.slice(0, 120);

  it('draws reproducible key sets from a seed', () => {
    expect(drawKeySets(7, 3, 4, [])).toEqual(drawKeySets(7, 3, 4, []));
    expect(drawKeySets(7, 3, 4, [])).not.toEqual(drawKeySets(8, 3, 4, []));
  });

  it('never returns the configured key as a null draw', () => {
    const sets = drawKeySets(11, 50, params.keys.length, params.keys);
    expect(sets.some((set) => set.join(',') === params.keys.join(','))).toBe(false);
  });

  it('produces a stream that does not immediately repeat', () => {
    const next = makeKeyStream(1);
    const drawn = new Set(Array.from({ length: 500 }, () => next()));
    expect(drawn.size).toBe(500);
  });

  it('centres near one half and puts the configured key far outside it', () => {
    const keySets = drawKeySets(99, 40, params.keys.length, params.keys);
    const nullDist = wrongKeyNull(ids, params, construction, keySets, GPT2_EOS);
    const observed = scoreTokens(ids, params, construction, GPT2_EOS).score as number;

    expect(nullDist.scores).toHaveLength(40);
    expect(Math.abs(nullDist.mean - 0.5)).toBeLessThan(0.02);
    const tail = empiricalTail(observed, nullDist);
    expect(tail.atOrAbove).toBe(0);
    // With 40 draws the smallest reportable p-value is 1/41, and reporting anything
    // smaller would claim resolution the experiment does not have.
    expect(tail.pValue).toBeCloseTo(1 / 41, 12);
  });

  it('places an unwatermarked control inside its own null', () => {
    const controlIds = texts.samples.control.token_ids.slice(0, 120);
    const keySets = drawKeySets(1234, 40, params.keys.length, params.keys);
    const nullDist = wrongKeyNull(controlIds, params, construction, keySets, GPT2_EOS);
    const observed = scoreTokens(controlIds, params, construction, GPT2_EOS).score as number;
    const tail = empiricalTail(observed, nullDist);
    expect(tail.pValue).toBeGreaterThan(0.05);
  });

  it('reports progress for every key set', () => {
    const seen: number[] = [];
    wrongKeyNull(ids, params, construction,
      drawKeySets(3, 5, params.keys.length, params.keys), GPT2_EOS,
      (done) => seen.push(done));
    expect(seen).toEqual([1, 2, 3, 4, 5]);
  });

  it('scores the same positions whichever key it draws', () => {
    const keySets = drawKeySets(5, 6, params.keys.length, params.keys);
    const counts = keySets.map((keys) =>
      scoreTokens(ids, withKeys(params, keys), construction, GPT2_EOS).scoredPositions);
    expect(new Set(counts).size).toBe(1);
  });
});

describe('summaries and quantiles', () => {
  it('computes a sample standard deviation with the n-1 denominator', () => {
    const summary = summarize([1, 2, 3, 4], 10, 2);
    expect(summary.mean).toBeCloseTo(2.5, 12);
    expect(summary.sd).toBeCloseTo(Math.sqrt(5 / 3), 12);
  });

  it('takes quantiles by nearest rank', () => {
    const summary = summarize([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0], 10, 2);
    expect(quantile(summary, 0.5)).toBeCloseTo(0.5, 12);
    expect(quantile(summary, 0.99)).toBeCloseTo(1.0, 12);
    expect(quantile(summary, 0)).toBeCloseTo(0.1, 12);
  });

  it('reports nothing rather than guessing on an empty distribution', () => {
    expect(Number.isNaN(quantile(summarize([], 0, 2), 0.5))).toBe(true);
  });
});
