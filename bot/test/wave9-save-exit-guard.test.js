'use strict';
/**
 * bot/test/wave9-save-exit-guard.test.js
 *
 * Oracle for Wave 9 (save-state audit) item 2 — "Guard the exit. Warn before
 * leaving with unsaved changes, and only when there genuinely are unsaved
 * changes — a warning that always fires trains people to dismiss it, and
 * then it protects nothing."
 *
 * Before this wave `grep -c beforeunload builder/app.js` was 0 — there was
 * no exit guard of any kind. builder/app.js now wires a single
 * `beforeunload` listener (initSaveGuard) whose decision is entirely driven
 * by hasUnsavedChanges(): it flushes any still-pending canvas keystroke
 * first (see wave9-save-indicator-and-reload-window.test.js — that flush is
 * usually enough on its own to make the answer "no"), and only asks
 * window.confirm-style permission to leave when something genuinely could
 * not be saved — an image resize still in flight, a localStorage quota
 * failure, or an active save error.
 *
 * This oracle checks BOTH directions: no dialog on a fresh/settled draft
 * (RED before this wave would have been "no dialog ever, even mid-typing" —
 * not the same bug this test targets, but the false-negative direction
 * still matters: firing on every navigation is exactly the "trains people
 * to dismiss it" failure mode the task brief warns against), and a dialog
 * DOES appear for each of the three genuinely-unsaved conditions.
 *
 * Run: node --experimental-sqlite --test bot/test/wave9-save-exit-guard.test.js
 * Evidence: 04-QA-Evidence/Wave9-save/
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = path.join(ROOT, '04-QA-Evidence', 'Wave9-save');
const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));

test('the unsaved-changes exit guard fires only when something could genuinely be lost', async () => {
  fs.mkdirSync(EVIDENCE, { recursive: true });

  process.env.HIDOOK_TEST_PAY = '1';
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wave9-exitguard-'));
  process.env.SERVER_SECRET = 'wave9-exitguard-oracle-secret';
  for (const k of ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'CLOUDFLARE_API_TOKEN', 'VERCEL_TOKEN']) delete process.env[k];

  require(path.join(ROOT, 'scripts/build-builder.js'));
  const { startServer } = require(path.join(ROOT, 'bot/server.js'));
  const { onStripeEvent } = require(path.join(ROOT, 'bot/web.js'));
  const server = startServer({ port: 0, onStripeEvent });
  await new Promise((res, rej) => { server.once('listening', res); server.once('error', rej); });
  const base = 'http://127.0.0.1:' + server.address().port;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30000);

  let dialogFired = false;
  page.on('dialog', (d) => { dialogFired = true; d.dismiss().catch(() => {}); });

  try {
    await page.goto(base + '/app/', { waitUntil: 'networkidle' });
    await page.locator('#hb-cookie-accept').click().catch(() => {});
    await page.locator('.template-card[data-template-id="professionals"] .btn-start-tpl').click();
    await page.waitForURL(/#edit$/);
    await page.locator('#preview-iframe').waitFor({ state: 'visible' });
    await page.waitForTimeout(1200);
    if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
      await page.locator('#btn-close-drawer').click().catch(() => {});
      await page.waitForTimeout(400);
    }

    // =====================================================================
    // A. Fresh, untouched draft — reload must not warn.
    // =====================================================================
    dialogFired = false;
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(dialogFired, false, 'a freshly opened draft with no edits must not trigger the exit guard');

    await page.locator('#preview-iframe').waitFor({ state: 'visible' });
    await page.waitForTimeout(1200);
    if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
      await page.locator('#btn-close-drawer').click().catch(() => {});
      await page.waitForTimeout(400);
    }

    // =====================================================================
    // B. Edit, wait for it to fully settle to "saved" — reload must not warn.
    // =====================================================================
    const frame = () => page.frameLocator('#preview-iframe');
    const nameField = () => frame().locator('[data-hb-edit="business.name"]').first();
    await nameField().click({ clickCount: 3 });
    await page.keyboard.type('Cabinet Testat', { delay: 15 });
    await assert.doesNotReject(
      page.locator('#save-status[data-state="saved"]').waitFor({ state: 'visible', timeout: 3000 }),
      'edit must settle to saved before the no-warning assertion is meaningful'
    );

    dialogFired = false;
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(dialogFired, false, 'a fully settled ("saved") edit must not trigger the exit guard on reload');

    await page.locator('#preview-iframe').waitFor({ state: 'visible' });
    await page.waitForTimeout(1200);
    if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
      await page.locator('#btn-close-drawer').click().catch(() => {});
      await page.waitForTimeout(400);
    }
    await page.screenshot({ path: path.join(EVIDENCE, '04-no-warning-after-settled-save.png') });

    // =====================================================================
    // C/D/E — three genuinely-unsaved conditions DO make the guard object to
    // leaving. Dispatched as a real `beforeunload` Event directly (rather
    // than driving an actual navigation through a dialog) so this stays
    // fast and deterministic — it exercises the exact same listener
    // (initSaveGuard in builder/app.js) and the exact same hasUnsavedChanges()
    // decision a real reload/close would hit, without the flakiness of
    // timing a real dialog against a real navigation.
    // =====================================================================
    const triggersGuard = () => page.evaluate(() => {
      const ev = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(ev);
      return ev.defaultPrevented || ev.returnValue === '';
    });

    // C. pendingOpCount > 0 — an image resize genuinely in flight.
    await page.evaluate(() => { pendingOpCount = 1; });
    assert.equal(await triggersGuard(), true, 'an in-flight async save op (e.g. image resize) must trigger the exit guard');
    await page.evaluate(() => { pendingOpCount = 0; });

    // D. localSaveOk === false — a real localStorage quota failure.
    await page.evaluate(() => { localSaveOk = false; });
    assert.equal(await triggersGuard(), true, 'a local (quota) save failure must trigger the exit guard');
    await page.evaluate(() => { localSaveOk = true; if (typeof setSaveState === 'function') setSaveState('saved'); });

    // E. saveState === 'error' — a failed/never-confirmed cloud save.
    await page.evaluate(() => { if (typeof setSaveState === 'function') setSaveState('error', 'test'); });
    assert.equal(await triggersGuard(), true, 'an active save-error state must trigger the exit guard');
    await page.evaluate(() => { if (typeof setSaveState === 'function') setSaveState('saved'); });

    // Sanity: back to a clean state, the guard is quiet again (proves the
    // three positives above were about the specific conditions, not a
    // listener stuck permanently "on").
    assert.equal(await triggersGuard(), false, 'guard must go quiet again once every unsaved condition clears');

    await page.screenshot({ path: path.join(EVIDENCE, '05-exit-guard-conditions.png') });
    console.log('PASS wave9-save-exit-guard: fires only for genuinely unsaved states, never for idle/settled ones');
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
});
