/**
 * The browser tokenizer against the Hugging Face tokenizer.
 *
 * A detector that tokenizes differently from the generator is scoring a different
 * sequence, so this suite is not a nicety. Every expectation was produced by the real
 * GPT-2 tokenizer at the pinned revision and committed by tools/make_test_vectors.py.
 */

import { describe, expect, it } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';

import mergesBlob from '../data/pinned/gpt2-merges.txt?raw';
import tokenizerMeta from '../data/pinned/tokenizer-meta.json';
import tokenizerVectors from '../data/pinned/tokenizer-vectors.json';
import texts from '../data/pinned/texts.json';

import { createGpt2Tokenizer, END_OF_TEXT } from './gpt2.ts';
import { byteTokensInVocabOrder, byteToChar, charToByte } from './byte-level.ts';

const tokenizer = createGpt2Tokenizer(mergesBlob);

function hexOf(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

describe('the byte-level alphabet', () => {
  it('covers all 256 byte values exactly once', () => {
    expect(byteToChar.filter(Boolean)).toHaveLength(256);
    expect(new Set(byteToChar).size).toBe(256);
    expect(charToByte.size).toBe(256);
  });

  it('round-trips every byte', () => {
    for (let b = 0; b < 256; b++) expect(charToByte.get(byteToChar[b])).toBe(b);
  });

  it('assigns id 0 to "!" rather than to the NUL byte', () => {
    // The order is GPT-2's construction order, not 0..255. Getting this wrong shifts the
    // whole vocabulary by 256 and every g-value with it.
    expect(byteTokensInVocabOrder[0]).toBe('!');
    expect(byteTokensInVocabOrder).toHaveLength(256);
  });
});

describe('the derived vocabulary', () => {
  it('has the size the real tokenizer reports', () => {
    expect(tokenizer.vocabSize).toBe(tokenizerMeta.vocab_size);
  });

  it('hashes to the real vocabulary', async () => {
    // The vocabulary is not shipped: it is rebuilt from the merge list as the 256 byte
    // tokens, the merge results in order, and the end-of-text marker. This is the check
    // that the reconstruction is the real thing and not merely plausible.
    const blob = tokenizer.vocabulary().join('\n');
    expect(hexOf(sha256(new TextEncoder().encode(blob)))).toBe(tokenizerMeta.vocab_sha256);
  });

  it('places the end-of-text marker last', () => {
    expect(tokenizer.tokenString(tokenizer.eosTokenId)).toBe(END_OF_TEXT);
    expect(tokenizer.eosTokenId).toBe(tokenizerMeta.vocab_size - 1);
  });

  it('hashes the merge list to the value recorded at export', async () => {
    expect(hexOf(sha256(new TextEncoder().encode(mergesBlob)))).toBe(tokenizerMeta.merges_sha256);
  });
});

describe('encoding against the reference tokenizer', () => {
  for (const testCase of tokenizerVectors.cases) {
    it(`encodes ${JSON.stringify(testCase.text)}`, () => {
      expect(tokenizer.encode(testCase.text)).toEqual(testCase.token_ids);
    });

    it(`decodes ${JSON.stringify(testCase.text)} back`, () => {
      expect(tokenizer.decode(testCase.token_ids)).toBe(testCase.decoded);
    });

    it(`names the tokens of ${JSON.stringify(testCase.text)} the same way`, () => {
      expect(testCase.token_ids.map((id: number) => tokenizer.tokenString(id)))
        .toEqual(testCase.token_strings);
    });
  }
});

describe('the pinned samples', () => {
  for (const [name, sample] of Object.entries(texts.samples)) {
    it(`re-tokenizes ${name} to the ids the generator produced`, () => {
      // The detector reads text, not token ids. If tokenizing the committed text does not
      // reproduce the committed ids, every score on this page is measuring the wrong
      // sequence.
      expect(tokenizer.encode(sample.text)).toEqual(sample.token_ids);
    });

    it(`decodes ${name} back to its committed text`, () => {
      expect(tokenizer.decode(sample.token_ids)).toBe(sample.text);
    });
  }
});
