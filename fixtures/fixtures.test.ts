/**
 * The fixture matrix from the brief, run against the checked-in fixture files.
 *
 * These are the assertions the screenshot and the README rest on, so they read the same files
 * the demo page embeds rather than re-deriving the text.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { digestText, type InspectionInput } from '@provenance/evidence';
import { synthIdReferenceDetector as detector } from '@provenance/detector-synthid';

const read = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./text/${name}`, import.meta.url)), 'utf8').trim();

const context = { now: () => '2026-09-15T00:00:00.000Z' };

const input = (text: string): InspectionInput => ({
  id: 'fixture',
  kind: 'text',
  text,
  source: { pageUrl: 'https://example.test/fixture', extractionMethod: 'selection' },
  digest: digestText(text),
});

describe('fixture matrix', () => {
  it('long watermarked passage -> positive', async () => {
    const [e] = await detector.detect(input(read('watermarked-long.txt')), context);
    expect(e.result).toBe('positive');
    console.log(
      `watermarked-long: score=${e.score?.toFixed(4)} threshold=${e.threshold?.toFixed(4)} ` +
        `positions=${e.sampleSize} log10p=${(e.details as { log10PValue: number }).log10PValue.toFixed(1)}`,
    );
  });

  it('single watermarked sample -> positive', async () => {
    const [e] = await detector.detect(input(read('watermarked-single.txt')), context);
    expect(e.result).toBe('positive');
  });

  it('unwatermarked control -> negative, no false positive', async () => {
    const [e] = await detector.detect(input(read('control-unwatermarked.txt')), context);
    expect(e.result).toBe('negative');
    console.log(
      `control: score=${e.score?.toFixed(4)} threshold=${e.threshold?.toFixed(4)} positions=${e.sampleSize}`,
    );
  });

  it('short passage -> indeterminate, never negative', async () => {
    const [e] = await detector.detect(input(read('short.txt')), context);
    expect(e.result).toBe('indeterminate');
  });
});
