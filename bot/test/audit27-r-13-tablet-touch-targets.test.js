'use strict';
/**
 * bot/test/audit27-r-13-tablet-touch-targets.test.js
 *
 * AUDIT 2026-09-27 — builder-mobile#1 (R-13).
 *
 * On a real touch tablet at 768x1024 (an iPad in portrait, the exact bucket
 * a customer's device falls into), nearly every editor topbar control and
 * the Details-drawer close button measured below the 44x44px touch-target
 * floor already applied correctly on phone. Root cause: the 44px !important
 * sizing rule in builder/app.css was gated to `max-width: 640px` (plus a
 * short-landscape-phone clause) only — the separate 641-1199px block added
 * just the horizontal scroll rail, never the sizing.
 *
 * FIX (builder/app.css only): a new `@media (min-width: 641px) and
 * (max-width: 1199px) and (pointer: coarse)` block applies the same 44x44
 * floor, scoped to touch input so a mouse-driven desktop/laptop at the same
 * width keeps its original compact chrome (the acceptance criterion this
 * oracle's second test proves).
 *
 * This oracle drives the real browser builder (Playwright) against a real
 * isolated server, with genuine touch emulation (hasTouch/isMobile + an
 * iPad user agent, not just a resized desktop viewport) — it must fail on
 * the pre-fix CSS and pass on the fix.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-r-13-tablet-touch-targets.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));

process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hidook-r13-tablet-touch-'));
process.env.SERVER_SECRET = 'r13-tablet-touch-' + crypto.randomBytes(8).toString('hex');
process.env.HIDOOK_TEST_PAY = '1';
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

test.after(() => { if (server) server.close(); });

async function openFreshProductMenuDraft(page) {
  await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
  await page.locator('#hb-cookie-accept').click({ timeout: 4000 }).catch(() => {});
  await page.goto(base + '/app/#templates', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  await page.locator('.template-card[data-template-id="product-menu"] .btn-start-tpl').click();
  await page.waitForURL(/#edit$/, { timeout: 30000 });
  await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(700);
}

// The exact 13 controls the audit measured below 44px on a real 768x1024
// touch tablet (builder-mobile#1 evidence).
const TOPBAR_TOUCH_TARGETS = [
  '#btn-back-templates',
  '#btn-account-menu',
  '#btn-undo',
  '#btn-redo',
  '#btn-preview-desktop',
  '#btn-preview-mobile',
  '#btn-add-instagram',
  '#btn-color-picker',
  '#btn-open-gallery',
  '#btn-open-drawer',
  '#btn-download-html',
  '#btn-download-zip',
];

test('every topbar control reaches 44x44px on a real touch tablet at 768x1024', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 768, height: 1024 },
      hasTouch: true,
      isMobile: true,
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    await openFreshProductMenuDraft(page);

    // Confirm we are actually in the coarse-pointer bucket the fix targets,
    // not accidentally matching some other rule.
    const pointerCoarse = await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches);
    assert.equal(pointerCoarse, true, 'test setup must emulate a coarse (touch) pointer at 768px — check hasTouch/isMobile');

    const undersized = [];
    for (const selector of TOPBAR_TOUCH_TARGETS) {
      const box = await page.locator(selector).boundingBox();
      assert.ok(box, `${selector} must be visible on the tablet topbar`);
      if (box.width < 44 || box.height < 44) {
        undersized.push(`${selector} ${Math.round(box.width)}x${Math.round(box.height)}`);
      }
    }
    assert.deepEqual(undersized, [], `these topbar controls are below the 44x44 touch-target floor at 768x1024 touch: ${undersized.join(', ')}`);

    // Details drawer's own close button (auto-opened at >=768px).
    await page.locator('#details-drawer').waitFor({ state: 'visible', timeout: 8000 });
    const closeBox = await page.locator('#btn-close-drawer').boundingBox();
    assert.ok(closeBox, '#btn-close-drawer must be visible while the drawer is open');
    assert.ok(
      closeBox.width >= 44 && closeBox.height >= 44,
      `#btn-close-drawer is ${Math.round(closeBox.width)}x${Math.round(closeBox.height)}, below the 44x44 floor`
    );

    await page.close();
    await context.close();
  } finally {
    await browser.close();
  }
});

test('a mouse-driven desktop/laptop at the same 768px width keeps its original compact chrome', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    // No hasTouch/isMobile: a real mouse-driven browser window resized to
    // 768px wide (a small laptop), the case the fix must NOT change.
    const page = await browser.newPage({ viewport: { width: 768, height: 1024 } });
    page.setDefaultTimeout(20000);
    await openFreshProductMenuDraft(page);

    const pointerCoarse = await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches);
    assert.equal(pointerCoarse, false, 'test setup must emulate a fine (mouse) pointer here — check no hasTouch/isMobile leaked in');

    // At least one previously-compact control (undo, 30x30 in the audit)
    // must still measure below the 44px floor: proof the coarse-pointer gate
    // genuinely does not fire for a mouse, i.e. the desktop/laptop layout at
    // this width is unchanged by the fix.
    const undoBox = await page.locator('#btn-undo').boundingBox();
    assert.ok(undoBox, '#btn-undo must be visible');
    assert.ok(
      undoBox.width < 44 || undoBox.height < 44,
      `#btn-undo grew to ${Math.round(undoBox.width)}x${Math.round(undoBox.height)} for a mouse pointer — ` +
      'the pointer:coarse gate must not affect a desktop/laptop at this width'
    );

    await page.close();
  } finally {
    await browser.close();
  }
});
