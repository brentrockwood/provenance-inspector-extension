/**
 * Choosing how to reach the verification engine.
 *
 * Two realms can run it. Inside a Worker, `FileReaderSync` exists and the engine is called
 * directly — that is the path `worker.ts` takes, and the path tests take with a shim. On a
 * document's main thread it does not exist, so the work is handed to a worker loaded from the
 * extension's own origin.
 *
 * The detector does not know or care which of these happened. Replacing this file with a call
 * into a future SDK that can load its own worker under a Manifest V3 policy would leave
 * `detector.ts` untouched.
 */

import type { Reader as ManifestStore } from '@contentauth/c2pa-types';
import { NoCredentialError, readManifestStore } from './verify.ts';
import type { VerifyRequest, VerifyResponse } from './worker.ts';

/** Where the bundled worker lands, relative to the page that loads it. */
const WORKER_FILE = 'c2pa-worker.js';

function canVerifyDirectly(): boolean {
  return typeof (globalThis as { FileReaderSync?: unknown }).FileReaderSync !== 'undefined';
}

let worker: Worker | null = null;
let nextId = 0;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL(WORKER_FILE, location.href), { type: 'module' });
  }
  return worker;
}

function verifyInWorker(format: string, bytes: ArrayBuffer): Promise<ManifestStore> {
  const id = nextId++;
  const w = getWorker();
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent<VerifyResponse>) => {
      if (event.data.id !== id) return;
      w.removeEventListener('message', onMessage);
      if (event.data.ok) {
        resolve(event.data.store as ManifestStore);
      } else if (event.data.noCredential) {
        reject(new NoCredentialError(event.data.error));
      } else {
        reject(new Error(event.data.error));
      }
    };
    w.addEventListener('message', onMessage);
    // The buffer is transferred rather than copied; the caller has already digested it.
    w.postMessage({ id, format, bytes } satisfies VerifyRequest, [bytes]);
  });
}

export function verifyAsset(format: string, bytes: ArrayBuffer): Promise<ManifestStore> {
  return canVerifyDirectly() ? readManifestStore(format, bytes) : verifyInWorker(format, bytes);
}

export { NoCredentialError };
