'use strict';
/**
 * Wave5 desserdirina — self-host Google Fonts (audit finding #41, security).
 *
 * The template pulled Cormorant Garamond + Montserrat from fonts.googleapis.com
 * / fonts.gstatic.com with no consent gate, disclosing every visitor's IP to
 * Google before any cookie choice. Fix: self-host the woff2 files under
 * templates/desserdirina/fonts/ and declare @font-face locally in styles.css.
 *
 * This proves, with a REAL Playwright network trace against a served copy of
 * the built site, that:
 *   RED  (pre-Wave5 / HEAD): the published page requests fonts.googleapis.com.
 *   GREEN (current):          zero requests to fonts.googleapis.com or
 *                              fonts.gstatic.com, and the font files that DO
 *                              load are same-origin.
 *
 * Uses Playwright's bundled Chromium from node_modules (never a hardcoded
 * browser path).
 *
 * Run: node bot/test/wave5-desserdirina-fonts-selfhosted.test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { buildSite, serveDir, loadPlaywright, TEMPLATE_DIR } = require('./wave5-desserdirina-helpers.js');

let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log('PASS', name);
  } catch (e) {
    failed++;
    console.error('FAIL', name, '-', e.message);
    if (process.env.VERBOSE) console.error(e.stack);
  }
}

const EVIDENCE_DIR = path.join(TEMPLATE_DIR, '..', '..', '04-QA-Evidence', 'Wave5-desserdirina');

async function collectRequests(dir) {
  const { chromium } = loadPlaywright();
  const { base, close } = await serveDir(dir);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const requests = [];
    page.on('request', (req) => requests.push(req.url()));
    await page.goto(base + '/index.html', { waitUntil: 'networkidle', timeout: 30000 });
    // Give any late @font-face fetches (triggered once text lays out) a moment.
    await page.waitForTimeout(500);
    return { requests, base };
  } finally {
    await browser.close();
    await close();
  }
}

(async function main() {
  await check('static: no <link> to fonts.googleapis.com remains in template.html', () => {
    const html = fs.readFileSync(path.join(TEMPLATE_DIR, 'template.html'), 'utf8');
    const withoutComments = html.replace(/<!--[\s\S]*?-->/g, '');
    assert.ok(
      !/fonts\.googleapis\.com/.test(withoutComments) && !/fonts\.gstatic\.com/.test(withoutComments),
      'template.html must not link Google Fonts (outside of explanatory comments)'
    );
  });

  await check('static: styles.css declares local @font-face rules for both families', () => {
    const css = fs.readFileSync(path.join(TEMPLATE_DIR, 'styles.css'), 'utf8');
    assert.match(css, /@font-face[\s\S]{0,200}font-family:\s*'Cormorant Garamond'/);
    assert.match(css, /@font-face[\s\S]{0,200}font-family:\s*'Montserrat'/);
    assert.match(css, /src:\s*url\('fonts\//, 'font src must point at the local fonts/ directory');
    assert.ok(!/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')),
      'styles.css must not reference Google Fonts domains outside of comments');
  });

  await check('static: self-hosted woff2 files exist and are valid WOFF2 binaries', () => {
    const fontsDir = path.join(TEMPLATE_DIR, 'fonts');
    const files = fs.readdirSync(fontsDir).filter((f) => f.endsWith('.woff2'));
    assert.ok(files.length >= 12, 'expected self-hosted woff2 files for both families/weights/styles, got ' + files.length);
    for (const f of files) {
      const magic = fs.readFileSync(path.join(fontsDir, f)).subarray(0, 4).toString('ascii');
      assert.strictEqual(magic, 'wOF2', f + ' must be a real WOFF2 file');
    }
  });

  await check('RED (pre-Wave5 / HEAD): a served copy of the old template requests fonts.googleapis.com', async () => {
    const before = buildSite({ state: 'before' });
    const { requests } = await collectRequests(before.dir);
    const googleReqs = requests.filter((u) => /fonts\.googleapis\.com|fonts\.gstatic\.com/.test(u));
    assert.ok(googleReqs.length > 0, 'expected the oracle to catch the pre-fix Google Fonts request; got none — oracle is not sensitive');
  });

  await check('GREEN (current): a served copy of the fixed template makes ZERO requests to Google Fonts', async () => {
    const after = buildSite({ state: 'after' });
    const { requests, base } = await collectRequests(after.dir);
    const googleReqs = requests.filter((u) => /fonts\.googleapis\.com|fonts\.gstatic\.com/.test(u));

    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(EVIDENCE_DIR, 'network-trace-after.json'),
      JSON.stringify({ base, requests, googleFontsRequests: googleReqs }, null, 2)
    );

    assert.strictEqual(googleReqs.length, 0, 'expected zero requests to fonts.googleapis.com/fonts.gstatic.com; got: ' + JSON.stringify(googleReqs));

    // Sanity: the font files DID actually load (same-origin), so we're not just
    // "fixing" it by breaking the fonts.
    const fontReqs = requests.filter((u) => /\.woff2($|\?)/.test(u));
    assert.ok(fontReqs.length > 0, 'expected at least one self-hosted .woff2 request to prove fonts still load');
    for (const u of fontReqs) {
      assert.match(u, new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'font request must be same-origin: ' + u);
    }
  });

  if (failed) {
    console.error('\n' + failed + ' check(s) failed');
    process.exit(1);
  }
  console.log('\nOK wave5-desserdirina-fonts-selfhosted');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
