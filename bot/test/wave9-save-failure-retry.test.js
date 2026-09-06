'use strict';
/**
 * bot/test/wave9-save-failure-retry.test.js
 *
 * Oracle for Wave 9 (save-state audit) item 3 — "Save failures must be
 * visible and recoverable. If a save fails (offline, server error, session
 * expired after the new session revocation landed), the owner must find out
 * immediately, keep their work in the page, and be able to retry. Silently
 * dropping a save is worse than not saving."
 *
 * Before this wave there was no server-side autosave loop at all for the
 * editor (POST /api/draft only ever ran right before an HTML/ZIP export),
 * so there was nothing to fail loudly OR silently. This wave adds a
 * debounced autosave for signed-in users through that same endpoint
 * (scheduleServerAutosave/runServerAutosave in builder/app.js) and routes
 * every failure — offline, a server error, or a 401 from the session
 * revocation feature that shipped separately — into the same #save-status
 * pill as a retryable "error" state, never a silent drop.
 *
 * This oracle drives a REAL signed-in session (dev magic link), then:
 *   1. Cuts the network to POST /api/draft (page.route abort) and edits —
 *      the pill must go to "error" with a retry affordance, the edit must
 *      stay intact in the page (draft.config, not rolled back), and clicking
 *      retry after the network is restored must recover to "saved".
 *   2. Revokes the session SERVER-SIDE only (POST /api/auth/logout called
 *      directly, bypassing the client's own doLogout()) — exactly the "new
 *      session revocation landed" scenario — then edits again; the pill
 *      must show the session-expired message, not a generic error, and the
 *      edit must still be sitting safely in the page.
 *
 * Run: node --experimental-sqlite --test bot/test/wave9-save-failure-retry.test.js
 * Evidence: 04-QA-Evidence/Wave9-save/
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = path.join(ROOT, '04-QA-Evidence', 'Wave9-save');
const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));

test('a failed autosave (offline, then a revoked session) surfaces visibly, keeps the edit, and can be retried', async () => {
  fs.mkdirSync(EVIDENCE, { recursive: true });

  process.env.HIDOOK_TEST_PAY = '1';
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wave9-failretry-'));
  process.env.SERVER_SECRET = 'wave9-failretry-oracle-secret';
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

    // ---- Sign in via the dev magic link (same flow as wave5-builder-account-menu). ----
    await page.locator('#btn-account-menu').click();
    await page.locator('#account-menu-projects').click();
    await page.waitForURL(/#dashboard$/);
    await page.locator('#btn-dashboard-auth').click();
    await page.locator('#form-auth-email').waitFor({ state: 'visible' });
    const email = 'wave9-failretry-' + crypto.randomBytes(4).toString('hex') + '@example.com';
    await page.locator('#input-email').fill(email);
    await page.locator('#btn-send-magic').click();
    await page.locator('#dev-link').waitFor({ state: 'visible' });
    await page.locator('#dev-link').click();
    // Signing in resumes the unpublished local draft straight back into #edit.
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
    // 1. OFFLINE — POST /api/draft fails outright.
    // =====================================================================
    await page.route('**/api/draft', (route) => route.abort('failed'));

    await nameField().click({ clickCount: 3 });
    await page.keyboard.type('Salon Offline SRL', { delay: 15 });

    await assert.doesNotReject(
      page.locator('#save-status[data-state="error"]').waitFor({ state: 'visible', timeout: 6000 }),
      'a failed cloud autosave must surface as the "error" state, not disappear silently'
    );
    assert.match((await status.locator('#save-status-text').innerText()).trim(), /Nu s-a salvat/, 'error state must read "Nu s-a salvat" in Romanian');
    assert.equal(await page.locator('#btn-save-retry').isVisible(), true, 'a retry affordance must be offered on failure');
    await page.screenshot({ path: path.join(EVIDENCE, '06-offline-save-error.png') });

    // The edit itself must still be sitting safely in the page — never
    // rolled back just because the CLOUD copy failed to sync.
    assert.equal((await nameField().innerText()).trim(), 'Salon Offline SRL', 'the edit must remain visible in the canvas despite the cloud save failing');
    const configName = await page.evaluate(() => draft.config.business.name);
    assert.equal(configName, 'Salon Offline SRL', 'draft.config must still carry the edit — a failed cloud save must never roll back local state');

    // ---- Restore the network and retry — must recover to "saved". ----
    await page.unroute('**/api/draft');
    await page.locator('#btn-save-retry').click();
    await assert.doesNotReject(
      page.locator('#save-status[data-state="saved"]').waitFor({ state: 'visible', timeout: 6000 }),
      'clicking retry once the network is back must recover to "saved"'
    );
    await page.screenshot({ path: path.join(EVIDENCE, '07-retry-recovers-to-saved.png') });

    // =====================================================================
    // 2. SESSION REVOKED SERVER-SIDE (the "new session revocation landed"
    //    scenario) — the client still THINKS it is signed in, but the next
    //    autosave gets a real 401 from the server.
    // =====================================================================
    await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }));

    await nameField().click({ clickCount: 3 });
    await page.keyboard.type('Salon Sesiune Expirata', { delay: 15 });

    await assert.doesNotReject(
      page.locator('#save-status[data-state="error"]').waitFor({ state: 'visible', timeout: 6000 }),
      'typing after a server-side session revocation must surface a save error, not save silently or crash'
    );
    assert.match(
      await status.getAttribute('title'),
      /[Ss]esiunea a expirat/,
      'the error must name a session-expired cause, not a generic failure, when the server actually returned 401'
    );
    await page.screenshot({ path: path.join(EVIDENCE, '08-session-expired-save-error.png') });

    // Work stays in the page regardless.
    assert.equal((await nameField().innerText()).trim(), 'Salon Sesiune Expirata', 'the edit must remain visible after a revoked-session save failure');

    console.log('PASS wave9-save-failure-retry: offline + revoked-session failures both surface visibly, keep the edit, and retry recovers');
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
});
