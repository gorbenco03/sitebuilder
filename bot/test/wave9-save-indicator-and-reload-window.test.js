'use strict';
/**
 * bot/test/wave9-save-indicator-and-reload-window.test.js
 *
 * Oracle for Wave 9 (save-state audit): the two most basic pieces of the
 * "the customer never loses their work, and always knows whether it is
 * saved" promise —
 *
 *   1. A visible save state. Before this wave there was NO indicator at all
 *      (grep -c beforeunload builder/app.js was 0, and nothing in the UI
 *      told the owner whether an edit had actually landed anywhere durable).
 *      builder/index.html now carries #save-status (idle/saving/saved/error)
 *      right in the editor topbar, next to the existing #checklist-indicator
 *      pill it is styled to match.
 *
 *   2. The 300ms reload-loses-the-edit window. An independent audit measured
 *      that a canvas text edit sat debounced 300ms (edit-overlay.js) before
 *      even reaching draft.config, so a reload landing inside that window
 *      lost the keystroke with no warning. The fix: the overlay now ALSO
 *      sends an undebounced {hb:'text-live'} mirror on every keystroke
 *      (cheap — no persistence, no history push); the parent keeps it in
 *      pendingLiveEdits and flushes it synchronously into draft.config +
 *      localStorage from the beforeunload handler, before the page actually
 *      unloads. So the edit is never lost even if a reload/close happens
 *      well inside the 300ms window.
 *
 * "RED before" for both is trivially true from the pre-Wave-9 source itself
 * (0 beforeunload handlers; the debounced {hb:'text'} was the ONLY message
 * the overlay ever sent on input) — this oracle is the GREEN proof against
 * the fix, driving a real browser exactly the way the task brief describes
 * judging the work: "Type and immediately hit reload."
 *
 * Run: node --experimental-sqlite --test bot/test/wave9-save-indicator-and-reload-window.test.js
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

test('save indicator shows saving/saved, and a reload inside the 300ms debounce window never loses the edit', async () => {
  fs.mkdirSync(EVIDENCE, { recursive: true });

  process.env.HIDOOK_TEST_PAY = '1';
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wave9-save-reload-'));
  process.env.SERVER_SECRET = 'wave9-save-reload-oracle-secret';
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

  try {
    await page.goto(base + '/app/', { waitUntil: 'networkidle' });
    await page.locator('#hb-cookie-accept').click().catch(() => {});
    await page.locator('.template-card[data-template-id="local-service"] .btn-start-tpl').click();
    await page.waitForURL(/#edit$/);
    await page.locator('#preview-iframe').waitFor({ state: 'visible' });
    await page.waitForTimeout(1200);
    if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
      await page.locator('#btn-close-drawer').click().catch(() => {});
      await page.waitForTimeout(400);
    }

    const status = page.locator('#save-status');
    const frame = () => page.frameLocator('#preview-iframe');
    const nameField = () => frame().locator('[data-hb-edit="business.name"]').first();

    // =====================================================================
    // 1. Visible save state — calm by default, "saving" then "saved", never
    //    shouting on a keystroke-by-keystroke basis.
    // =====================================================================
    assert.equal(await status.isVisible(), false, 'a freshly opened, untouched draft shows no save-status pill (idle is invisible, not noisy)');

    const originalName = (await nameField().innerText()).trim();
    await nameField().click({ clickCount: 3 });
    await page.keyboard.type('Salon Nou SRL', { delay: 15 });
    await page.screenshot({ path: path.join(EVIDENCE, '01-mid-typing-saving-pill.png') });

    // The live mirror fires on the very first keystroke — no need to wait
    // for the 300ms debounce to see "Se salvează…".
    await assert.doesNotReject(
      page.locator('#save-status[data-state="saving"]').waitFor({ state: 'visible', timeout: 2000 }),
      'save-status must flip to "saving" immediately on the first keystroke, not after the 300ms debounce'
    );
    assert.match(
      (await status.locator('#save-status-text').innerText()).trim(),
      /Se salvează/,
      'saving state must read "Se salvează…" in Romanian'
    );

    await page.waitForTimeout(600); // past the 300ms debounce + settle
    await assert.doesNotReject(
      page.locator('#save-status[data-state="saved"]').waitFor({ state: 'visible', timeout: 2000 }),
      'save-status must settle to "saved" once the debounced commit lands (anonymous editing — local persistence is the save)'
    );
    assert.match((await status.locator('#save-status-text').innerText()).trim(), /Salvat/, 'saved state must read "Salvat"');
    await page.screenshot({ path: path.join(EVIDENCE, '02-saved-pill.png') });

    // =====================================================================
    // 2. RELOAD INSIDE THE 300MS WINDOW — the core regression this wave
    //    fixes. Type a second edit and reload almost immediately, well
    //    before the overlay's 300ms debounce would otherwise have sent the
    //    committed {hb:'text'} message.
    // =====================================================================
    await nameField().click({ clickCount: 3 });
    await page.keyboard.type('Salon Recuperat', { delay: 10 });
    // Give the cheap, undebounced live-mirror message time to land in the
    // parent (a handful of ms — same-page postMessage, nowhere near the
    // 300ms commit debounce) without waiting anywhere close to 300ms.
    await page.waitForTimeout(60);
    await page.reload({ waitUntil: 'networkidle' });

    await page.locator('#preview-iframe').waitFor({ state: 'visible' });
    await page.waitForTimeout(1200);
    if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
      await page.locator('#btn-close-drawer').click().catch(() => {});
      await page.waitForTimeout(400);
    }
    await page.screenshot({ path: path.join(EVIDENCE, '03-after-reload-inside-300ms-window.png') });

    const recoveredName = (await nameField().innerText()).trim();
    assert.equal(
      recoveredName,
      'Salon Recuperat',
      'a reload issued well inside the 300ms debounce window must not lose the edit — got "' + recoveredName + '" (original was "' + originalName + '")'
    );

    // The persisted localStorage draft itself must carry the recovered value
    // too (not just whatever the DOM happened to still show pre-reload).
    const persisted = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('hb.draft.v1')); } catch (_) { return null; }
    });
    assert.ok(persisted && persisted.config, 'localStorage draft must exist after reload');
    assert.equal(persisted.config.business.name, 'Salon Recuperat', 'localStorage draft.config must carry the flushed value, not a stale one');

    console.log('PASS wave9-save-indicator-and-reload-window: saving/saved pill + 300ms-window reload both hold');
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
});
