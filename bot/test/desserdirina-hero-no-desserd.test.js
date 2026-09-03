'use strict';
/**
 * Desserdirina seed hero must not leak the rejected root sample brand
 * «DESSERD by Irina» (wooden disc + Facebook mark) in raster photography.
 *
 * Fullpass innerText oracles cannot see logo pixels. This check:
 *   (a) seed hero bytes ≠ root bakery sample hero
 *   (b) Vision OCR on the seed hero file finds no DESSERD / by Irina
 *   (c) editor mobile-preview canvas at 390px (stranger first screen) OCR-clean
 *
 * Run: node bot/test/desserdirina-hero-no-desserd.test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const PW_PATH = '/Users/Work/.hermes/hermes-agent/node_modules/playwright';
const BRAVE = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const SEED_HERO = path.join(ROOT, 'templates/desserdirina/images/hero.jpg');
const ROOT_HERO = path.join(ROOT, 'images/hero.jpg');
const SWIFT_SRC = path.join(ROOT, 'scripts/ocr-vision.swift');
const BAD_BRAND = /\bDESSERD\b/i;
const BAD_BY = /\bby\s*(?:I|T)?rina\b/i; // OCR sometimes reads Irina as Trina

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desserd-hero-'));
process.env.DATA_DIR = tmpDir;
process.env.SERVER_SECRET = 'desserd-hero-' + crypto.randomBytes(8).toString('hex');
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY = '1';
process.env.NODE_ENV = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
delete process.env.HIDOOK_FAKE_DEPLOY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;

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

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function loadPlaywright() {
  const candidates = [
    path.join(ROOT, 'node_modules/playwright'),
    PW_PATH,
    path.join(ROOT, '../fullpass-63230d2/node_modules/playwright'),
  ];
  for (const cand of candidates) {
    try {
      return require(cand);
    } catch (_) {}
  }
  throw new Error('playwright not found');
}

function ocrImage(absPath) {
  assert.ok(fs.existsSync(SWIFT_SRC), 'scripts/ocr-vision.swift must ship for pixel OCR');
  assert.ok(fs.existsSync(absPath), 'ocr target missing: ' + absPath);
  // `swift` interprets the script (no separate binary to keep in-tree).
  const r = spawnSync('swift', [SWIFT_SRC, absPath], {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: 120000,
  });
  if (r.status !== 0) {
    throw new Error('ocr-vision failed status=' + r.status + ' stderr=' + String(r.stderr || '').slice(0, 400));
  }
  return String(r.stdout || '');
}

function assertNoDesserdBrand(label, ocrText) {
  const blob = String(ocrText || '');
  assert.ok(!BAD_BRAND.test(blob), label + ' OCR must not contain DESSERD; got: ' + blob.slice(0, 240));
  // "by Irina" / OCR "by Trina" only fails when paired with bakery context — still ban both forms.
  assert.ok(!BAD_BY.test(blob), label + ' OCR must not contain by Irina/Trina; got: ' + blob.slice(0, 240));
  assert.ok(!/\bFacebook\b/i.test(blob), label + ' OCR must not contain Facebook mark text; got: ' + blob.slice(0, 240));
}

(async function main() {
  await check('static: seed hero exists and is a real photo', () => {
    assert.ok(fs.existsSync(SEED_HERO), 'templates/desserdirina/images/hero.jpg');
    const st = fs.statSync(SEED_HERO);
    assert.ok(st.size > 20 * 1024, 'seed hero must be a real photo (>20KB), got ' + st.size);
    // JPEG magic
    const head = fs.readFileSync(SEED_HERO).subarray(0, 3);
    assert.ok(head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff, 'seed hero is JPEG');
  });

  await check('static: seed hero bytes ≠ rejected root sample hero (DESSERD disc source)', () => {
    assert.ok(fs.existsSync(ROOT_HERO), 'root images/hero.jpg kept as rejected sample reference');
    const seedSha = sha256File(SEED_HERO);
    const rootSha = sha256File(ROOT_HERO);
    assert.notStrictEqual(
      seedSha,
      rootSha,
      'templates/desserdirina/images/hero.jpg must not remain the root DESSERD sample bytes'
    );
  });

  await check('static: presets still point at images/hero.jpg with Desserdirina wordmark', () => {
    const presets = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/desserdirina/presets.json'), 'utf8'));
    assert.ok((presets.presets || []).length >= 1, 'presets');
    for (const p of presets.presets) {
      const cfg = p.config || {};
      const biz = cfg.business || {};
      assert.ok(/^Desserdirina$/i.test(String(biz.name || '').trim()), p.id + ' business.name');
      assert.ok(!/\bDESSERD\b/i.test(JSON.stringify(cfg)), p.id + ' no DESSERD in config');
      const bg = String((cfg.hero && cfg.hero.background) || '');
      assert.match(bg, /images\/hero\.jpg/, p.id + ' hero.background uses images/hero.jpg');
      assert.strictEqual(cfg.showWordmark, true, p.id + ' showWordmark');
    }
  });

  await check('pixel: Vision OCR on seed hero file has no DESSERD / by Irina', () => {
    const text = ocrImage(SEED_HERO);
    assertNoDesserdBrand('seed hero.jpg', text);
  });

  // Causal RED sanity: the rejected root sample still OCRs as DESSERD (proves the oracle sees raster brand).
  await check('pixel: root sample hero still OCRs as DESSERD (oracle sensitivity)', () => {
    const text = ocrImage(ROOT_HERO);
    assert.ok(BAD_BRAND.test(text), 'root images/hero.jpg must still read DESSERD so the oracle is live; got: ' + text.slice(0, 200));
  });

  execFileSync('node', [path.join(ROOT, 'scripts/build-builder.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  const { startServer } = require('../server.js');
  const server = startServer({ port: 0 });
  await new Promise((resolve) => {
    if (server.listening) return resolve();
    server.once('listening', resolve);
  });
  const port = server.address().port;
  const base = 'http://127.0.0.1:' + port;

  try {
    await check('browser: editor mobile-preview 390px hero canvas OCR has no DESSERD', async () => {
      const { chromium } = loadPlaywright();
      const browser = await chromium.launch({
        headless: true,
        executablePath: fs.existsSync(BRAVE) ? BRAVE : undefined,
      });
      const shotPath = path.join(tmpDir, 'desserdirina-mobile-hero-390.png');
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        page.setDefaultTimeout(30000);
        await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
        if (await page.locator('#hb-cookie-accept').isVisible().catch(() => false)) {
          await page.locator('#hb-cookie-accept').click().catch(() => {});
        }
        await page.locator('.template-card[data-template-id="desserdirina"] .btn-start-tpl').click();
        await page.waitForURL(/#edit$/, { timeout: 30000 });
        await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 30000 });
        await page.waitForTimeout(1200);
        const drawer = page.locator('#details-drawer');
        if (await drawer.isVisible().catch(() => false)) {
          await page.locator('#btn-close-drawer').click({ timeout: 4000 }).catch(() => {});
          await drawer.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
        }
        // Stranger repro: Vizualizare mobil at 390 canvas
        const mobileBtn = page.locator('#btn-preview-mobile');
        if (await mobileBtn.isVisible().catch(() => false)) {
          await mobileBtn.click();
          await page.waitForTimeout(600);
        }
        await page.waitForTimeout(500);
        const frame = page.frameLocator('#preview-iframe');
        await frame.locator('body').waitFor({ state: 'attached', timeout: 20000 });
        await frame.locator('.hero, .hero-wordmark, .hero-tagline').first().waitFor({
          state: 'visible',
          timeout: 20000,
        });
        // Screenshot the preview iframe region (what the stranger sees on first screen).
        const iframe = page.locator('#preview-iframe');
        await iframe.screenshot({ path: shotPath });
        assert.ok(fs.existsSync(shotPath) && fs.statSync(shotPath).size > 8 * 1024, 'hero canvas shot written');

        const ocr = ocrImage(shotPath);
        // Positive control: Desserdirina wordmark should still be readable on first screen.
        assert.ok(
          /Desserdirina/i.test(ocr) || /TORTURI|ARTIZANAL/i.test(ocr),
          'positive: Desserdirina seed copy should OCR on first screen; got: ' + ocr.slice(0, 240)
        );
        assertNoDesserdBrand('editor mobile-preview 390 hero', ocr);

        // Keep a copy under QA evidence for humans.
        const evDir = path.join(ROOT, '04-QA-Evidence/desserdirina-hero-no-desserd');
        fs.mkdirSync(evDir, { recursive: true });
        fs.copyFileSync(shotPath, path.join(evDir, 'editor-mobile-preview-390-hero.png'));
        fs.writeFileSync(path.join(evDir, 'ocr-editor-390.txt'), ocr);
      } finally {
        await browser.close();
      }
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  if (failed) {
    console.error('\n' + failed + ' check(s) failed');
    process.exit(1);
  }
  console.log('\nOK desserdirina-hero-no-desserd');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
