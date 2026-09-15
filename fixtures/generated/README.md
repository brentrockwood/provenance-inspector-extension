# Generating longer fixtures

The fixtures checked in under `fixtures/text/` are derived from the 320-token samples that
came vendored with the SynthID port. That is enough to prove the detector works, but the demo
passage is 476 words — short for a screenshot meant to look like a real article.

Dropping a file named **`texts-long.json`** in this directory supersedes the vendored record:
`tools/build-fixtures.mjs` will build every text fixture from it instead, and
`fixtures/fixtures.test.ts` will re-point at it automatically. Nothing else needs editing.

## The one mistake that fails silently

**Generate with `google-deepmind/synthid-text`, not HuggingFace's
`SynthIDTextWatermarkLogitsProcessor`.**

They implement the same scheme in genuinely different ways. The DeepMind reference seeds its
hash chain from a SHA-256 initialization vector over the key list; transformers seeds from the
literal `1` and reads g-values from a table of random bits built by a torch RNG. Text
watermarked by one is invisible to the other.

This detector implements the DeepMind construction. A fixture generated with the transformers
processor scores ≈ 0.50 and looks exactly like a broken detector. `build-fixtures.mjs` rejects
such a record with a message naming this cause, but it is cheaper to get right the first time.

## Steps

The upstream project ships the generation script, and it emits the reference implementation's
own scores alongside the text — which is what the differential test then checks us against.

```sh
git clone https://github.com/systemslibrarian/crypto-lab-token-tell tt && cd tt
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r tools/requirements-deepmind.txt   # pins synthid-text @ addb4a1, torch 2.4

# GPT-2's context is 1024 tokens, so one continuation tops out near 1015 tokens (~760 words).
# Raise both fields; min == max suppresses end-of-text for the whole run.
#   src/data/watermark-config.json -> decoding.max_new_tokens / min_new_tokens = 1000

python tools/generate_texts.py --seed 20260915
cp src/data/pinned/texts.json <this-repo>/fixtures/generated/texts-long.json
```

Then, back in this repo:

```sh
node tools/build-fixtures.mjs     # rebuilds fixtures/text/ and prints the new numbers
node tools/build-fixture-page.mjs # rebuilds the demo article
npm test
```

Use a dedicated virtualenv. `requirements-deepmind.txt` pins torch 2.4 / transformers 4.43
because `synthid-text` does, and it conflicts with the other requirements file in that repo.

## Notes

- **Do not run this on a GPU.** GPT-2 is 124M parameters and the script decodes one token at a
  time with a KV cache; a few thousand tokens finish on CPU in minutes. `make_processor` pins
  `device=torch.device("cpu")` anyway.
- **Length ceiling.** 1,024 tokens of context is a hard limit for every GPT-2 size, and they all
  share the tokenizer, so a bigger GPT-2 does not help. To exceed ~760 words, generate two or
  three samples with different prompts and seeds; `build-fixtures.mjs` concatenates every
  watermarked sample in the record. Each seam costs roughly `ngram_len - 1` positions that score
  as noise — negligible against thousands.
- **Prose quality degrades.** With end-of-text suppressed for 1,000 tokens at temperature 1.0 and
  top-k 40, GPT-2 wanders. If the screenshot needs to read well, the real fix is a modern model —
  which means a matching JS tokenizer on the detection side, a larger piece of work.
- **Keep prompts mundane.** The upstream script explains why: a striking prompt lets a reader
  credit the prompt rather than the mechanism for anything they notice in the output.
- **Never write into the vendored directory.** `packages/detectors/synthid-reference/vendor/` is
  upstream's code, and its 174 differential tests assert against the record it ships.

## What `build-fixtures.mjs` checks before accepting a record

- watermark keys, `ngram_len`, `context_history_size`, `num_leaves`, `skip_first_ngram_calls`
  all match the detector's configuration
- the tokenizer matches the one the detector is pinned to
- every sample carries `reference_scores.correct_key.score`
- every sample marked `watermarked: true` scored above 0.55 by the reference, and every control
  scored below it — the check that catches the wrong-construction mistake
