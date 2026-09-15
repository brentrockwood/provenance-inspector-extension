/**
 * Derive the checked-in fixtures from the pinned generation record.
 *
 * The text is not authored here and is not editable by hand: it comes from
 * vendor/data/pinned/texts.json, which records the model, revision, seed, decoding
 * parameters, and watermark configuration each sample was generated under. Deriving the
 * fixtures mechanically is what makes the screenshot reproducible from the repository — a
 * hand-pasted passage could not be traced back to a generation run.
 *
 * Run: node tools/build-fixtures.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const p = (rel) => fileURLToPath(new URL(rel, root));

const texts = JSON.parse(
  readFileSync(p('packages/detectors/synthid-reference/vendor/data/pinned/texts.json'), 'utf8'),
);

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const words = (s) => s.trim().split(/\s+/).length;

// Each sample is a single 320-token continuation. The long fixture concatenates the two
// watermarked samples so the demo passage is long enough to be worth selecting; they share a
// watermark configuration, so the concatenation is still watermarked text, with a handful of
// positions across the join scoring as noise.
const watermarkedLong = [
  texts.samples.watermarked.text.trim(),
  texts.samples.watermarked_alt.text.trim(),
].join('\n\n');

const control = texts.samples.control.text.trim();
const short = texts.samples.watermarked.text.trim().split(/\s+/).slice(0, 25).join(' ');

mkdirSync(p('fixtures/text'), { recursive: true });

const files = {
  'watermarked-long.txt': watermarkedLong,
  'watermarked-single.txt': texts.samples.watermarked.text.trim(),
  'control-unwatermarked.txt': control,
  'short.txt': short,
};

const index = [];
for (const [name, body] of Object.entries(files)) {
  writeFileSync(p(`fixtures/text/${name}`), body + '\n');
  index.push({ file: name, words: words(body), characters: body.length, sha256: sha(body) });
}

writeFileSync(
  p('fixtures/text/index.json'),
  JSON.stringify(
    {
      what: 'Text fixtures derived from the pinned generation record.',
      derivedFrom:
        'packages/detectors/synthid-reference/vendor/data/pinned/texts.json',
      generator: {
        model: texts.model.model_id,
        modelRevision: texts.model.model_revision,
        watermark: texts.watermark,
        decoding: texts.decoding,
      },
      note:
        'watermarked-long.txt concatenates the two watermarked samples. The digests here are ' +
        'of the file body without its trailing newline.',
      files: index,
    },
    null,
    2,
  ) + '\n',
);

for (const f of index) console.log(`${f.file.padEnd(28)} ${String(f.words).padStart(4)} words  ${f.characters} chars`);
