/**
 * The watermark configuration, and the vocabulary for talking about it.
 *
 * Parameter names are the reference implementation's
 * (google-deepmind/synthid-text @ addb4a1, `SynthIDLogitsProcessor.__init__` and
 * `DEFAULT_WATERMARKING_CONFIG`), deliberately — a lab that renames them makes its own
 * numbers impossible to line up against the implementation it claims to follow.
 *
 * One name does not survive the trip unchanged, and the difference matters:
 * the repository's `ngram_len` is the paper's context window H plus one. Its own source
 * comment says so: "This corresponds to H=4 context window size in the paper."
 */

export interface WatermarkParams {
  /** ngram_len: the ngram_len - 1 context tokens plus the candidate. Paper's H + 1. */
  readonly ngramLen: number;
  /** One watermarking key per tournament layer. Depth is defined as keys.length. */
  readonly keys: readonly number[];
  /** How many recent context hashes the repeated-context rule remembers. */
  readonly contextHistorySize: number;
  /** Competitors per match. 2 is the non-distortionary configuration; more is distortionary. */
  readonly numLeaves: number;
  /** Whether generation left the first ngram_len - 1 tokens unwatermarked. */
  readonly skipFirstNgramCalls: boolean;
}

/**
 * Tournament depth is not a separate parameter: it is the number of keys.
 *
 * The paper parameterizes differently — it has one watermarking key k and passes the
 * layer number as an argument to the hash — so "depth = number of keys" is a property of
 * the implementation, not of the scheme. The reference makes the identity explicit where
 * its detector reads `watermarking_depth=len(logits_processor.keys)`.
 */
export function depth(params: WatermarkParams): number {
  return params.keys.length;
}

export function withKeys(params: WatermarkParams, keys: readonly number[]): WatermarkParams {
  return { ...params, keys: [...keys] };
}

/**
 * Number of positions a sequence offers the detector before masking.
 *
 * Detection slides an ngram_len window over the tokens, so the first ngram_len - 1
 * tokens are never scored as candidates — they only ever appear as context. A score
 * reported without this count is not interpretable, which is why every scoring result in
 * this lab carries it.
 */
export function candidatePositionCount(tokenCount: number, params: WatermarkParams): number {
  return Math.max(0, tokenCount - (params.ngramLen - 1));
}

export function paramsFromConfig(raw: {
  ngram_len: number;
  keys: number[];
  context_history_size: number;
  num_leaves: number;
  skip_first_ngram_calls: boolean;
}): WatermarkParams {
  return {
    ngramLen: raw.ngram_len,
    keys: raw.keys,
    contextHistorySize: raw.context_history_size,
    numLeaves: raw.num_leaves,
    skipFirstNgramCalls: raw.skip_first_ngram_calls,
  };
}
