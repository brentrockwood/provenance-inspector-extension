/**
 * Input digesting.
 *
 * The digest exists so a reported result can be repeated against the same bytes. It is
 * computed over the exact inspected content — not a normalized or trimmed form — because a
 * digest that does not match what the detector saw is worse than no digest at all.
 */

import { sha256 } from '@noble/hashes/sha2.js';

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/** Synchronous SHA-256, usable in a service worker and in tests without WebCrypto. */
export function sha256Hex(data: Uint8Array): string {
  return bytesToHex(sha256(data));
}

export function digestText(text: string): { algorithm: 'SHA-256'; value: string } {
  return { algorithm: 'SHA-256', value: sha256Hex(encodeUtf8(text)) };
}

export function digestBytes(bytes: ArrayBuffer): { algorithm: 'SHA-256'; value: string } {
  return { algorithm: 'SHA-256', value: sha256Hex(new Uint8Array(bytes)) };
}
