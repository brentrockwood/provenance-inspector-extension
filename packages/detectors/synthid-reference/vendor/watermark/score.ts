/**
 * The scoring statistic: the mean g-value over scored positions and layers.
 *
 * PAPER-FAITHFUL. Equation (1) of the paper, and MeanScore in its Supplementary
 * Information A.2:
 *
 *     Score(x) = (1 / (mT)) Σ_{t=1..T} Σ_{ℓ=1..m} g_ℓ(x_t, r_t)
 *
 * with the masking of Supplementary A.1 applied, which the paper describes as discarding
 * the g-values for the first H steps (incomplete context window) and for steps whose
 * context appeared previously in the sequence, then replacing T with the number of
 * surviving positions.
 *
 * This is deliberately NOT the production detector. The paper's headline results use a
 * Bayesian scoring function learned from labelled watermarked and unwatermarked data, and
 * the reference repository ships a trained Bayesian detector alongside the mean. This lab
 * implements the mean because it is the one a reader can follow end to end, and it says
 * so everywhere it prints a number.
 *
 * Everything needed to interpret a score travels with it. A bare "0.63" is not a result:
 * 0.63 over 12 positions and 0.63 over 300 positions are different claims.
 */

import type { GValueConstruction } from './constructions.ts';
import { gValuesFromHashes, positionHashes } from './gvalues.ts';
import type { PositionHashes } from './gvalues.ts';
import { combinedMask } from './mask.ts';
import type { WatermarkParams } from './params.ts';
import { depth as depthOf } from './params.ts';

export interface PositionScore {
  /** Index of the scored token within the token array. */
  readonly tokenIndex: number;
  /** g-value per layer at this position. */
  readonly gValues: number[];
  /** Mean g-value across layers at this position. */
  readonly mean: number;
  readonly counted: boolean;
  readonly repeatedContext: boolean;
  readonly afterEos: boolean;
}

export interface ScoreResult {
  /** Mean g-value over counted positions and layers, or null when nothing could be scored. */
  readonly score: number | null;
  /** Sum of the counted g-values — the quantity the exact null is defined on. */
  readonly gSum: number;
  readonly tokenCount: number;
  /** Positions the sliding window offers: tokenCount - (ngramLen - 1). */
  readonly candidatePositions: number;
  readonly scoredPositions: number;
  readonly maskedRepeatedContext: number;
  readonly maskedAfterEos: number;
  readonly depth: number;
  /** Individual g-values behind the mean: scoredPositions * depth. */
  readonly gValueCount: number;
  readonly perPosition: PositionScore[];
  readonly constructionId: string;
}

/**
 * Expected mean g-value when the text carries no mark for this key.
 *
 * The paper states it directly for the g-value distributions it uses: "with an expected
 * score of 0.5 for unwatermarked text and a larger score expected for watermarked text."
 */
export const NULL_EXPECTED_MEAN = 0.5;

export function scoreTokens(
  tokenIds: readonly number[],
  params: WatermarkParams,
  construction: GValueConstruction,
  eosTokenId: number | null = null,
): ScoreResult {
  const seed = construction.chainSeed(params.keys);
  const hashes = positionHashes(tokenIds, params, seed);
  return scoreFromHashes(tokenIds, params, hashes, construction, seed, eosTokenId);
}

/** Same statistic, reusing hashes already walked for this key set. */
export function scoreFromHashes(
  tokenIds: readonly number[],
  params: WatermarkParams,
  hashes: readonly PositionHashes[],
  construction: GValueConstruction,
  chainSeed: bigint,
  eosTokenId: number | null = null,
): ScoreResult {
  const gValues = gValuesFromHashes(hashes, params.keys, construction);
  const mask = combinedMask(tokenIds, params, chainSeed, eosTokenId);
  const d = depthOf(params);

  const perPosition: PositionScore[] = hashes.map((h, i) => {
    const row = gValues[i] ?? [];
    return {
      tokenIndex: h.tokenIndex,
      gValues: row,
      mean: row.length ? row.reduce((a, b) => a + b, 0) / row.length : 0,
      counted: mask.keep[i],
      repeatedContext: mask.repeatedContext[i],
      afterEos: mask.afterEos[i],
    };
  });

  let gSum = 0;
  let counted = 0;
  for (const p of perPosition) {
    if (!p.counted) continue;
    counted += 1;
    for (const g of p.gValues) gSum += g;
  }

  return {
    score: counted === 0 ? null : gSum / (counted * d),
    gSum,
    tokenCount: tokenIds.length,
    candidatePositions: hashes.length,
    scoredPositions: counted,
    maskedRepeatedContext: perPosition.filter((p) => p.repeatedContext).length,
    maskedAfterEos: perPosition.filter((p) => p.afterEos && !p.repeatedContext).length,
    depth: d,
    gValueCount: counted * d,
    perPosition,
    constructionId: construction.id,
  };
}
