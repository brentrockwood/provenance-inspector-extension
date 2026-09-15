/**
 * The fixture matrix, driven by the generation record rather than hard-coded.
 *
 * These are the assertions the screenshot and the README rest on, so they read the same
 * files the demo page embeds. Everything here is derived from `fixtures/text/index.json`,
 * which `tools/build-fixtures.mjs` writes — so regenerating the fixtures against a longer
 * local run re-points these tests automatically, with no edits here.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { digestText, type EvidenceResult, type InspectionInput } from '@provenance/evidence';
import { synthIdReferenceDetector as detector } from '@provenance/detector-synthid';

interface FixtureEntry {
  file: string;
  composedOf: string[];
  expect: EvidenceResult;
  /** The reference implementation's own mean g-value, when the file is exactly one sample. */
  referenceScore?: number;
  words: number;
  characters: number;
  sha256: string;
}

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const index = JSON.parse(readFileSync(here('./text/index.json'), 'utf8')) as {
  derivedFrom: string;
  generator: { model: string; tokenizer: string };
  files: FixtureEntry[];
};

const read = (name: string) => readFileSync(here(`./text/${name}`), 'utf8').trim();
const context = { now: () => '2026-09-15T00:00:00.000Z' };

const input = (text: string, id: string): InspectionInput => ({
  id,
  kind: 'text',
  text,
  source: { pageUrl: 'https://example.test/fixture', extractionMethod: 'selection' },
  digest: digestText(text),
});

describe(`fixture matrix (from ${index.derivedFrom})`, () => {
  it('the record and the detector agree on the tokenizer', () => {
    // A mismatch here means every score below is meaningless, so it is checked first.
    expect(index.generator.tokenizer).toBe('openai-community/gpt2');
  });

  it.each(index.files.map((f) => [f.file, f.expect, f] as const))(
    '%s -> %s',
    async (name, _expected, fixture) => {
      const text = read(name);
      const [evidence] = await detector.detect(input(text, name), context);

      expect(evidence.result).toBe(fixture.expect);

      if (fixture.expect === 'positive') {
        expect(evidence.score!).toBeGreaterThan(evidence.threshold!);
      }
      if (fixture.expect === 'negative') {
        expect(evidence.score!).toBeLessThan(evidence.threshold!);
      }
      if (fixture.expect === 'indeterminate') {
        // The case the product exists to get right: too little content is not a negative.
        expect(evidence.result).not.toBe('negative');
      }

      const detail = evidence.details as { log10PValue?: number };
      console.log(
        `${name.padEnd(28)} ${String(fixture.words).padStart(5)}w  ` +
          `result=${evidence.result.padEnd(13)} ` +
          `score=${evidence.score?.toFixed(4) ?? '   n/a'} ` +
          `threshold=${evidence.threshold?.toFixed(4) ?? '   n/a'} ` +
          `positions=${String(evidence.sampleSize).padStart(5)}` +
          (Number.isFinite(detail.log10PValue) ? `  log10p=${detail.log10PValue!.toFixed(1)}` : ''),
      );
    },
  );
});

/**
 * The differential check that matters most.
 *
 * `reference_scores` in the generation record are the Python reference implementation's own
 * numbers for those exact token ids. Reproducing them here is what makes "this port follows
 * the reference" a checkable claim rather than an assertion — and it is what would catch a
 * fixture generated with the wrong SynthID construction, which otherwise looks identical to
 * a broken detector.
 *
 * It is a tolerance check rather than an equality one because re-encoding decoded text need
 * not reproduce the pinned ids exactly; the vendored suite pins exact equality against the
 * ids themselves.
 */
describe('agreement with the reference implementation', () => {
  const scored = index.files.filter((f) => typeof f.referenceScore === 'number');

  it('the record carries at least one reference score to check against', () => {
    expect(scored.length).toBeGreaterThan(0);
  });

  it.each(scored.map((f) => [f.file, f] as const))(
    '%s reproduces the Python mean g-value',
    async (name, fixture) => {
      const [evidence] = await detector.detect(input(read(name), name), context);
      expect(evidence.score).toBeDefined();
      expect(evidence.score!).toBeCloseTo(fixture.referenceScore!, 2);
      console.log(
        `${name.padEnd(28)} ours=${evidence.score!.toFixed(4)}  ` +
          `reference=${fixture.referenceScore!.toFixed(4)}  ` +
          `delta=${Math.abs(evidence.score! - fixture.referenceScore!).toFixed(5)}`,
      );
    },
  );
});

describe('fixture integrity', () => {
  it('every checked-in file matches the digest recorded when it was derived', async () => {
    const { createHash } = await import('node:crypto');
    for (const f of index.files) {
      const digest = createHash('sha256').update(read(f.file), 'utf8').digest('hex');
      expect(digest, `${f.file} has been edited by hand`).toBe(f.sha256);
    }
  });
});
