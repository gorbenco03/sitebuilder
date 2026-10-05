'use strict';
/**
 * W-4 / H-03 (Verify 2026-10-04, editor-integrity#1): Editează after
 * Restabilește, or after the same account edited the site elsewhere, loaded
 * the older local copy, showed a false "deschis în altă filă" banner and
 * pushed that copy back over the server draft.
 *
 * Oracle (real browser, isolated server, HIDOOK_TEST_PAY):
 *   1. publish -> edit -> Istoric/Restabilește the older version -> reload ->
 *      Editează shows the restored content, no banner, server keeps it.
 *   2. same account edits in browser B -> browser A opens Editează -> B's
 *      content, no banner.
 *   3. local edits the server never accepted (autosave blocked) still win.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-w-4-stale-local-draft-vs-server.test.js
 */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');
const SHOTS = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-w4-shots-'));

async function withServer(fn) {
  const env = {
    HIDOOK_TEST_PAY: '1',
    HIDOOK_ISOLATED_DEPLOY: '1',
    NODE_ENV: 'test',
    DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-w4-')),
    SERVER_SECRET: 'audit27-w4-' + crypto.randomBytes(8).toString('hex'),
  };
  const clearKeys = ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'CLOUDFLARE_API_TOKEN', 'VERCEL_TOKEN', 'BRAND_DOMAIN', 'DEPLOY_PROVIDER', 'HIDOOK_FAKE_DEPLOY'];
  const saved = {};
  for (const k of [...Object.keys(env), ...clearKeys]) saved[k] = process.env[k];
  Object.assign(process.env, env);
  for (const k of clearKeys) delete process.env[k];
  for (const rel of ['../server.js', '../webpublish.js', '../domains.js', '../registry.js']) {
    delete require.cache[require.resolve(rel)];
  }
  require(path.join(ROOT, 'scripts/build-builder.js'));
  const { startServer } = require('../server.js');
  const server = startServer({ port: 0 });
  await new Promise((res, rej) => { server.once('listening', res); server.once('error', rej); });
  const base = 'http://127.0.0.1:' + server.address().port;
  try { await fn(base); } finally {
    server.close();
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

async function closeDrawer(page) {
  if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
    await page.locator('#btn-close-drawer').click().catch(() => {});
    await page.waitForTimeout(300);
  }
}

async function editBusinessName(page, text) {
  const field = page.frameLocator('#preview-iframe').locator('[data-hb-edit="business.name"]').first();
  await field.click({ clickCount: 3 });
  await page.keyboard.type(text, { delay: 12 });
  await field.blur().catch(() => {});
  await page.waitForFunction(
    (v) => draft && draft.config && draft.config.business && draft.config.business.name === v,
    text, { timeout: 5000 });
  await page.waitForTimeout(300);
}

async function waitSaved(page) {
  await page.locator('#save-status[data-state="saved"]').waitFor({ state: 'visible', timeout: 8000 });
  await page.waitForTimeout(1500);
}

async function shownName(page) {
  return (await page.frameLocator('#preview-iframe').locator('[data-hb-edit="business.name"]').first().innerText()).trim();
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOTS, name + '.png') }).catch(() => {});
}

async function bannerVisible(page) {
  return (await page.locator('#tab-conflict-banner').getAttribute('aria-hidden')) !== 'true'
    && await page.locator('#tab-conflict-banner').isVisible().catch(() => false);
}

async function signInOnDashboard(page, base, email) {
  await page.goto(base + '/app/#dashboard', { waitUntil: 'networkidle' });
  await page.locator('#hb-cookie-accept').click().catch(() => {});
  await page.locator('#btn-dashboard-auth').click();
  await page.locator('#input-email').fill(email);
  await page.locator('#btn-send-magic').click();
  await page.locator('#dev-link').waitFor({ state: 'visible' });
  await page.locator('#dev-link').click();
  await page.locator('button[aria-label^="Editează site-ul"]').first().waitFor({ state: 'visible', timeout: 15000 });
}

