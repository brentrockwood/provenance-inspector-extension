import { describe, expect, it } from 'vitest';
import { digestText, selectSummary, type InspectionInput } from '@provenance/evidence';
import { anthropicStatusDetector as detector } from './index.ts';

const context = { now: () => '2026-09-15T00:00:00.000Z' };
const input: InspectionInput = {
  id: 'i1',
  kind: 'text',
  text: 'some text',
  source: { pageUrl: 'https://example.test/', extractionMethod: 'selection' },
  digest: digestText('some text'),
};

describe('anthropic status detector', () => {
  it('reports unavailable and simulates nothing', async () => {
    const [evidence] = await detector.detect(input, context);
    expect(evidence.result).toBe('unavailable');
    expect(evidence.score).toBeUndefined();
    expect(evidence.claim).toBeUndefined();
    expect(evidence.summary).toMatch(/authorized detector access required/i);
    expect((evidence.details as { transmitted: boolean }).transmitted).toBe(false);
  });

  it('does not count as a detector that concluded anything', async () => {
    const evidence = await detector.detect(input, context);
    expect(selectSummary(evidence).label).toBe('indeterminate');
  });
});
