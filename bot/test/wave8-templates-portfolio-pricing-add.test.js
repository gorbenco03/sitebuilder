'use strict';
/**
 * bot/test/wave8-templates-portfolio-pricing-add.test.js
 *
 * Oracle for Wave8 finding #1 (HIGH, portfolio): "+ Adaugă" on the pricing
 * list (`.pf-price`) silently does nothing useful and transiently corrupts a
 * sibling item.
 *
 * Minimal reproduction (verified by hand before writing this oracle):
 *   1. Start the "portfolio" template — its preset ships exactly 10
 *      `pricing` entries (indices 0..9, i.e. right at the single-digit
 *      boundary).
 *   2. Open the editor, close the drawer, click the `.pf-price .hb-add-btn`
 *      once.
 *   3. Inspect `.pf-price` and every `.pf-price__row`.
 *
 * Root cause: builder/edit-overlay.js's list add/remove wiring identifies a
 * list item's own DOM fields with a **string-prefix** attribute selector,
 * `[data-hb-edit^="pricing.1"]`. Once a "+ Adaugă" click brings the list to
 * 11 items (indices 0..10), "pricing.1" is also a string-prefix of
 * "pricing.10" — the selector for item 1 wrongly pulls in item 10's fields
 * too. findListItemContainer() then has to find one DOM node that contains
 * fields from BOTH non-adjacent items, and the only such node is the shared
 * `.pf-price` list wrapper itself — so `.pf-price` (not the row) gets
 * wrongly tagged `.hb-list-item`, and the true item-1 row is skipped
 * entirely (never gets its own `.hb-list-item` class or `.hb-remove-btn`).
 * Net visible effect for the owner: a new row IS appended to the underlying
 * config (so nothing is lost), but "+ Adaugă" looks like it did nothing
 * useful, and — worse — an existing, untouched pricing row (item 1) briefly
 * loses its delete "×" control.
 *
 * This is NOT specific to portfolio's markup: any repeatable list on any
 * template that reaches a double-digit index (10+ items, whether from the
 * preset or from repeated "+ Adaugă" clicks) hits the exact same collision.
 * portfolio's pricing list just happens to ship pre-loaded at the boundary
 * (10 items), so a single click reproduces it immediately. The fix in
 * builder/edit-overlay.js (`itemFieldSelector`) matches an item path exactly
 * or followed by "." — never a bare numeric-string prefix — which protects
 * every list on every template, not just this one.
 *
 * Causal RED before the builder/edit-overlay.js fix (itemFieldSelector),
 * GREEN after.
 *
 * Run: node --experimental-sqlite --test bot/test/wave8-templates-portfolio-pricing-add.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '../..');

function loadPlaywright() {
  const candidates = [
    path.join(ROOT, 'node_modules/playwright'),
    '/Users/Work/.hermes/hermes-agent/node_modules/playwright',
  ];
  for (const cand of candidates) {
    try {
      return require(cand);
    } catch (_) {}
  }
  throw new Error('playwright not found');
}

test('wave8 portfolio pricing "+ Adaugă": adds a real row, never corrupts a sibling', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave8-pf-price-'));
  process.env.DATA_DIR = tmpDir;
  process.env.SERVER_SECRET = 'wave8-pf-price-' + crypto.randomBytes(8).toString('hex');
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.HIDOOK_TEST_PAY = '1';
  process.env.NODE_ENV = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
  delete process.env.HIDOOK_FAKE_DEPLOY;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;

  // Make sure builder/generated/ (gitignored) reflects the current
  // builder/edit-overlay.js source before we boot the server.
  execFileSync('node', [path.join(ROOT, 'scripts/build-builder.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  delete require.cache[require.resolve(path.join(ROOT, 'bot/server.js'))];
  const { startServer } = require(path.join(ROOT, 'bot/server.js'));
  const server = startServer({ port: 0 });
  await new Promise((resolve) => {
    if (server.listening) return resolve();
    server.once('listening', resolve);
  });
  const base = 'http://127.0.0.1:' + server.address().port;

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(30000);

    await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
    if (await page.locator('#hb-cookie-accept').isVisible().catch(() => false)) {
      await page.locator('#hb-cookie-accept').click().catch(() => {});
    }
    await page.locator('.template-card[data-template-id="portfolio"] .btn-start-tpl').click();
    await page.waitForURL(/#edit$/, { timeout: 30000 }).catch(() => {});
    await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(900);
    const drawer = page.locator('#details-drawer');
    if (await drawer.isVisible().catch(() => false)) {
      await page.locator('#btn-close-drawer').click({ timeout: 4000 }).catch(() => {});
      await drawer.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    }
    await page.waitForTimeout(400);

    const frame = page.frameLocator('#preview-iframe');
    await frame.locator('.pf-price').first().waitFor({ state: 'attached', timeout: 20000 });

    const beforeCount = await frame.locator('.pf-price__row').count();
    assert.strictEqual(beforeCount, 10, 'preset must ship exactly 10 pricing rows (the boundary this bug needs)');

    const addBtn = frame.locator('.pf-price .hb-add-btn').first();
    await addBtn.waitFor({ state: 'attached', timeout: 20000 });
    await addBtn.scrollIntoViewIfNeeded();
    await addBtn.click({ timeout: 10000 });
    await page.waitForTimeout(900);

    // 1) A real 11th row must appear — the underlying defect made "+ Adaugă"
    //    look like a no-op.
    const afterCount = await frame.locator('.pf-price__row').count();
    assert.strictEqual(afterCount, 11, '"+ Adaugă" must add exactly one new pricing row (got ' + afterCount + ')');

    // 2) The list container itself must never be mistagged as a list item —
    //    that class belongs to a repeated row, not its wrapper.
    const iframeHandle = await page.$('#preview-iframe');
    const iframeCtx = await iframeHandle.contentFrame();
    const info = await iframeCtx.evaluate(() => {
      const price = document.querySelector('.pf-price');
      const rows = Array.from(document.querySelectorAll('.pf-price__row'));
      return {
        priceHasListItemClass: price.classList.contains('hb-list-item'),
        rows: rows.map((r) => ({
          hasListItemClass: r.classList.contains('hb-list-item'),
          hasRemoveBtn: !!r.querySelector('.hb-remove-btn'),
        })),
      };
    });

    assert.ok(
      !info.priceHasListItemClass,
      'the .pf-price list WRAPPER must never be tagged .hb-list-item (that belongs to a row)'
    );

    // 3) EVERY row — old and new — must keep its own item styling and a
    //    working delete control. This is the "transiently strips a sibling
    //    item's delete control" half of the defect: before the fix, row
    //    index 1 (the row whose index string collides with the freshly
    //    added row's double-digit index) silently lost both.
    info.rows.forEach((row, i) => {
      assert.ok(row.hasListItemClass, 'pricing row ' + i + ' must keep its .hb-list-item class');
      assert.ok(row.hasRemoveBtn, 'pricing row ' + i + ' must keep a working delete (×) control — got none');
    });

    // 4) The new row must actually be removable, restoring the original
    //    count — confirms the add/remove cycle is genuinely usable, not
    //    just "config changed but UI is broken".
    const lastRemoveBtn = frame.locator('.pf-price__row').last().locator('.hb-remove-btn');
    await lastRemoveBtn.click({ timeout: 10000 });
    await page.waitForTimeout(700);
    const finalCount = await frame.locator('.pf-price__row').count();
    assert.strictEqual(finalCount, 10, 'removing the new row must restore the original count of 10');

    await page.close();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
