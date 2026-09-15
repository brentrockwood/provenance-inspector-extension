/**
 * GPT-2 byte-level BPE, in the browser.
 *
 * Detection does not need the language model, but it does need the model's tokenizer:
 * g-values are computed over token ids, so a detector that tokenizes differently from
 * the generator is scoring a different sequence and its number means nothing. That is
 * one of the assumptions the adversarial test matrix deliberately breaks.
 *
 * REFERENCE-IMPLEMENTATION-FAITHFUL to GPT-2's tokenizer, and held to it by differential
 * vectors: tools/make_test_vectors.py records what the Hugging Face tokenizer produces
 * at the pinned revision, and the unit suite makes this code reproduce them exactly.
 *
 * The vocabulary is not shipped. GPT-2's vocabulary is exactly the 256 byte tokens, then
 * the 50,000 merge results in merge order, then the end-of-text marker — so it is
 * derived here from the merge list and checked against the sha256 of the real
 * vocabulary recorded in src/data/pinned/tokenizer-meta.json.
 */

import { byteToChar, charToByte, byteTokensInVocabOrder } from './byte-level.ts';

/** GPT-2's pre-tokenizer pattern, applied before any merging. */
export const GPT2_PRETOKENIZE_PATTERN =
  /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;

export const END_OF_TEXT = '<|endoftext|>';

export interface Gpt2Tokenizer {
  readonly vocabSize: number;
  readonly eosTokenId: number;
  encode(text: string): number[];
  decode(tokenIds: readonly number[]): string;
  /** The printable stand-in form of one token, e.g. "Ġlibrary". */
  tokenString(id: number): string;
  /** The text a single token contributes, with byte stand-ins resolved. */
  tokenText(id: number): string;
  /** The whole vocabulary in id order — derived, not shipped. */
  vocabulary(): readonly string[];
}

/** Build a tokenizer from the newline-separated merge list. */
export function createGpt2Tokenizer(mergesBlob: string): Gpt2Tokenizer {
  // Only the version header is dropped. GPT-2 has real merges whose left half is "#",
  // so filtering every line that starts with a hash silently deletes them and shifts
  // every id after that point — which shows up as a tokenizer that is almost right.
  const merges = mergesBlob
    .split('\n')
    .filter((line) => line.length > 0 && !line.startsWith('#version'));

  const ranks = new Map<string, number>();
  merges.forEach((line, i) => ranks.set(line, i));

  const vocab: string[] = [
    ...byteTokensInVocabOrder,
    ...merges.map((line) => line.split(' ').join('')),
    END_OF_TEXT,
  ];
  const idOf = new Map<string, number>();
  vocab.forEach((token, id) => {
    // A later duplicate must not overwrite an earlier id: GPT-2 assigns the lowest id.
    if (!idOf.has(token)) idOf.set(token, id);
  });

  const bpeCache = new Map<string, string[]>();

  function bpe(token: string): string[] {
    const cached = bpeCache.get(token);
    if (cached) return cached;

    let word = Array.from(token);
    if (word.length > 1) {
      for (;;) {
        let bestRank = Infinity;
        let bestIndex = -1;
        for (let i = 0; i < word.length - 1; i++) {
          const rank = ranks.get(`${word[i]} ${word[i + 1]}`);
          if (rank !== undefined && rank < bestRank) {
            bestRank = rank;
            bestIndex = i;
          }
        }
        if (bestIndex === -1) break;
        const first = word[bestIndex];
        const second = word[bestIndex + 1];
        const merged: string[] = [];
        for (let i = 0; i < word.length; ) {
          if (i < word.length - 1 && word[i] === first && word[i + 1] === second) {
            merged.push(first + second);
            i += 2;
          } else {
            merged.push(word[i]);
            i += 1;
          }
        }
        word = merged;
      }
    }
    bpeCache.set(token, word);
    return word;
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder('utf-8');

  return {
    vocabSize: vocab.length,
    eosTokenId: vocab.length - 1,

    encode(text: string): number[] {
      const ids: number[] = [];
      // Text is split on the end-of-text marker so a pasted transcript containing it
      // tokenizes the way the model would see it, rather than as literal angle brackets.
      for (const [index, chunk] of text.split(END_OF_TEXT).entries()) {
        if (index > 0) ids.push(vocab.length - 1);
        for (const match of chunk.matchAll(GPT2_PRETOKENIZE_PATTERN)) {
          const piece = match[0];
          let mapped = '';
          for (const byte of encoder.encode(piece)) mapped += byteToChar[byte];
          for (const sub of bpe(mapped)) {
            const id = idOf.get(sub);
            if (id === undefined) {
              throw new Error(`token not in derived vocabulary: ${JSON.stringify(sub)}`);
            }
            ids.push(id);
          }
        }
      }
      return ids;
    },

    decode(tokenIds: readonly number[]): string {
      let mapped = '';
      for (const id of tokenIds) mapped += vocab[id] ?? '';
      const bytes: number[] = [];
      for (const ch of Array.from(mapped)) {
        const byte = charToByte.get(ch);
        // The end-of-text marker is not byte-level; its characters pass through as text.
        if (byte === undefined) {
          for (const b of encoder.encode(ch)) bytes.push(b);
        } else {
          bytes.push(byte);
        }
      }
      return decoder.decode(new Uint8Array(bytes));
    },

    tokenString(id: number): string {
      return vocab[id] ?? '';
    },

    tokenText(id: number): string {
      return this.decode([id]);
    },

    vocabulary(): readonly string[] {
      return vocab;
    },
  };
}
