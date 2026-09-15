/**
 * The pinned g-value sampling table.
 *
 * PINNED EMPIRICAL DATA — the reference implementation builds this table with a torch RNG
 * (`torch.randint(0, 2, (sampling_table_size,), generator=manual_seed(seed))`), and a browser
 * cannot reproduce torch's RNG. So the table is captured once by tools/capture_sampling_table.py
 * and committed with its sha256; everything else about the g-function is recomputed here.
 *
 * This is the one place where the lab consumes a value it cannot re-derive in the browser, so it is
 * checked rather than trusted: src/lab-config.ts recomputes both committed digests at load — over
 * the packed blob, and over the bytes `at()` returns — and refuses the page if either differs.
 */

export interface SamplingTable {
  readonly size: number;
  /** table[i] as 0 or 1. */
  at(index: number): number;
}

/** Decode the little-endian bit packing written by tools/capture_sampling_table.py. */
export function samplingTableFromPackedBase64(packedBase64: string, size: number): SamplingTable {
  const binary = atob(packedBase64);
  const expectedBytes = Math.ceil(size / 8);
  if (binary.length !== expectedBytes) {
    throw new Error(
      `sampling table is ${binary.length} bytes, expected ${expectedBytes} for size ${size}`,
    );
  }
  const bytes = new Uint8Array(expectedBytes);
  for (let i = 0; i < expectedBytes; i++) bytes[i] = binary.charCodeAt(i);
  return {
    size,
    at(index: number): number {
      return (bytes[index >> 3] >> (index & 7)) & 1;
    },
  };
}

/** Count of ones — the table is meant to be an unbiased coin, and a page that claims so should show it. */
export function tableOnes(table: SamplingTable): number {
  let ones = 0;
  for (let i = 0; i < table.size; i++) ones += table.at(i);
  return ones;
}