async function clickEdit(page) {
  await page.locator('button[aria-label^="Editează site-ul"]').first().click();
  await page.waitForURL(/#edit$/);
  await page.locator('#preview-iframe').waitFor({ state: 'visible' });
  await page.waitForTimeout(1200);
  await closeDrawer(page);
}

async function openDashboardFresh(page, base) {
  await page.goto(base + '/app/#dashboard', { waitUntil: 'networkidle' });
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('button[aria-label^="Editează site-ul"]').first().waitFor({ state: 'visible', timeout: 15000 });
}

async function serverName(page, siteId) {
  return page.evaluate(async (id) => (await apiGet('/api/sites/' + id)).config.business.name, siteId);
}

test('W-4: Editează loads the server config, never an older local copy, and shows no false tab banner', async () => {
  const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));
  await withServer(async (base) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const email = 'w4-' + crypto.randomUUID().slice(0, 8) + '@example.com';
      const ctxA = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const A = await ctxA.newPage();
      A.setDefaultTimeout(30000);

      // ---- Setup: publish a site named "W4 Original" as account X. ----
      await A.goto(base + '/app/', { waitUntil: 'networkidle' });
      await A.locator('#hb-cookie-accept').click().catch(() => {});
      await A.locator('.template-card[data-template-id="product-menu"] .btn-start-tpl').click();
      await A.waitForURL(/#edit$/);
      await A.locator('#preview-iframe').waitFor({ state: 'visible' });
      await A.waitForTimeout(1000);
      await closeDrawer(A);
      await editBusinessName(A, 'W4 Original');
      await A.locator('#btn-account-menu').click();
      await A.locator('#account-menu-projects').click();
      await A.waitForURL(/#dashboard$/);
      await A.locator('#btn-dashboard-auth').click();
      await A.locator('#input-email').fill(email);
      await A.locator('#btn-send-magic').click();
      await A.locator('#dev-link').waitFor({ state: 'visible' });
      await A.locator('#dev-link').click();
      await Promise.race([A.waitForURL(/#edit$/), A.waitForURL(/#dashboard$/)]);
      if (!/#edit$/.test(A.url())) { await A.evaluate(() => { window.location.hash = '#edit'; }); await A.waitForURL(/#edit$/); }
      await A.locator('#preview-iframe').waitFor({ state: 'visible' });
      await A.waitForTimeout(800);
      await closeDrawer(A);
      await editBusinessName(A, 'W4 Original');
      await waitSaved(A);
      await A.locator('#btn-publish').click();
      await A.locator('#modal-publish').waitFor({ state: 'visible' });
      await A.locator('#input-slug').fill('w4-' + crypto.randomUUID().slice(0, 8));
      await A.locator('#btn-publish-continue').click();
      await A.locator('#modal-success').waitFor({ state: 'visible' });
      await A.locator('#btn-pay-publish').click();
      await A.waitForURL(/#dashboard$/, { timeout: 20000 });
      await A.locator('#modal-success').waitFor({ state: 'visible', timeout: 15000 });
      const siteId = await A.evaluate(() => currentSiteId);
      await A.locator('#btn-close-success').click().catch(() => {});
      assert.ok(siteId, 'site must be published and bound');

      // ---- 1. Edit to "W4 Draft Two", then Istoric -> Restabilește "W4 Original". ----
      await openDashboardFresh(A, base);
      await clickEdit(A);
      await editBusinessName(A, 'W4 Draft Two');
      await waitSaved(A);
      assert.equal(await serverName(A, siteId), 'W4 Draft Two', 'autosave reached the server');

      await A.goto(base + '/app/#dashboard', { waitUntil: 'networkidle' });
      await A.locator('button[aria-label^="Istoric versiuni"]').first().click();
      await A.locator('#modal-versions .version-item').first().waitFor({ state: 'visible' });
      const row = A.locator('#modal-versions .version-item', { hasText: 'W4 Original' }).first();
      await row.locator('.btn-rollback').click();
      await A.waitForTimeout(2500);
      assert.equal(await serverName(A, siteId), 'W4 Original', 'rollback made the restored config the server latest');

      // The old tab's local scope still holds "W4 Draft Two"; a reload = new tab identity.
      const staleLocal = await A.evaluate((id) => {
        const all = JSON.parse(localStorage.getItem('hb.draft.scopes.v1') || '{}');
        const rec = all['site:' + id];
        return rec && rec.config && rec.config.business.name;
      }, siteId);
      assert.equal(staleLocal, 'W4 Draft Two', 'precondition: stale local scope exists');
      await openDashboardFresh(A, base);
      await clickEdit(A);
      await shot(A, '1-after-restore-clicked-Editeaza');
      assert.equal(await shownName(A), 'W4 Original', 'Editează shows the RESTORED content');
      assert.equal(await A.evaluate(() => draft.config.business.name), 'W4 Original');
      assert.equal(await bannerVisible(A), false, 'no false "deschis în altă filă" banner');
      await A.waitForTimeout(2500);
      assert.equal(await serverName(A, siteId), 'W4 Original', 'server draft not overwritten by the older local copy');
      await A.locator('#btn-publish').click();
      await A.waitForTimeout(4000);
      assert.equal(await serverName(A, siteId), 'W4 Original', 'publishing keeps the restored content');

      // ---- 2. Same account, browser B edits; browser A then opens Editează. ----
      const ctxB = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const B = await ctxB.newPage();
      B.setDefaultTimeout(30000);
      await signInOnDashboard(B, base, email);
      await clickEdit(B);
      await editBusinessName(B, 'W4 From Browser B');
      await waitSaved(B);
      assert.equal(await serverName(B, siteId), 'W4 From Browser B');
      await B.close();
      await ctxB.close();

      await openDashboardFresh(A, base);
      await clickEdit(A);
      await shot(A, '2-after-other-browser-edit-clicked-Editeaza');
      assert.equal(await shownName(A), 'W4 From Browser B', "A shows B's content");
      assert.equal(await bannerVisible(A), false, 'no false banner after another device edited');
      await A.waitForTimeout(2500);
      assert.equal(await serverName(A, siteId), 'W4 From Browser B', "B's content survives A's load");

      // ---- 3. Local edits the server never accepted are NOT discarded. ----
      await A.route('**/api/draft', (r) => r.abort());
      await editBusinessName(A, 'W4 Offline Edit');
      await A.waitForTimeout(1500);
      await A.unroute('**/api/draft');
      await openDashboardFresh(A, base);
      await clickEdit(A);
      await shot(A, '3-unsynced-local-edit-clicked-Editeaza');
      assert.equal(await shownName(A), 'W4 Offline Edit', 'unsynced newer local edit is kept');
      assert.equal(await bannerVisible(A), false);

      await ctxA.close();
    } finally {
      await browser.close();
    }
  });
});
