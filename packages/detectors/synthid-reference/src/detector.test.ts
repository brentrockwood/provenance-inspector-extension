/**
 * The fixture matrix from the brief, asserted through the public Detector interface.
 *
 * The vendored suite already proves the scorer reproduces Python. These tests prove the
 * thing built on top of it makes the right *editorial* calls: that a short passage is
 * indeterminate rather than negative, that an unwatermarked control does not trip the
 * threshold, and that no result ever carries an authorship claim.
 */

import { describe, expect, it } from 'vitest';

import { digestText, type DetectorContext, type InspectionInput } from '@provenance/evidence';
import texts from '../vendor/data/pinned/texts.json';

import { synthIdReferenceDetector as detector } from './detector.ts';
import { MIN_SCORED_POSITIONS } from './config.ts';

const context: DetectorContext = { now: () => '2026-09-15T00:00:00.000Z' };

function textInput(text: string, id = 'test'): InspectionInput {
  return {
    id,
    kind: 'text',
    text,
    source: { pageUrl: 'https://example.test/article', extractionMethod: 'selection' },
    digest: digestText(text),
  };
}

const watermarked = texts.samples.watermarked.text;
const watermarkedAlt = texts.samples.watermarked_alt.text;
const control = texts.samples.control.text;

describe('applicability', () => {
  it('supports non-empty text', () => {
    expect(detector.supports(textInput('hello world'))).toBe(true);
  });

  it('declines empty and whitespace-only selections', () => {
    expect(detector.supports(textInput(''))).toBe(false);
    expect(detector.supports(textInput('   \n  '))).toBe(false);
  });

  it('declines non-text input rather than reporting a negative about it', () => {
    const image: InspectionInput = {
      id: 'img',
      kind: 'image',
      mimeType: 'image/jpeg',
      source: { pageUrl: 'https://example.test/', extractionMethod: 'asset' },
      digest: { algorithm: 'SHA-256', value: '0'.repeat(64) },
    };
    expect(detector.supports(image)).toBe(false);
  });

  it('declares itself local', () => {
    expect(detector.remote).toBe(false);
  });
});

describe('watermarked fixtures', () => {
  it.each([
    ['watermarked', watermarked],
    ['watermarked_alt', watermarkedAlt],
  ])('%s text produces a positive with a reported score and sample size', async (_name, text) => {
    const [evidence] = await detector.detect(textInput(text), context);
    expect(evidence.result).toBe('positive');
    expect(evidence.kind).toBe('watermark');
    expect(evidence.strength).toBe('statistical');
    expect(evidence.scope).toBe('selected-content');
    expect(evidence.score).toBeGreaterThan(0.5);
    expect(evidence.score!).toBeGreaterThan(evidence.threshold!);
    expect(evidence.sampleSize).toBeGreaterThanOrEqual(MIN_SCORED_POSITIONS);
    expect(evidence.detector.version).toBeTruthy();
  });

  it('reports the configuration and reference commit so the test can be repeated', async () => {
    const [evidence] = await detector.detect(textInput(watermarked), context);
    const d = evidence.details as Record<string, unknown>;
    expect(d.configurationId).toBe('deepmind-addb4a1/default-keys');
    expect(d.referenceCommit).toBe('addb4a158143c7c6851a1308f78b89fceed59683');
    expect(d.constructionId).toBe('deepmind-addb4a1');
    expect(d.watermarkingDepth).toBe(30);
    expect(d.ngramLen).toBe(5);
    expect(typeof d.pValue).toBe('number');
  });

  it('scores close to the Python reference for the same passage', async () => {
    // Re-encoding decoded text need not reproduce the pinned ids exactly, so this is a
    // tolerance check rather than an equality one. The vendored suite pins the exact score
    // against the pinned ids; this pins that the text path lands in the same place.
    const [evidence] = await detector.detect(textInput(watermarked), context);
    const reference = texts.samples.watermarked.reference_scores.correct_key.score;
    expect(evidence.score!).toBeCloseTo(reference, 2);
  });
});

describe('unwatermarked control', () => {
  it('does not produce a false positive at the configured threshold', async () => {
    const [evidence] = await detector.detect(textInput(control), context);
    expect(evidence.result).toBe('negative');
    expect(evidence.score!).toBeLessThan(evidence.threshold!);
  });

  it('states plainly that a negative is not evidence of human authorship', async () => {
    const [evidence] = await detector.detect(textInput(control), context);
    expect(evidence.limitations.join(' ')).toMatch(/does not establish human authorship/i);
  });
});

describe('short selections', () => {
  it('returns indeterminate, never negative, below the minimum sample', async () => {
    const short = watermarked.split(/\s+/).slice(0, 20).join(' ');
    const [evidence] = await detector.detect(textInput(short), context);
    expect(evidence.result).toBe('indeterminate');
    expect(evidence.result).not.toBe('negative');
    expect(evidence.sampleSize).toBeLessThan(MIN_SCORED_POSITIONS);
    expect(evidence.summary).toContain(String(MIN_SCORED_POSITIONS));
  });

  it('truncating a watermarked passage turns a positive into indeterminate, not a negative', async () => {
    const [full] = await detector.detect(textInput(watermarked), context);
    expect(full.result).toBe('positive');
    const [truncated] = await detector.detect(textInput(watermarked.slice(0, 200)), context);
    expect(truncated.result).toBe('indeterminate');
  });
});

describe('language discipline', () => {
  it.each([
    ['positive', watermarked],
    ['negative', control],
  ])('never claims authorship in the %s case', async (_name, text) => {
    const [evidence] = await detector.detect(textInput(text), context);
    const prose = `${evidence.summary} ${evidence.claim ?? ''} ${evidence.limitations.join(' ')}`;
    expect(prose).not.toMatch(/written by (a human|an? AI)/i);
    expect(prose).not.toMatch(/\bAI-generated\b/i);
    expect(prose).not.toMatch(/\b\d+% (likely|probability|chance)/i);
  });

  it('always labels itself a controlled reference configuration', async () => {
    for (const text of [watermarked, control, 'too short']) {
      const [evidence] = await detector.detect(textInput(text), context);
      expect(evidence.limitations.join(' ')).toMatch(/controlled reference configuration/i);
      expect(evidence.limitations.join(' ')).toMatch(/does not detect any production/i);
    }
  });

  it('attaches at least one limitation to every result', async () => {
    for (const text of [watermarked, control, 'short']) {
      const [evidence] = await detector.detect(textInput(text), context);
      expect(evidence.limitations.length).toBeGreaterThan(0);
    }
  });
});
