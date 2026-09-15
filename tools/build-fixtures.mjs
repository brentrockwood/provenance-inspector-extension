/**
 * Derive the checked-in text fixtures from a pinned generation record.
 *
 * The text is never authored by hand: it comes from a record that states the model,
 * revision, seed, decoding parameters, and watermark configuration each sample was
 * generated under, along with the reference implementation's own scores for it. Deriving
 * the fixtures mechanically is what makes the screenshot reproducible from the repository.
 *
 * Two records are possible, and the longer one wins when present:
 *
 *   fixtures/generated/texts-long.json   a local generation run (see that directory's README)
 *   packages/.../vendor/data/pinned/texts.json   the 320-token samples vendored with the port
 *
 * Run: node tools/build-fixtures.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const p = (rel) => fileURLToPath(new URL(rel, root));

const VENDOR = 'packages/detectors/synthid-reference/vendor';
const GENERATED_PATH = p('fixtures/generated/texts-long.json');

const config = JSON.parse(readFileSync(p(`${VENDOR}/data/watermark-config.json`), 'utf8'));
const vendored = JSON.parse(readFileSync(p(`${VENDOR}/data/pinned/texts.json`), 'utf8'));

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const words = (s) => s.trim().split(/\s+/).length;

/**
 * Refuse a record that the detector could not possibly score.
 *
 * This is the guard rail for the one mistake that fails silently. SynthID-text has two
 * published implementations whose constructions genuinely differ: the DeepMind reference
 * seeds its hash chain from a SHA-256 IV over the key list, while transformers seeds from
 * the literal 1 and reads g-values from a torch-RNG table. Text watermarked by one is
 * invisible to the other. A fixture generated with the wrong processor would look exactly
 * like a broken detector, so the mismatch is caught here instead.
 */
function validate(record, label) {
  const problems = [];
  const want = config.watermark;
  const got = record.watermark ?? {};

  const sameKeys =
    Array.isArray(got.keys) &&
    got.keys.length === want.keys.length &&
    got.keys.every((k, i) => k === want.keys[i]);
  if (!sameKeys) problems.push('watermark.keys do not match the detector configuration');

  for (const field of ['ngram_len', 'context_history_size', 'num_leaves', 'skip_first_ngram_calls']) {
    if (got[field] !== want[field]) {
      problems.push(`watermark.${field} is ${got[field]}, detector expects ${want[field]}`);
    }
  }

  if (record.model?.tokenizer_id !== config.model.tokenizer_id) {
    problems.push(
      `tokenizer is ${record.model?.tokenizer_id}, detector is pinned to ${config.model.tokenizer_id}`,
    );
  }

  const samples = Object.entries(record.samples ?? {});
  if (samples.length === 0) problems.push('record contains no samples');

  for (const [name, s] of samples) {
    if (typeof s.text !== 'string' || !s.text.trim()) problems.push(`sample ${name} has no text`);
    if (!Array.isArray(s.token_ids)) problems.push(`sample ${name} has no token_ids`);
    const score = s.reference_scores?.correct_key?.score;
    if (typeof score !== 'number') {
      problems.push(`sample ${name} has no reference_scores.correct_key.score`);
      continue;
    }
    // A watermarked sample scored by the matching implementation lands near 0.6. Anything
    // near the 0.5 null means the generator and the detector are not speaking the same
    // dialect — almost always the transformers processor instead of the DeepMind one.
    if (s.watermarked === true && score < 0.55) {
      problems.push(
        `sample ${name} claims watermarked=true but the reference scored it ${score.toFixed(4)}, ` +
          'near the 0.5 null. Was it generated with google-deepmind/synthid-text@addb4a1, ' +
          "rather than transformers' SynthIDTextWatermarkLogitsProcessor?",
      );
    }
    if (s.watermarked === false && score > 0.55) {
      problems.push(`control sample ${name} scored ${score.toFixed(4)}, which is not a control`);
    }
  }

  if (problems.length) {
    throw new Error(`${label} is unusable:\n  - ${problems.join('\n  - ')}`);
  }
}

const useGenerated = existsSync(GENERATED_PATH);
const record = useGenerated ? JSON.parse(readFileSync(GENERATED_PATH, 'utf8')) : vendored;
const source = useGenerated
  ? 'fixtures/generated/texts-long.json'
  : `${VENDOR}/data/pinned/texts.json`;

validate(record, source);

const entries = Object.entries(record.samples);
const marked = entries.filter(([, s]) => s.watermarked === true);
const controls = entries.filter(([, s]) => s.watermarked === false);

if (marked.length === 0) throw new Error(`${source} contains no watermarked sample`);
if (controls.length === 0) throw new Error(`${source} contains no unwatermarked control`);

// Watermarked samples are concatenated so the demo passage is long enough to be worth
// selecting. They share a watermark configuration, so the result is still watermarked text;
// at each seam roughly ngram_len - 1 positions carry a context that was never watermarked
// together and score as noise, which is negligible against the total.
const watermarkedLong = marked.map(([, s]) => s.text.trim()).join('\n\n');
const [singleName, singleSample] = marked[0];
const [controlName, controlSample] = controls[0];
const short = singleSample.text.trim().split(/\s+/).slice(0, 25).join(' ');

mkdirSync(p('fixtures/text'), { recursive: true });

const files = [
  {
    file: 'watermarked-long.txt',
    body: watermarkedLong,
    composedOf: marked.map(([n]) => n),
    expect: 'positive',
  },
  {
    file: 'watermarked-single.txt',
    body: singleSample.text.trim(),
    composedOf: [singleName],
    expect: 'positive',
    referenceScore: singleSample.reference_scores.correct_key.score,
  },
  {
    file: 'control-unwatermarked.txt',
    body: controlSample.text.trim(),
    composedOf: [controlName],
    expect: 'negative',
    referenceScore: controlSample.reference_scores.correct_key.score,
  },
  { file: 'short.txt', body: short, composedOf: [singleName], expect: 'indeterminate' },
];

const index = files.map(({ body, ...meta }) => {
  writeFileSync(p(`fixtures/text/${meta.file}`), body + '\n');
  return { ...meta, words: words(body), characters: body.length, sha256: sha(body) };
});

writeFileSync(
  p('fixtures/text/index.json'),
  JSON.stringify(
    {
      what: 'Text fixtures derived from a pinned generation record.',
      derivedFrom: source,
      generator: {
        model: record.model.model_id,
        modelRevision: record.model.model_revision,
        tokenizer: record.model.tokenizer_id,
        watermark: record.watermark,
        decoding: record.decoding,
      },
      note:
        'watermarked-long.txt concatenates every watermarked sample in the record. ' +
        'referenceScore, where present, is the reference implementation\'s own mean g-value ' +
        'for that exact sample, and the test suite asserts our scorer reproduces it. ' +
        'Digests are of the file body without its trailing newline.',
      files: index,
    },
    null,
    2,
  ) + '\n',
);

console.log(`source: ${source}\n`);
for (const f of index) {
  const ref = f.referenceScore === undefined ? '' : `  ref=${f.referenceScore.toFixed(4)}`;
  console.log(
    `${f.file.padEnd(28)} ${String(f.words).padStart(5)} words  ${String(f.characters).padStart(6)} chars  ${f.expect}${ref}`,
  );
}
