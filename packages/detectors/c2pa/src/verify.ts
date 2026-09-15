/**
 * The verification call itself.
 *
 * Kept separate from the transport in `sdk.ts` because this is the part that has a hard
 * environment requirement: the C2PA engine reads the asset through `FileReaderSync`, a
 * Worker-only API. That single fact determines the whole shape of this detector — see
 * `sdk.ts` for what it forced.
 */

import init, { WasmReader, type InitInput } from '@contentauth/c2pa-wasm';
import type { Reader as ManifestStore } from '@contentauth/c2pa-types';

let ready: Promise<void> | null = null;

/**
 * Initialize the engine once per realm.
 *
 * `source` lets a caller hand over the binary as bytes; the worker passes a URL it fetches
 * from the extension's own origin, and tests pass the bytes directly because Node cannot
 * fetch a bundler asset URL.
 */
export function initC2pa(source: InitInput): Promise<void> {
  if (!ready) ready = init({ module_or_path: source }).then(() => undefined);
  return ready;
}

/** Thrown when the asset carries no C2PA data at all, as distinct from carrying bad data. */
export class NoCredentialError extends Error {
  constructor(readonly detail: string) {
    super('No C2PA manifest found in this asset');
    this.name = 'NoCredentialError';
  }
}

export async function readManifestStore(format: string, bytes: ArrayBuffer): Promise<ManifestStore> {
  const blob = new Blob([bytes], { type: format });
  let reader: WasmReader | undefined;
  try {
    reader = await WasmReader.fromBlob(format, blob);
    return reader.manifestStore() as ManifestStore;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    // The engine reports an asset with no JUMBF box by throwing. That is a finding, not a
    // malfunction, so it is given its own type rather than being lumped in with real errors.
    if (/JumbfNotFound/i.test(detail)) throw new NoCredentialError(detail);
    throw cause;
  } finally {
    reader?.free();
  }
}
