'use strict';
/**
 * bot/test/suite2-transparent-png.test.js
 *
 * Uploading a PNG with a transparent background (the normal shape of a
 * business logo — a mark cut out with no background) turned that
 * transparency into a solid BLACK square.
 *
 * builder/app.js resizeImageToDataUrl(): `canvas.getContext('2d').
 * drawImage(img, 0, 0, w, h)` followed by `canvas.toDataURL('image/jpeg',
 * quality)`. JPEG has no alpha channel, so the encoder has to composite the
 * canvas onto some backdrop — and it picks black, not white or the canvas's
 * own (actually transparent) pixels. Every upload went through this same
 * path regardless of source format, so a PNG/WebP logo made for a coloured
 * or dark header always came back with an opaque black box around it
 * (04-QA-Evidence/QA-Explorare-2026-09-12/reports/03-images-logo-gallery.md,
 * defect D4).
 *
 * This drives the REAL upload path in a REAL browser — the builder's "Poze"
 * modal, Logo section, "Alege o poză" button, through the actual
 * `pickAndResizeImage()` -> `resizeImageToDataUrl()` code — with a
 * synthetic PNG that has a genuinely transparent corner (not just "any PNG
 * file", most of which have none), then decodes the RESULT back in-page and
 * reads that corner pixel. Before the fix it is opaque black; the fix must
 * make it something other than opaque black (this repo's chosen fix keeps
 * the transparency itself, i.e. alpha stays low).
 *
 * Run: node --experimental-sqlite --test bot/test/suite2-transparent-png.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
const { makeTransparentCornerPng } = require('./suite2-png-helpers.js');

process.env.HIDOOK_TEST_PAY = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'suite2-png-'));
process.env.SERVER_SECRET = 'suite2-png-' + crypto.randomBytes(8).toString('hex');
delete process.env.PUBLIC_URL;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.VERCEL_TOKEN;

require(path.join(ROOT, 'scripts', 'build-builder.js'));
const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));

let server;
let base;

test.before(async () => {
  server = startServer({ port: 0 });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  base = 'http://127.0.0.1:' + server.address().port;
});

test.after(() => {
  if (server) server.close();
});

/** Reads back the top-left corner pixel of a data: URL image, decoded by
 * the real browser (not re-parsed by this script) — proves what actually
 * got stored, not what we assume the encoder did. */
async function cornerPixel(page, dataUrl) {
  return page.evaluate((src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      resolve({ r: d[0], g: d[1], b: d[2], a: d[3] });
    };
    img.onerror = () => reject(new Error('corner-pixel decode failed'));
    img.src = src;
  }), dataUrl);
}

test('a transparent-background PNG logo upload does not turn the corner black', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    page.setDefaultTimeout(20000);

    await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
    if (await page.locator('#hb-cookie-accept').isVisible().catch(() => false)) {
      await page.locator('#hb-cookie-accept').click().catch(() => {});
    }
    await page.locator('.template-card[data-template-id="product-menu"] .btn-start-tpl').click();
    await page.waitForURL(/#edit$/, { timeout: 30000 }).catch(() => {});
    await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(600);
    // Starting a template auto-opens the details drawer; its overlay sits on
    // top of the topbar and would swallow the click below.
    const drawer = page.locator('#details-drawer');
    if (await drawer.isVisible().catch(() => false)) {
      await page.locator('#btn-close-drawer').click().catch(() => {});
    }

    const pngBuffer = makeTransparentCornerPng(200, [40, 90, 220]);

    await page.locator('#btn-open-gallery').click();
    const modal = page.locator('#modal-gallery');
    await modal.waitFor({ state: 'visible', timeout: 10000 });

    const logoSection = modal.locator('.gallery-path-section').filter({
      has: page.locator('.field-label', { hasText: 'Logo' }),
    });
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      logoSection.getByRole('button', { name: /Alege o poz|Înlocuiește/ }).click(),
    ]);
    await fileChooser.setFiles({ name: 'transparent-logo.png', mimeType: 'image/png', buffer: pngBuffer });

    await page.waitForFunction(() => !!(draft && draft.config && draft.config.logo), { timeout: 10000 });
    const storedSrc = await page.evaluate(() => draft.config.logo);
    assert.ok(storedSrc.startsWith('data:image/'), 'logo must be stored as a data: URL, got: ' + storedSrc.slice(0, 40));

    const corner = await cornerPixel(page, storedSrc);
    const isOpaqueBlack = corner.a === 255 && corner.r === 0 && corner.g === 0 && corner.b === 0;
    assert.ok(
      !isOpaqueBlack,
      `transparent corner became opaque black — stored as ${storedSrc.slice(0, 24)}..., corner rgba(${corner.r},${corner.g},${corner.b},${corner.a})`
    );
    // This repo's chosen fix (see builder/app.js resizeImageToDataUrl) keeps
    // the source transparency instead of flattening it onto any colour —
    // assert that directly too, not just "not black", so a future change
    // that flattens onto some OTHER opaque colour is still caught as a
    // meaningful behaviour change worth a deliberate decision, not a
    // silent one.
    assert.ok(storedSrc.startsWith('data:image/png'), 'expected the transparent source to stay a PNG, got: ' + storedSrc.slice(0, 20));
    assert.ok(corner.a < 255, `expected the corner to stay transparent (alpha < 255), got alpha ${corner.a}`);
  } finally {
    await browser.close();
  }
});
