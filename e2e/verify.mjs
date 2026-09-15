/**
 * End-to-end acceptance run against the built extension in a real Chromium.
 *
 * This exists because the two things most likely to break are precisely the two things a unit
 * test cannot see: whether Manifest V3's content security policy actually permits the C2PA
 * worker and its WebAssembly, and whether a real selection survives the trip to the panel.
 * Both are checked here against the checked-in fixtures, and the proposal screenshots are a
 * by-product of the same run rather than a separate staged exercise.
 *
 *   npm run build
 *   npm i -D playwright && npx playwright install chromium
 *   node e2e/verify.mjs
 */

import { chromium } from 'playwright';
import { readFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.env.PI_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..');
const EXT = join(root, 'dist');
const SHOTS = join(root, 'docs/screenshots');
mkdirSync(SHOTS, { recursive: true });

const launch = { headless: false, args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-sandbox'], viewport: { width: 420, height: 820 } };
if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH;

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'pi-')), launch);
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 });
const extId = new URL(sw.url()).host;

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures.push(name);
};

console.log('\n== extension loads ==');
check('MV3 service worker boots', sw.url().endsWith('/background.js'));

// --- selection capture on the fixture page ---
console.log('\n== selection capture ==');
const article = await ctx.newPage();
await article.goto(`file://${join(root, 'fixtures/page/article.html')}`);
const sel = await article.evaluate(() => {
  const h = [...document.querySelectorAll('h2')];
  const r = document.createRange();
  r.setStartAfter(h.find((x) => x.textContent.includes('Watermarked')));
  r.setEndBefore(h.find((x) => x.textContent.includes('Unwatermarked')));
  getSelection().removeAllRanges();
  getSelection().addRange(r);
  const t = getSelection().toString();
  return { chars: t.length, words: t.trim().split(/\s+/).length, text: t };
});
check('selection exceeds the ~1024 char context-menu cap', sel.chars > 1024, `${sel.words} words, ${sel.chars} chars`);

// The selection has been read into `sel`; nothing below needs this page. Closing it leaves
// the panel as the only tab, so it cannot lose the foreground to it.
await article.close();

// --- panel ---
const panel = await ctx.newPage();
const errors = [];
panel.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
panel.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await panel.goto(`chrome-extension://${extId}/panel.html`);
await panel.waitForLoadState('networkidle');

const base = { pageUrl: 'https://example.test/archival-policy', pageTitle: 'The archival policy nobody read', requestedAt: new Date().toISOString() };
const send = (r) => sw.evaluate((x) => chrome.runtime.sendMessage({ type: 'inspection-request', request: x }), r);

async function inspect(request) {
  await send(request);
  await panel.waitForFunction(() => !document.querySelector('.spinner') && document.querySelector('.summary'), null, { timeout: 90000 });
  return panel.evaluate(() => ({
    heading: document.querySelector('.summary__heading')?.textContent,
    cards: [...document.querySelectorAll('.card')].map((c) => ({
      id: c.querySelector('.card__version')?.textContent.split(' · ')[0],
      result: c.querySelector('.result')?.textContent,
      limits: c.querySelectorAll('.limits li').length,
    })),
    body: document.body.innerText,
  }));
}

/**
 * Capture the panel.
 *
 * A headed Chromium refuses to capture a tab that is not frontmost — the fixture article is
 * open alongside the panel, so the panel has to be raised first. This surfaced only in CI:
 * older Chromium builds captured background tabs happily, current ones answer
 * "Unable to capture screenshot".
 *
 * A failure here is reported as a named check rather than thrown, so that losing a screenshot
 * does not discard the acceptance results that have already been established.
 */
async function shoot(name) {
  // Under a virtual display the window may not have been composited yet when the first
  // capture is attempted, and Chromium answers "Unable to capture screenshot" rather than
  // waiting. A fixed delay is a guess; this retries until there is a frame to read.
  let last;
  for (const wait of [150, 400, 1000, 2500]) {
    try {
      await panel.bringToFront();
      await panel.waitForTimeout(wait);
      await panel.screenshot({ path: join(SHOTS, name) });
      check(`captured ${name}`, true);
      return;
    } catch (cause) {
      last = cause;
    }
  }
  check(`captured ${name}`, false, String(last).split('\n')[0]);
}

console.log('\n== text fixture matrix ==');
const wm = await inspect({ ...base, inspectionId: 'wm', kind: 'text', text: sel.text });
check('watermarked selection -> watermark evidence', wm.heading === 'Watermark signal detected');
check('every card names its detector version', wm.cards.every((c) => c.id));
check('every result carries limitations', wm.cards.every((c) => c.limits > 0));
await shoot('watermark-detected.png');

const ctl = await inspect({ ...base, inspectionId: 'ctl', kind: 'text', text: readFileSync(join(root, 'fixtures/text/control-unwatermarked.txt'), 'utf8').trim() });
check('unwatermarked control -> no false positive', ctl.heading === 'No supported provenance signal detected');
check('negative states it is not evidence of human authorship', /does not establish human authorship/i.test(ctl.body));

const short = await inspect({ ...base, inspectionId: 'short', kind: 'text', text: 'A short quoted sentence from the piece.' });
check('short selection -> indeterminate, not negative', short.heading === 'Not enough evidence');

console.log('\n== image fixture matrix (C2PA under the real MV3 policy) ==');
const img = (f) => ({ ...base, kind: 'image', assetUrl: `https://example.test/${f}`, assetBase64: readFileSync(join(root, 'fixtures/images', f)).toString('base64'), assetMimeType: 'image/jpeg' });
const valid = await inspect({ ...img('signed-valid.jpg'), inspectionId: 'iv' });
check('valid credential verifies and names its issuer', valid.heading === 'Valid Content Credential' && /C2PA Test Signing Cert/.test(valid.body));
check('credential scope stays on the asset', /not automatically to surrounding text/i.test(valid.body));
await shoot('content-credential.png');

const tampered = await inspect({ ...img('signed-tampered.jpg'), inspectionId: 'it' });
check('tampered credential never renders as verified', tampered.heading !== 'Valid Content Credential' && !/Detected/.test(tampered.cards.map((c) => c.result).join()));
check('tampered is distinguished from absent', /present but did not validate/i.test(tampered.body));

const none = await inspect({ ...img('unsigned.jpg'), inspectionId: 'in' });
check('unsigned asset -> no credential', /No Content Credential was found/i.test(none.body));

console.log('\n== language discipline ==');
const allProse = [wm.body, ctl.body, short.body, valid.body, tampered.body, none.body].join('\n');
check('never displays an AI-generated verdict', !/\bAI-generated\b/i.test(allProse));
check('never displays an authorship probability', !/\d+%\s*(likely|probability|chance|AI)/i.test(allProse));
check('no console errors across the whole run', errors.length === 0, errors.join(' | '));

await ctx.close();
console.log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} FAILED: ${failures.join(', ')}`}`);
process.exit(failures.length === 0 ? 0 : 1);
