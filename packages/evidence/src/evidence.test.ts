/**
 * Core semantics: digesting, counting, precedence, conflict preservation, failure
 * containment, and schema validation.
 */

import { describe, expect, it } from 'vitest';

import { countContent } from './counts.ts';
import { digestText, sha256Hex, encodeUtf8 } from './digest.ts';
import { buildReport, selectSummary } from './reconcile.ts';
import { DetectorRegistry, defaultContext } from './registry.ts';
import { validateReport } from './schema.ts';
import type { Detector, Evidence, InspectionInput } from './types.ts';

const now = () => '2026-09-15T00:00:00.000Z';
const context = { now };

function evidence(over: Partial<Evidence>): Evidence {
  return {
    id: over.id ?? 'e1',
    detector: over.detector ?? { id: 'd1', name: 'Detector One', version: '1.0.0' },
    kind: over.kind ?? 'watermark',
    result: over.result ?? 'negative',
    strength: over.strength ?? 'statistical',
    scope: over.scope ?? 'selected-content',
    summary: over.summary ?? 'summary',
    limitations: over.limitations ?? ['limitation'],
    observedAt: now(),
    ...over,
  };
}

function input(text = 'hello'): InspectionInput {
  return {
    id: 'i1',
    kind: 'text',
    text,
    source: { pageUrl: 'https://example.test/', extractionMethod: 'selection' },
    digest: digestText(text),
  };
}

