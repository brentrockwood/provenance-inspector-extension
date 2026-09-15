/**
 * Build the C2PA image fixtures.
 *
 * Signing an asset would mean shipping a private key and a certificate, so the signed
 * fixtures are instead the Content Authenticity Initiative's own published test assets, which
 * carry real manifests signed by real certificates. The tampered fixture is derived here: a
 * valid asset with bytes flipped well past its manifest, so the credential survives intact
 * while the content it covers no longer matches. That is precisely the case the panel must
 * never render as verified.
 *
 * Run: node tools/build-image-fixtures.mjs <path-to-c2pa-js-checkout>
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const p = (rel) => fileURLToPath(new URL(rel, root));
const src = process.argv[2];

if (!src) {
  console.error('usage: node tools/build-image-fixtures.mjs <path-to-c2pa-js-checkout>');
  process.exit(1);
}

const sources = {
  'signed-valid.jpg': `${src}/packages/c2pa-node/tests/fixtures/CA.jpg`,
  'unsigned.jpg': `${src}/packages/c2pa-node/tests/fixtures/A.jpg`,
};

mkdirSync(p('fixtures/images'), { recursive: true });
const sha = (b) => createHash('sha256').update(b).digest('hex');
const manifest = [];

for (const [name, from] of Object.entries(sources)) {
  const bytes = readFileSync(from);
  writeFileSync(p(`fixtures/images/${name}`), bytes);
  manifest.push({ file: name, bytes: bytes.length, sha256: sha(bytes) });
}

// Tamper: flip bits in the final 20% of the file, which is compressed image data rather than
// the JUMBF manifest near the front. The credential is left byte-identical; what changes is
// the content its hard binding hash covers.
const original = readFileSync(sources['signed-valid.jpg']);
const tampered = Buffer.from(original);
const start = Math.floor(tampered.length * 0.8);
for (let i = start; i < start + 4096 && i < tampered.length - 2; i++) tampered[i] ^= 0x5a;
writeFileSync(p('fixtures/images/signed-tampered.jpg'), tampered);
manifest.push({
  file: 'signed-tampered.jpg',
  bytes: tampered.length,
  sha256: sha(tampered),
  derivedFrom: 'signed-valid.jpg',
  method: `XOR 0x5a over 4096 bytes starting at offset ${start}`,
});

writeFileSync(
  p('fixtures/images/index.json'),
  JSON.stringify(
    {
      what: 'C2PA image fixtures.',
      provenance:
        'signed-valid.jpg and unsigned.jpg are CA.jpg and A.jpg from contentauth/c2pa-js ' +
        '(MIT, © 2025 Adobe), used as published test assets. signed-tampered.jpg is derived ' +
        'from signed-valid.jpg by this script.',
      expected: {
        'signed-valid.jpg': 'signature positive, cryptographic, scoped to the asset',
        'unsigned.jpg': 'signature negative — no credential present',
        'signed-tampered.jpg': 'validation_state Invalid — never rendered as verified',
      },
      files: manifest,
    },
    null,
    2,
  ) + '\n',
);

for (const f of manifest) console.log(`${f.file.padEnd(22)} ${String(f.bytes).padStart(8)} bytes`);
