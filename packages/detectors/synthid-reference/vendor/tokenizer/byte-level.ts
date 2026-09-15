/**
 * GPT-2's byte-level alphabet.
 *
 * GPT-2 does BPE over bytes, not over characters, so that any byte sequence at all can
 * be encoded. To keep the merge table printable it first maps each of the 256 byte
 * values to a single printable Unicode code point — which is why a space shows up as
 * "Ġ" and a newline as "Ċ" when you look at raw GPT-2 tokens.
 *
 * REFERENCE-IMPLEMENTATION-FAITHFUL to GPT-2's `bytes_to_unicode`.
 */

function buildByteAlphabet(): { toChar: string[]; fromChar: Map<string, number> } {
  const bs: number[] = [];
  const push = (from: number, to: number) => {
    for (let b = from; b <= to; b++) bs.push(b);
  };
  push(0x21, 0x7e); // '!' .. '~'
  push(0xa1, 0xac); // '¡' .. '¬'
  push(0xae, 0xff); // '®' .. 'ÿ'

  const cs = bs.slice();
  let n = 0;
  for (let b = 0; b < 256; b++) {
    if (!bs.includes(b)) {
      bs.push(b);
      cs.push(256 + n);
      n += 1;
    }
  }

  const toChar: string[] = new Array(256);
  const fromChar = new Map<string, number>();
  for (let i = 0; i < bs.length; i++) {
    const ch = String.fromCodePoint(cs[i]);
    toChar[bs[i]] = ch;
    fromChar.set(ch, bs[i]);
  }
  return { toChar, fromChar };
}

const ALPHABET = buildByteAlphabet();

/** Byte value -> printable stand-in character. */
export const byteToChar: readonly string[] = ALPHABET.toChar;

/** Printable stand-in character -> byte value. */
export const charToByte: ReadonlyMap<string, number> = ALPHABET.fromChar;

/**
 * The 256 byte tokens in the order GPT-2 assigns them ids 0..255.
 *
 * The order is the construction order above, not 0..255 — which is why token id 0 is
 * "!" and not a NUL byte.
 */
export const byteTokensInVocabOrder: readonly string[] = (() => {
  const bs: number[] = [];
  const push = (from: number, to: number) => {
    for (let b = from; b <= to; b++) bs.push(b);
  };
  push(0x21, 0x7e);
  push(0xa1, 0xac);
  push(0xae, 0xff);
  const cs = bs.slice();
  let n = 0;
  for (let b = 0; b < 256; b++) {
    if (!bs.includes(b)) {
      bs.push(b);
      cs.push(256 + n);
      n += 1;
    }
  }
  return cs.map((c) => String.fromCodePoint(c));
})();
