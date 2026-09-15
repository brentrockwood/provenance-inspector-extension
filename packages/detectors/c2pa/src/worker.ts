/**
 * C2PA verification worker.
 *
 * The maintained `@contentauth/c2pa-web` SDK ships its own worker, but it will only load one
 * from an `https:` URL or an inline `blob:` URL. A Manifest V3 extension can offer neither:
 * its pages are served from `chrome-extension:` and its content security policy is fixed at
 * `script-src 'self' 'wasm-unsafe-eval'`. So this file is the SDK's worker layer, rewritten
 * to load from the extension's own origin. The verification engine below it is the
 * maintained one, unmodified.
 */

import wasmUrl from '@contentauth/c2pa-wasm/c2pa.wasm?url';
import { NoCredentialError, initC2pa, readManifestStore } from './verify.ts';

export interface VerifyRequest {
  id: number;
  format: string;
  bytes: ArrayBuffer;
}

export type VerifyResponse =
  | { id: number; ok: true; store: unknown }
  | { id: number; ok: false; noCredential: boolean; error: string };

self.addEventListener('message', async (event: MessageEvent<VerifyRequest>) => {
  const { id, format, bytes } = event.data;
  try {
    // Same-origin fetch of a file inside the extension: no host permission, no network.
    await initC2pa(wasmUrl);
    const store = await readManifestStore(format, bytes);
    (self as unknown as Worker).postMessage({ id, ok: true, store } satisfies VerifyResponse);
  } catch (cause) {
    (self as unknown as Worker).postMessage({
      id,
      ok: false,
      noCredential: cause instanceof NoCredentialError,
      error: cause instanceof Error ? cause.message : String(cause),
    } satisfies VerifyResponse);
  }
});
