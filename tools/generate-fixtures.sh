#!/usr/bin/env bash
#
# Generate a longer watermarked fixture record.
#
# Everything this repo needs to *detect* a watermark is checked in. Generating one needs the
# language model, which is the one thing the browser never runs — so this script exists to
# make that step a single command rather than a six-step runbook with one silent failure mode
# in the middle.
#
# It clones the upstream lab, installs the *pinned* reference implementation, raises the
# generation length, runs upstream's own generation script, and drops the record where
# tools/build-fixtures.mjs looks for it.
#
#   ./tools/generate-fixtures.sh [--tokens 1000] [--seed 20260915] [--workdir .fixture-build]
#                                [--model openai-community/gpt2]
#
# Afterwards:
#   node tools/build-fixtures.mjs && node tools/build-fixture-page.mjs && npm test
#
# Requirements: python3 (3.9-3.12), git, and network access to PyPI, GitHub, and
# huggingface.co — the model weights are downloaded on first run (~550MB for the default
# gpt2; a larger --model, e.g. gpt2-large or gpt2-xl, downloads proportionally more).
#
# This does NOT need a GPU. Every GPT-2 size is decoded one token at a time with a KV
# cache; CPU finishes in minutes even at gpt2-xl (1.5B params), and upstream's processor
# pins device=cpu regardless. --model must stay a GPT-2 variant: every size shares the
# same tokenizer (verified byte-identical vocab/merges across gpt2..gpt2-xl), which is
# what the detector's tokenizer_id check requires. A different model family would need a
# different tokenizer and is out of scope for this script.

set -euo pipefail

TOKENS=1000
SEED=20260915
WORKDIR=".fixture-build"
MODEL="openai-community/gpt2"
UPSTREAM="https://github.com/systemslibrarian/crypto-lab-token-tell"
# The construction this repo's detector implements. Pinned deliberately — see below.
PIN="addb4a158143c7c6851a1308f78b89fceed59683"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tokens)  TOKENS="$2"; shift 2 ;;
    --seed)    SEED="$2";   shift 2 ;;
    --workdir) WORKDIR="$2"; shift 2 ;;
    --model)   MODEL="$2";  shift 2 ;;
    -h|--help) sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# GPT-2's context window is 1024 tokens for every model size, and they all share the
# tokenizer, so a larger GPT-2 buys nothing. Prompt plus generation must fit.
if (( TOKENS > 1000 )); then
  echo "error: --tokens ${TOKENS} exceeds what GPT-2's 1024-token context leaves room for." >&2
  echo "       Use 1000 or less. For a longer passage, generate more samples instead:" >&2
  echo "       build-fixtures.mjs concatenates every watermarked sample in the record." >&2
  exit 2
fi

echo "==> workspace: ${WORKDIR}"
if [[ -d "${WORKDIR}/.git" ]]; then
  echo "    reusing existing checkout"
else
  mkdir -p "$(dirname "${WORKDIR}")"
  git clone --quiet "${UPSTREAM}" "${WORKDIR}"
fi

cd "${WORKDIR}"

echo "==> python environment"
if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
python -m pip install --quiet --upgrade pip

# requirements-deepmind.txt pins synthid-text at the commit whose construction this repo's
# detector implements, and pins torch 2.4 / transformers 4.43 because synthid-text does.
#
# This pin is the whole point. SynthID-text has two published implementations that are
# genuinely different: the DeepMind reference seeds its hash chain from a SHA-256
# initialization vector over the key list, while transformers seeds from the literal 1 and
# reads g-values from a torch-RNG table. Text watermarked by one is invisible to the other.
# Generating with transformers' SynthIDTextWatermarkLogitsProcessor produces a fixture that
# scores at the 0.5 null and looks exactly like a broken detector.
echo "==> installing the pinned reference implementation (this takes a few minutes)"
python -m pip install --quiet -r tools/requirements-deepmind.txt

if ! python -c "import synthid_text" 2>/dev/null; then
  echo "error: synthid_text did not install. Nothing was generated." >&2
  exit 1
fi

echo "==> setting generation length to ${TOKENS} tokens, model to ${MODEL}"
python - "$TOKENS" "$MODEL" <<'PY'
import json, sys
from pathlib import Path
tokens = int(sys.argv[1])
model = sys.argv[2]
p = Path("src/data/watermark-config.json")
cfg = json.loads(p.read_text())
cfg["decoding"]["max_new_tokens"] = tokens
# min == max suppresses end-of-text for the whole run, so the watermarked and control
# samples come out the same length and differ in the watermark alone.
cfg["decoding"]["min_new_tokens"] = tokens
# tokenizer_id is left untouched: it is what the detector's validation checks, and every
# GPT-2 size shares it. model_id only selects which weights generate the text.
cfg["model"]["model_id"] = model
p.write_text(json.dumps(cfg, indent=2) + "\n")
print(f"    max_new_tokens = min_new_tokens = {tokens}")
print(f"    model_id = {model}")
PY

echo "==> generating (downloads the model on first run)"
python tools/generate_texts.py --seed "${SEED}"

cd "${REPO_ROOT}"
mkdir -p fixtures/generated
cp "${WORKDIR}/src/data/pinned/texts.json" fixtures/generated/texts-long.json
echo
echo "==> wrote fixtures/generated/texts-long.json"
echo
echo "Next:"
echo "  node tools/build-fixtures.mjs      # rebuilds fixtures/text/, refuses a bad record"
echo "  node tools/build-fixture-page.mjs  # rebuilds the demo article"
echo "  npm test                           # re-checks the matrix against the new numbers"
echo
echo "build-fixtures.mjs validates the record against this repo's detector configuration"
echo "and rejects a watermarked sample the reference itself scored near 0.5 — the signature"
echo "of having generated with the wrong SynthID implementation."
