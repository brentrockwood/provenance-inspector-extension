/**
 * The controlled reference configuration.
 *
 * Everything here is published: these are the DEFAULT_WATERMARKING_CONFIG keys shipped in
 * google-deepmind/synthid-text. They are demonstration keys in a public repository, which is
 * exactly why this detector is labelled a reference configuration everywhere it appears. A
 * production deployment's keys are secret, and holding them is what would let anyone score
 * text against that deployment. This build cannot, and does not claim to.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import mergesBlob from '../vendor/data/pinned/gpt2-merges.txt?raw';
import watermarkConfig from '../vendor/data/watermark-config.json';

import { makeDeepMindConstruction } from '../vendor/watermark/constructions.ts';
import { hashIvFromKeys } from '../vendor/watermark/hash.ts';
import { paramsFromConfig } from '../vendor/watermark/params.ts';
import { createGpt2Tokenizer } from '../vendor/tokenizer/gpt2.ts';

export const DETECTOR_ID = 'synthid-text-reference';
export const DETECTOR_NAME = 'SynthID Text — controlled reference configuration';
export const DETECTOR_VERSION = '0.1.0';

/** The upstream commit whose construction this scorer reproduces. */
export const REFERENCE_COMMIT = 'addb4a158143c7c6851a1308f78b89fceed59683';
export const CONFIGURATION_ID = 'deepmind-addb4a1/default-keys';

/**
 * Significance level for calling a positive.
 *
 * Deliberately far stricter than a conventional 0.05. The closed-form null assumes the
 * g-values are independent draws, which rests on the hash behaving like a pseudorandom
 * function; the reference implementation's own README states its hash offers no
 * cryptographic guarantees. Buying margin against that gap costs almost nothing here,
 * because a genuinely watermarked passage of usable length clears 1e-6 by many orders of
 * magnitude, while an unwatermarked one sits at the mean.
 */
export const ALPHA = 1e-6;

/**
 * Below this many scored positions the detector reports `indeterminate`, never `negative`.
 *
 * The statistic has ample power against a strong mark even in short text, but effect sizes
 * from edited, quoted, translated, or low-entropy passages land much closer to 0.5 — and it
 * is precisely those cases a short negative would misdescribe. Reporting "not enough
 * evidence" is the honest answer when the test could not have detected a weak mark anyway.
 */
export const MIN_SCORED_POSITIONS = 100;

const sha256Bytes = (data: Uint8Array): Uint8Array => sha256(data);

let cached: {
  tokenizer: ReturnType<typeof createGpt2Tokenizer>;
  params: ReturnType<typeof paramsFromConfig>;
  construction: ReturnType<typeof makeDeepMindConstruction>;
} | null = null;

/** Built once and reused; the merge list is ~450KB to parse. */
export function referenceConfiguration() {
  if (!cached) {
    cached = {
      tokenizer: createGpt2Tokenizer(mergesBlob),
      params: paramsFromConfig(watermarkConfig.watermark),
      construction: makeDeepMindConstruction(sha256Bytes, hashIvFromKeys),
    };
  }
  return cached;
}

export const MODEL_ID = watermarkConfig.model.model_id;
export const TOKENIZER_ID = watermarkConfig.model.tokenizer_id;
