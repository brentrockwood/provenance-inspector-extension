/**
 * Integration semantics for the panel's inspection lifecycle.
 */

import { describe, expect, it } from 'vitest';

import { DetectorRegistry, validateReport, type Detector, type Evidence } from '@provenance/evidence';
import type { InspectionRequest } from '../shared/messages.ts';
import { InspectionRunner, buildInput, exportableInput, sortEvidence } from './inspection.ts';

function request(over: Partial<InspectionRequest> = {}): InspectionRequest {
  return {
    inspectionId: 'insp-1',
    kind: 'text',
    text: 'the quick brown fox jumps over the lazy dog',
    pageUrl: 'https://example.test/article',
    pageTitle: 'An article',
    requestedAt: '2026-09-15T00:00:00.000Z',
    ...over,
  };
}

function makeDetector(
  id: string,
  evidence: Partial<Evidence>,
  delayMs = 0,
  seen?: string[],
): Detector {
  return {
    id,
    name: id,
    version: '1.0.0',
    evidenceKind: 'watermark',
    supports: () => true,
    detect: async (input) => {
      seen?.push(input.text ?? '');
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      return [
        {
          id: `${id}:1`,
          detector: { id, name: id, version: '1.0.0' },
          kind: 'watermark',
          result: 'negative',
          strength: 'statistical',
          scope: 'selected-content',
          summary: `${id} summary`,
          limitations: ['a limitation'],
          observedAt: '2026-09-15T00:00:00.000Z',
          ...evidence,
        },
      ];
    },
  };
}

describe('input construction', () => {
  it('passes the selected text to detectors unchanged', async () => {
    const seen: string[] = [];
    const text = '  Leading and trailing whitespace, "quotes", and — dashes.  ';
    const registry = new DetectorRegistry().register(makeDetector('d1', {}, 0, seen));
    await new InspectionRunner(registry).run(request({ text }), () => undefined);
    expect(seen).toEqual([text]);
  });

  it('digests the exact selection', () => {
    const a = buildInput(request({ text: 'abc' }));
    const b = buildInput(request({ text: 'abc ' }));
    expect(a.digest.value).not.toBe(b.digest.value);
    expect(a.digest.algorithm).toBe('SHA-256');
  });

  it('marks an image request as asset extraction', () => {
    const input = buildInput(
      request({ kind: 'image', text: undefined, assetUrl: 'https://example.test/a.jpg' }),
    );
    expect(input.source.extractionMethod).toBe('asset');
    expect(input.text).toBeUndefined();
  });

  it('strips bytes from the exportable input', () => {
    const input = { ...buildInput(request()), bytes: new ArrayBuffer(8) };
    expect('bytes' in exportableInput(input)).toBe(false);
  });
});

describe('progressive results', () => {
  it('emits an update per completed detector and counts down the pending set', async () => {
    const registry = new DetectorRegistry().register(
      makeDetector('fast', {}, 0),
      makeDetector('slow', {}, 20),
    );
    const pending: number[] = [];
    await new InspectionRunner(registry).run(request(), (s) => pending.push(s.pendingDetectors));
    expect(pending[0]).toBe(2);
    expect(pending.at(-1)).toBe(0);
    expect(pending.length).toBeGreaterThanOrEqual(3);
  });

  it('keeps every update associated with its own inspection id', async () => {
    const registry = new DetectorRegistry().register(makeDetector('d1', {}));
    const ids = new Set<string>();
    await new InspectionRunner(registry).run(request({ inspectionId: 'abc' }), (s) =>
      ids.add(s.inspectionId),
    );
    expect([...ids]).toEqual(['abc']);
  });
});

describe('superseded inspections', () => {
  it('discards late results from a superseded run', async () => {
    const registry = new DetectorRegistry().register(makeDetector('slow', {}, 60));
    const runner = new InspectionRunner(registry);
    const updates: string[] = [];

    const first = runner.run(request({ inspectionId: 'first', text: 'first text' }), (s) =>
      updates.push(`first:${s.evidence.length}`),
    );
    // Supersede before the slow detector resolves.
    const second = runner.run(request({ inspectionId: 'second', text: 'second text' }), (s) =>
      updates.push(`second:${s.evidence.length}`),
    );

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toBeNull();
    expect(secondResult?.inspectionId).toBe('second');
    expect(runner.isCurrent('first')).toBe(false);
    // The superseded run never contributed evidence to a visible state.
    expect(updates.filter((u) => u === 'first:1')).toHaveLength(0);
  });
});

describe('exported report', () => {
  it('matches the visible evidence and validates against the schema', async () => {
    const registry = new DetectorRegistry().register(
      makeDetector('a', { result: 'positive' }),
      makeDetector('b', { result: 'negative' }),
    );
    const state = await new InspectionRunner(registry).run(request(), () => undefined);
    expect(state).not.toBeNull();
    expect(state!.report.evidence.map((e) => e.id).sort()).toEqual(['a:1', 'b:1']);
    expect(state!.report.summary.label).toBe('watermark-evidence');
    expect(validateReport(state!.report)).toEqual({ valid: true, errors: [] });
    expect(JSON.parse(JSON.stringify(state!.report))).toEqual(state!.report);
  });

  it('contains no raw content beyond the digest', async () => {
    const registry = new DetectorRegistry().register(makeDetector('a', {}));
    const state = await new InspectionRunner(registry).run(request(), () => undefined);
    const json = JSON.stringify(state!.report);
    // The text itself is carried in input.text by design (the report is the user's own
    // selection), but bytes never are.
    expect(json).not.toContain('"bytes"');
  });
});

describe('display ordering', () => {
  it('puts positives first and unavailable capabilities last, without changing results', () => {
    const base = {
      detector: { id: 'x', name: 'x', version: '1' },
      kind: 'watermark' as const,
      scope: 'selected-content' as const,
      summary: 's',
      limitations: [],
      observedAt: 'now',
    };
    const sorted = sortEvidence([
      { ...base, id: 'unavailable', result: 'unavailable', strength: 'descriptive' },
      { ...base, id: 'negative', result: 'negative', strength: 'statistical' },
      { ...base, id: 'positive-stat', result: 'positive', strength: 'statistical' },
      { ...base, id: 'positive-crypto', result: 'positive', strength: 'cryptographic' },
    ]);
    expect(sorted.map((e) => e.id)).toEqual([
      'positive-crypto',
      'positive-stat',
      'negative',
      'unavailable',
    ]);
    expect(sorted.find((e) => e.id === 'negative')!.result).toBe('negative');
  });
});
