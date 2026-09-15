/**
 * The C2PA half of the fixture matrix, against real signed assets.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { digestBytes, type InspectionInput } from '@provenance/evidence';
import { c2paDetector as detector } from './detector.ts';
import { initC2pa } from './verify.ts';

const context = { now: () => '2026-09-15T00:00:00.000Z' };

const fixture = (name: string): ArrayBuffer => {
  const buf = readFileSync(
    fileURLToPath(new URL(`../../../../fixtures/images/${name}`, import.meta.url)),
  );
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
};

const imageInput = (bytes: ArrayBuffer, name: string): InspectionInput => ({
  id: name,
  kind: 'image',
  bytes,
  mimeType: 'image/jpeg',
  source: {
    pageUrl: 'https://example.test/fixture',
    assetUrl: `https://example.test/${name}`,
    extractionMethod: 'asset',
  },
  digest: digestBytes(bytes),
});

beforeAll(async () => {
  // Node cannot fetch the bundler's asset URL, so the binary is handed over as bytes. The
  // FileReaderSync shim in test/ is what lets the engine run outside a Worker at all.
  const wasm = readFileSync(
    fileURLToPath(
      new URL('../../../../node_modules/@contentauth/c2pa-wasm/pkg/c2pa_bg.wasm', import.meta.url),
    ),
  );
  await initC2pa(wasm);
}, 120_000);

describe('applicability', () => {
  it('requires bytes, and never fetches an asset itself', () => {
    expect(detector.supports(imageInput(fixture('unsigned.jpg'), 'x'))).toBe(true);
    const noBytes = { ...imageInput(new ArrayBuffer(0), 'x'), bytes: undefined };
    expect(detector.supports(noBytes)).toBe(false);
    expect(detector.remote).toBe(false);
  });
});

describe('valid signed asset', () => {
  it('verifies and names its claimed issuer', async () => {
    const [e] = await detector.detect(imageInput(fixture('signed-valid.jpg'), 'valid'), context);
    const d = e.details as Record<string, unknown>;
    console.log(
      `signed-valid: result=${e.result} state=${d.validationState} issuer=${d.issuer} ` +
        `generator=${d.claimGenerator} assertions=${(d.assertions as string[])?.length}`,
    );
    expect(e.result).toBe('positive');
    expect(e.strength).toBe('cryptographic');
    expect(e.issuer).toBeTruthy();
  });

  it('scopes the claim to the asset, never to the page', async () => {
    const [e] = await detector.detect(imageInput(fixture('signed-valid.jpg'), 'valid'), context);
    expect(e.scope).toBe('asset');
    expect(e.limitations.join(' ')).toMatch(/covers the inspected image only/i);
    expect(e.limitations.join(' ')).toMatch(/does not extend to the page text/i);
  });
});

describe('unsigned asset', () => {
  it('reports no credential without implying anything about the image', async () => {
    const [e] = await detector.detect(imageInput(fixture('unsigned.jpg'), 'unsigned'), context);
    console.log(`unsigned: result=${e.result} summary="${e.summary}"`);
    expect(e.result).toBe('negative');
    expect(e.limitations.join(' ')).toMatch(/says nothing about how the image was made/i);
  });
});

describe('tampered asset', () => {
  it('is never rendered as verified', async () => {
    const [e] = await detector.detect(
      imageInput(fixture('signed-tampered.jpg'), 'tampered'),
      context,
    );
    const d = e.details as Record<string, unknown>;
    console.log(
      `signed-tampered: result=${e.result} state=${d.validationState} codes=${JSON.stringify(d.validationCodes)}`,
    );
    expect(e.result).not.toBe('positive');
    expect(d.validationState).not.toBe('Valid');
    expect(d.validationState).not.toBe('Trusted');
  });

  it('distinguishes a failed credential from an absent one', async () => {
    const [tampered] = await detector.detect(
      imageInput(fixture('signed-tampered.jpg'), 't'),
      context,
    );
    const [absent] = await detector.detect(imageInput(fixture('unsigned.jpg'), 'u'), context);
    expect(tampered.summary).not.toBe(absent.summary);
  });
});