describe('digest', () => {
  it('is deterministic and lowercase hex', () => {
    const a = digestText('the quick brown fox');
    const b = digestText('the quick brown fox');
    expect(a.value).toBe(b.value);
    expect(a.value).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches the known SHA-256 of an empty string', () => {
    expect(sha256Hex(encodeUtf8(''))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('distinguishes content that differs only in whitespace', () => {
    expect(digestText('a b').value).not.toBe(digestText('a  b').value);
  });
});

describe('counts', () => {
  it('counts characters as extracted and words as whitespace-separated runs', () => {
    expect(countContent('one two three')).toEqual({ characters: 13, words: 3 });
    expect(countContent('  padded  ')).toEqual({ characters: 10, words: 1 });
    expect(countContent('')).toEqual({ characters: 0, words: 0 });
    expect(countContent('   ')).toEqual({ characters: 3, words: 0 });
  });
});

describe('reconciliation precedence', () => {
  it('prefers a cryptographic positive scoped to the inspected content', () => {
    const s = selectSummary([
      evidence({ id: 'wm', kind: 'watermark', result: 'positive' }),
      evidence({
        id: 'sig',
        kind: 'signature',
        result: 'positive',
        strength: 'cryptographic',
        issuer: 'Example CA',
      }),
    ]);
    expect(s.label).toBe('verified-provenance');
    expect(s.strongestSignal).toBe('sig');
    expect(s.text).toContain('Example CA');
  });

  it('prefers a watermark positive on the content over a verified asset', () => {
    const s = selectSummary([
      evidence({ id: 'asset', kind: 'signature', result: 'positive', strength: 'cryptographic', scope: 'asset' }),
      evidence({ id: 'wm', kind: 'watermark', result: 'positive' }),
    ]);
    expect(s.label).toBe('watermark-evidence');
    expect(s.strongestSignal).toBe('wm');
  });

  it('falls back to an asset-scoped verified positive', () => {
    const s = selectSummary([
      evidence({ id: 'wm', result: 'negative' }),
      evidence({ id: 'asset', kind: 'signature', result: 'positive', strength: 'cryptographic', scope: 'asset' }),
    ]);
    expect(s.label).toBe('verified-provenance');
    expect(s.strongestSignal).toBe('asset');
  });

  it('reports no-supported-signal when a detector concluded but found nothing', () => {
    const s = selectSummary([evidence({ result: 'negative' })]);
    expect(s.label).toBe('no-supported-signal');
    expect(s.text).toMatch(/does not establish human authorship/i);
  });

  it('reports indeterminate when nothing concluded', () => {
    const s = selectSummary([
      evidence({ id: 'a', result: 'indeterminate' }),
      evidence({ id: 'b', result: 'unavailable' }),
      evidence({ id: 'c', result: 'error' }),
    ]);
    expect(s.label).toBe('indeterminate');
    expect(s.strongestSignal).toBeUndefined();
  });

  it('reports indeterminate for an empty evidence list', () => {
    expect(selectSummary([]).label).toBe('indeterminate');
  });

  it('never averages: a negative does not cancel a positive from another scheme', () => {
    const all = [
      evidence({ id: 'neg', kind: 'watermark', result: 'negative' }),
      evidence({ id: 'pos', kind: 'signature', result: 'positive', strength: 'cryptographic' }),
    ];
    const report = buildReport('id', { ...input(), text: 'x' }, all, now());
    expect(report.summary.label).toBe('verified-provenance');
    // Both remain visible and unchanged in the card list.
    expect(report.evidence.map((e) => e.id)).toEqual(['neg', 'pos']);
    expect(report.evidence.find((e) => e.id === 'neg')!.result).toBe('negative');
  });
});

describe('registry', () => {
  const ok: Detector = {
    id: 'ok',
    name: 'Working',
    version: '1.0.0',
    evidenceKind: 'watermark',
    supports: () => true,
    detect: async () => [evidence({ id: 'ok:1', result: 'positive' })],
  };

  const broken: Detector = {
    id: 'broken',
    name: 'Broken',
    version: '9.9.9',
    evidenceKind: 'signature',
    supports: () => true,
    detect: async () => {
      throw new Error('boom');
    },
  };

  const notApplicable: Detector = {
    id: 'na',
    name: 'Not applicable',
    version: '1.0.0',
    evidenceKind: 'metadata',
    supports: () => false,
    detect: async () => [evidence({ id: 'na:1' })],
  };

  it('rejects duplicate detector ids', () => {
    expect(() => new DetectorRegistry().register(ok, ok)).toThrow(/Duplicate/);
  });

  it('runs only applicable detectors', async () => {
    const results = await new DetectorRegistry()
      .register(ok, notApplicable)
      .run(input(), defaultContext());
    expect(results.map((e) => e.id)).toEqual(['ok:1']);
  });

  it('contains a detector failure as error evidence without losing other results', async () => {
    const results = await new DetectorRegistry().register(ok, broken).run(input(), context);
    expect(results).toHaveLength(2);
    const failed = results.find((e) => e.result === 'error')!;
    expect(failed.detector.id).toBe('broken');
    expect(failed.summary).toContain('boom');
    expect(failed.limitations.join(' ')).toMatch(/not a negative result/i);
    expect(results.some((e) => e.result === 'positive')).toBe(true);
  });

  it('an errored detector does not make the summary a negative', async () => {
    const results = await new DetectorRegistry().register(broken).run(input(), context);
    expect(selectSummary(results).label).toBe('indeterminate');
  });

  it('emits evidence progressively as each detector completes', async () => {
    const seen: string[] = [];
    await new DetectorRegistry()
      .register(ok, broken)
      .run(input(), context, (ev, d) => seen.push(`${d.id}:${ev.length}`));
    expect(seen.sort()).toEqual(['broken:1', 'ok:1']);
  });

  it('excludes a detector whose supports() throws rather than aborting dispatch', async () => {
    const hostile: Detector = {
      ...ok,
      id: 'hostile',
      supports: () => {
        throw new Error('bad supports');
      },
    };
    const results = await new DetectorRegistry().register(ok, hostile).run(input(), context);
    expect(results.map((e) => e.id)).toEqual(['ok:1']);
  });
});

describe('schema validation', () => {
  const valid = () =>
    buildReport('insp-1', { ...input('hello world') }, [evidence({ id: 'e1' })], now());

  it('accepts a well-formed report', () => {
    expect(validateReport(valid())).toEqual({ valid: true, errors: [] });
  });

  it('rejects a bad digest', () => {
    const r = valid();
    r.input.digest.value = 'NOTHEX';
    expect(validateReport(r).valid).toBe(false);
  });

  it('rejects raw bytes in an exported report', () => {
    const r = valid() as unknown as { input: { bytes?: unknown } };
    r.input.bytes = new ArrayBuffer(4);
    expect(validateReport(r).errors.join(' ')).toMatch(/bytes must not be present/);
  });

  it('rejects an invalid result value', () => {
    const r = valid();
    (r.evidence[0] as { result: string }).result = 'ai-generated';
    expect(validateReport(r).errors.join(' ')).toMatch(/result invalid/);
  });

  it('rejects a strongestSignal that names no evidence entry', () => {
    const r = valid();
    r.summary.strongestSignal = 'nope';
    expect(validateReport(r).errors.join(' ')).toMatch(/strongestSignal/);
  });

  it('rejects a non-object', () => {
    expect(validateReport(null).valid).toBe(false);
  });
});
