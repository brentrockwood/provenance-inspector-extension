/**
 * Build the fixture article page from the checked-in text fixtures.
 *
 * The page is meant to look like something a reader would actually encounter, because a
 * screenshot taken against a developer console proves nothing about how the tool behaves in
 * the wild. It is a fictional publication with a fictional byline: the point is to be
 * ordinary, not to imitate anyone.
 *
 * Run: node tools/build-fixture-page.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const p = (rel) => fileURLToPath(new URL(rel, root));

const read = (name) => readFileSync(p(`fixtures/text/${name}`), 'utf8').trim();
const index = JSON.parse(readFileSync(p('fixtures/text/index.json'), 'utf8'));

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const paras = (text) =>
  text
    .split(/\n{2,}/)
    .map((block) => `      <p>${esc(block.replace(/\s+/g, ' ').trim())}</p>`)
    .join('\n');

const watermarked = read('watermarked-long.txt');
const control = read('control-unwatermarked.txt');
const wmMeta = index.files.find((f) => f.file === 'watermarked-long.txt');

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>The archival policy nobody read — The Marginal Record</title>
    <style>
      :root { color-scheme: light; }
      body {
        margin: 0;
        background: #fdfdfc;
        color: #1c1b19;
        font: 17px/1.65 Georgia, "Iowan Old Style", "Times New Roman", serif;
      }
      .masthead {
        border-bottom: 1px solid #e2e0dc;
        padding: 14px 24px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: #6b6862;
      }
      article { max-width: 40rem; margin: 0 auto; padding: 40px 24px 72px; }
      h1 { font-size: 2.1rem; line-height: 1.2; letter-spacing: -0.015em; margin: 0 0 12px; }
      .byline {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        color: #6b6862;
        margin: 0 0 28px;
        padding-bottom: 20px;
        border-bottom: 1px solid #ececea;
      }
      h2 {
        font-size: 1.15rem;
        margin: 36px 0 12px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      p { margin: 0 0 1.15em; }
      figure { margin: 32px 0; }
      figure img { width: 100%; border-radius: 4px; display: block; background: #eceae6; }
      figcaption {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 12px;
        color: #6b6862;
        margin-top: 8px;
      }
      .fixture-note {
        margin-top: 56px;
        padding: 14px 16px;
        border: 1px dashed #d6d3cd;
        border-radius: 6px;
        background: #f7f6f4;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 11.5px;
        line-height: 1.6;
        color: #57544f;
      }
      .fixture-note strong { color: #1c1b19; }
    </style>
  </head>
  <body>
    <div class="masthead">The Marginal Record</div>
    <article>
      <h1>The archival policy nobody read</h1>
      <p class="byline">By A. Reader · Fixture page · No real publication</p>

      <h2>Watermarked passage</h2>
${paras(watermarked)}

      <figure>
        <img src="../images/signed-valid.jpg" alt="An image carrying a valid Content Credential" />
        <figcaption>Signed asset — right-click the image and choose Inspect provenance.</figcaption>
      </figure>

      <figure>
        <img src="../images/signed-tampered.jpg" alt="The same image, altered after signing" />
        <figcaption>
          The same asset with bytes altered after signing. Its credential is intact; the content
          it covers is not.
        </figcaption>
      </figure>

      <figure>
        <img src="../images/unsigned.jpg" alt="An image with no Content Credential" />
        <figcaption>No Content Credential attached.</figcaption>
      </figure>

      <h2>Unwatermarked control passage</h2>
${paras(control)}

      <div class="fixture-note">
        <strong>Fixture page.</strong> This is not a real article and The Marginal Record is not a
        real publication. The passages above are pinned GPT-2 continuations from
        <code>fixtures/text/</code>. The first was generated with the SynthID-text watermarking
        configuration published in google-deepmind/synthid-text; the second was generated from the
        same model with watermarking disabled. Select the watermarked passage
        (${wmMeta.words} words) and choose <strong>Inspect provenance</strong>.
      </div>
    </article>
  </body>
</html>
`;

mkdirSync(p('fixtures/page'), { recursive: true });
writeFileSync(p('fixtures/page/article.html'), html);
console.log(`wrote fixtures/page/article.html (watermarked passage: ${wmMeta.words} words)`);
