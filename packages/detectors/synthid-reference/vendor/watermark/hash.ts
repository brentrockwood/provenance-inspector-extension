/**
 * The keyed hash underneath every g-value.
 *
 * REFERENCE-IMPLEMENTATION-FAITHFUL — google-deepmind/synthid-text @ addb4a1,
 * `synthid_text/hashing_function.py:accumulate_hash`, which describes itself as an
 * "adapted linear congruential generator (LCG) with newlib/musl parameters" and runs on
 * torch int64 tensors, so every step wraps modulo 2^64 with a sign. The identical
 * function, with the identical constants, is what transformers 5.15.1 uses.
 *
 * That repository's README states the security position plainly, and this lab repeats it
 * rather than softening it:
 *
 *   "NOTE: The `synthid_text.hashing_function.accumulate_hash()` function, used while
 *    computing G values in this reference implementation, does not provide any
 *    guarantees of cryptographic security."
 *
 *     current_hash = ((current_hash + data_i) * multiplier + increment)   as int64
 *
 * `BigInt.asIntN(64, …)` reproduces that wraparound exactly; the cross-language vectors
 * in src/data/pinned/test-vectors.json are what actually hold the two implementations
 * together.
 */

/** Multiplier of the linear congruential generator (newlib/musl). */
export const MULTIPLIER = 6364136223846793005n;

/** Increment of the linear congruential generator. */
export const INCREMENT = 1n;

/**
 * The seed transformers 5.15.1 starts every hash chain from.
 *
 * google-deepmind/synthid-text @ addb4a1 starts from a key-derived initialization
 * vector instead (see `hashIvFromKeys`) — one of the concrete differences between the
 * two implementations.
 */
export const TRANSFORMERS_HASH_SEED = 1n;

/** One accumulation step. Exported so a test can pin the step, not just the chain. */
export function accumulateStep(currentHash: bigint, value: number | bigint): bigint {
  return BigInt.asIntN(64, (currentHash + BigInt(value)) * MULTIPLIER + INCREMENT);
}

/**
 * Fold a sequence of integers into a running hash.
 *
 * The reference implementation notes the property f(x, data[:T]) = f(f(x, data[:T-1]),
 * data[T]) — which is why the context can be hashed once and the candidate token and the
 * watermarking keys folded in afterwards, and why the key enters last.
 */
export function accumulateHash(currentHash: bigint, data: readonly number[]): bigint {
  let h = currentHash;
  for (let i = 0; i < data.length; i++) h = accumulateStep(h, data[i]);
  return h;
}

/**
 * Index into the sampling table.
 *
 * torch's `%` follows Python semantics and returns a non-negative result for a positive
 * divisor; JavaScript's `%` keeps the sign of the dividend, so the sign has to be put
 * back by hand. Getting this wrong is silent: it only shows up on the ~50% of hashes
 * that land negative.
 */
export function tableIndex(hash: bigint, tableSize: number): number {
  const size = BigInt(tableSize);
  return Number(((hash % size) + size) % size);
}

/**
 * The key-derived initialization vector.
 *
 * REFERENCE-IMPLEMENTATION-FAITHFUL — google-deepmind/synthid-text @ addb4a1,
 * `logits_processing.py:162-176`:
 *
 *     # Hash the keys to a string to be used as initialization vector (IV)
 *     # for the hash function. Very important to have an unpredictable IV.
 *     self.hash_iv = hashlib.sha256(self.keys.to(torch.long).numpy().tobytes()).digest()
 *     torch_long_max = torch.iinfo(torch.int64).max
 *     self.hash_iv = int.from_bytes(self.hash_iv, byteorder="big") % torch_long_max
 *
 * The keys are packed as little-endian int64 (numpy's native order on the platforms the
 * reference implementation runs on), hashed with SHA-256, read back big-endian, and
 * reduced modulo 2^63 - 1.
 *
 * This single SHA-256 is the only cryptographic primitive anywhere in the construction.
 * Everything after it is the linear congruential generator above — which is why "keyed"
 * here does not mean "cryptographically unforgeable", and why this lab never calls the
 * watermark a signature.
 */
export function hashIvFromKeys(keys: readonly number[], sha256: (data: Uint8Array) => Uint8Array): bigint {
  const packed = new Uint8Array(keys.length * 8);
  const view = new DataView(packed.buffer);
  keys.forEach((key, i) => view.setBigInt64(i * 8, BigInt(key), true /* little-endian */));
  const digest = sha256(packed);
  let value = 0n;
  for (const byte of digest) value = (value << 8n) | BigInt(byte);
  return value % INT64_MAX;
}

/** torch.iinfo(torch.int64).max — the modulus the reference implementation reduces by. */
export const INT64_MAX = (1n << 63n) - 1n;

/**
 * Arithmetic right shift on the signed 64-bit value.
 *
 * torch's `>>` on an int64 tensor sign-extends, and JavaScript's BigInt `>>` does too,
 * so this is a rename rather than a reimplementation — kept as a named function because
 * the sign behaviour is the part that is easy to get wrong when porting.
 */
export function shiftRight(value: bigint, bits: number): bigint {
  return value >> BigInt(bits);
}
