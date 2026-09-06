'use strict';
/**
 * bot/test/wave5-builder-account-menu.test.js
 *
 * Oracle for Wave 5 account access from inside the editor (audit medium #7,
 * 04-QA-Evidence/Audit-2026-09-06-2225ca7/RAPORT.md: "Niciun acces la cont
 * (deconectare/proiecte) din interiorul editorului" — no way to reach logout
 * or the project list once you are in the editor). showScreen('edit') hides
 * the normal app-header (which carries #btn-logout and the "Proiectele mele"
 * nav link) and shows only the editor-topbar, which had no equivalent.
 *
 * Also re-verifies (task item 5) that the modal Escape handling and focus
 * trap added by an earlier wave still cover #modal-instagram, and that the
 * new account menu does not interfere with it — the account menu is a plain
 * dropdown (not a `.modal-overlay`), closed via its own Escape handling
 * rather than the shared modal focus trap, so it never needs to "escape" one.
 *
 * Run: node --experimental-sqlite --test bot/test/wave5-builder-account-menu.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));

test('editor topbar account menu reaches the project list and logout, without breaking modal Escape/focus handling', async () => {
  process.env.HIDOOK_TEST_PAY = '1';
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wave5-acctmenu-'));
  process.env.SERVER_SECRET = 'wave5-acctmenu-oracle-secret';
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
    await page.waitForTimeout(1000);
    if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
      await page.locator('#btn-close-drawer').click().catch(() => {});
      await page.waitForTimeout(300);
    }

    // ---- Account menu exists and is reachable from inside the editor ----
    const acctBtn = page.locator('#btn-account-menu');
    await assert.doesNotReject(acctBtn.waitFor({ state: 'visible' }), 'account menu button must be visible in the editor topbar');

    const menu = page.locator('#account-menu');
    await acctBtn.click();
    await menu.waitFor({ state: 'visible' });
    await assert.doesNotReject(page.locator('#account-menu-projects').waitFor({ state: 'visible' }), '"Proiectele mele" must be offered');
    assert.equal(
      await page.locator('#account-menu-logout').isVisible(),
      false,
      '"Deconectare" must stay hidden while signed out'
    );

    // ---- Escape closes the account menu (it is not a modal, but still dismissible) ----
    await page.keyboard.press('Escape');
    assert.equal(await menu.isVisible(), false, 'Escape must close the account menu');

    // ---- "Proiectele mele" reaches the project list (#dashboard) ----
    await acctBtn.click();
    await menu.waitFor({ state: 'visible' });
    await page.locator('#account-menu-projects').click();
    await page.waitForURL(/#dashboard$/);
    await assert.doesNotReject(page.locator('#btn-dashboard-auth').waitFor({ state: 'visible' }), 'unauthenticated dashboard prompt must appear');

    // ---- Sign in via the dashboard auth prompt (dev magic link) ----
    await page.locator('#btn-dashboard-auth').click();
    await page.locator('#form-auth-email').waitFor({ state: 'visible' });
    const email = 'wave5-acctmenu-' + crypto.randomBytes(4).toString('hex') + '@example.com';
    await page.locator('#input-email').fill(email);
    await page.locator('#btn-send-magic').click();
    await page.locator('#dev-link').waitFor({ state: 'visible' });
    await page.locator('#dev-link').click();
    // loadDashboard() finds the unpublished local draft and resumes straight
    // back into the editor (#edit) — there is nothing to list on #dashboard yet.
    await page.waitForURL(/#edit$/);
    await page.locator('#preview-iframe').waitFor({ state: 'visible' });
    await page.waitForTimeout(1000);
    if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
      await page.locator('#btn-close-drawer').click().catch(() => {});
      await page.waitForTimeout(300);
    }

    // ---- Back in the editor, "Deconectare" is now offered ----
    await acctBtn.click();
    await menu.waitFor({ state: 'visible' });
    await assert.doesNotReject(page.locator('#account-menu-logout').waitFor({ state: 'visible' }), '"Deconectare" must appear once signed in');

    await page.locator('#account-menu-logout').click();
    await page.waitForURL(/#templates$/);
    assert.equal(await page.locator('#user-badge').isVisible(), false, 'logout from the editor account menu must actually sign out');

    // =====================================================================
    // Task item 5: modal Escape handling / focus trap still covers
    // #modal-instagram, and the new account menu does not interfere with it.
    // =====================================================================
    await page.goto(base + '/app/#edit', { waitUntil: 'networkidle' });
    await page.locator('#preview-iframe').waitFor({ state: 'visible' });
    await page.waitForTimeout(1000);
    if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
      await page.locator('#btn-close-drawer').click().catch(() => {});
      await page.waitForTimeout(300);
    }

    await page.locator('#btn-add-instagram').click();
    const igModal = page.locator('#modal-instagram');
    await igModal.waitFor({ state: 'visible' });

    // Focus trap: Tab must never leave the modal while it is open.
    const focusInsideModal = async () => page.evaluate(() => {
      const modal = document.getElementById('modal-instagram');
      return !!(modal && modal.contains(document.activeElement));
    });
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      assert.equal(await focusInsideModal(), true, `Tab #${i + 1} inside #modal-instagram must not move focus outside it`);
    }

    // Escape still closes #modal-instagram (unchanged by the new topbar UI).
    await page.keyboard.press('Escape');
    assert.equal(await igModal.isVisible(), false, 'Escape must still close #modal-instagram');

    // The account menu keeps working normally afterwards — no leftover state
    // from the modal's focus trap or the Escape handler leaks into it.
    await acctBtn.click();
    await menu.waitFor({ state: 'visible' });
    assert.equal(await menu.isVisible(), true, 'account menu must still open normally after a modal Escape-close');
    await page.keyboard.press('Escape');
    assert.equal(await menu.isVisible(), false, 'Escape must still close the account menu after the modal interaction');

    console.log('PASS wave5-builder-account-menu: project list + logout reachable from the editor, modal Escape/focus trap intact');
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
});
