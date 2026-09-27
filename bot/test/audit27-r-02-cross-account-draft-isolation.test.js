'use strict';
/**
 * bot/test/audit27-r-02-cross-account-draft-isolation.test.js
 *
 * PLAN-AUDIT-2026-09-27.md task R-02, finding
 * gap-cross-account-draft-leak-depth#1 (04-QA-Evidence/Audit-2026-09-27-b45a3e4/
 * findings-all.json): the local draft (hb.draft.v1 + hb.draft.scopes.v1,
 * builder/app.js) was scoped only per-origin, never per-account. Account A's
 * business name/phone/WhatsApp/address survived in localStorage after
 * Deconectare, and a genuinely fresh tab signing in as a DIFFERENT account
 * afterwards silently adopted it — loadDraft()'s legacy-mirror fallback (the
 * "what was last active anywhere" discovery a brand-new, unpinned tab relies
 * on) had zero notion of WHICH account had written what it was reading back.
 *
 * Fix (builder/app.js): every draft record now carries an `ownerUserId`
 * stamp (currentAccountKey()/draftOwnedByCurrentAccount()). An unowned
 * record (nobody has signed in on it yet) stays adoptable by whichever
 * account signs in first — same as before — but is re-stamped to that
 * account from then on; loadDraft()/loadReplacedDraft() now refuse to hand
 * back a record stamped to a DIFFERENT account; runServerAutosave() carries
 * the same check as a second, storage-level line of defense; and
 * doLogout()/doLogoutEverywhere() delete every local record the signing-out
 * account owns (clearOwnedLocalDraftState()) before the session actually
 * clears.
 *
 * Repro (matches the finding, real UI throughout): account A signs in,
 * types a private marker into the canvas, does NOT publish, and signs out
 * via the real "Deconectare" menu item. A brand-new tab in the SAME browser
 * context (nothing pinned in sessionStorage, app.js never executed there
 * before) signs in as a DIFFERENT real account B and opens /app/#edit
 * directly — not via dashboard "Editează". On the old code this resumes A's
 * marker verbatim into B's editor; on the fix B lands on an empty draft and
 * the marker is gone from localStorage entirely.
 *
 * A second, narrower case pins down the ownership GATE itself (independent
 * of logout-time clearing): a record seeded directly into localStorage and
 * already stamped to some OTHER account's id must never be adopted by a
 * real, different signed-in account either.
 *
 * Local only — HIDOOK_TEST_PAY offline stub, no real Stripe/DNS calls.
 * Run: node --experimental-sqlite --test bot/test/audit27-r-02-cross-account-draft-isolation.test.js
 */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');

function freshTmpDataDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function withServer(envOverrides, fn) {
  const saved = {};
  const clearKeys = ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'CLOUDFLARE_API_TOKEN', 'VERCEL_TOKEN', 'BRAND_DOMAIN', 'DEPLOY_PROVIDER', 'HIDOOK_FAKE_DEPLOY'];
  for (const k of Object.keys(envOverrides)) saved[k] = process.env[k];
  for (const k of clearKeys) saved[k] = process.env[k];
  Object.assign(process.env, envOverrides);
  for (const k of clearKeys) delete process.env[k];

  for (const rel of ['../server.js', '../webpublish.js', '../domains.js', '../registry.js']) {
    delete require.cache[require.resolve(rel)];
  }
  require(path.join(ROOT, 'scripts/build-builder.js'));
  const { startServer } = require('../server.js');
  const server = startServer({ port: 0 });
  await new Promise((res, rej) => { server.once('listening', res); server.once('error', rej); });
  const base = 'http://127.0.0.1:' + server.address().port;

  try {
    await fn(base);
  } finally {
    server.close();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

function escapeForRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function acceptCookiesAndStart(page, base, templateId) {
  await page.goto(base + '/app/', { waitUntil: 'networkidle' });
  await page.locator('#hb-cookie-accept').click().catch(() => {});
  await page.locator(`.template-card[data-template-id="${templateId}"] .btn-start-tpl`).click();
  await page.waitForURL(/#edit$/);
  await page.locator('#preview-iframe').waitFor({ state: 'visible' });
  await page.waitForTimeout(1000);
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
    (expected) => typeof draft !== 'undefined' && draft.config && draft.config.business &&
      draft.config.business.name === expected,
    text,
    { timeout: 5000 }
  );
  // Past the 1200ms debounced server autosave, so the leak (if the fix were
  // absent) would already have reached bot/server.js by the time we act.
  await page.waitForTimeout(1600);
}

async function readBusinessName(page) {
  return (await page.frameLocator('#preview-iframe').locator('[data-hb-edit="business.name"]').first().innerText().catch(() => '')).trim();
}

async function signIn(page, email) {
  await page.locator('#btn-account-menu').click();
  await page.locator('#account-menu-projects').click();
  await page.waitForURL(/#dashboard$/);
  await page.locator('#btn-dashboard-auth').click();
  await page.locator('#form-auth-email').waitFor({ state: 'visible' });
  await page.locator('#input-email').fill(email);
  await page.locator('#btn-send-magic').click();
  await page.locator('#dev-link').waitFor({ state: 'visible' });
  await page.locator('#dev-link').click();
  await Promise.race([
    page.waitForURL(/#edit$/),
    page.waitForURL(/#dashboard$/),
  ]);
  if (!/#edit$/.test(page.url())) {
    await page.evaluate(() => { window.location.hash = '#edit'; });
    await page.waitForURL(/#edit$/);
  }
  await page.locator('#preview-iframe').waitFor({ state: 'visible' });
  await page.waitForTimeout(600);
  if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
    await page.locator('#btn-close-drawer').click().catch(() => {});
    await page.waitForTimeout(300);
  }
}

/** Real "Deconectare" via the editor topbar account menu — never a raw API call. */
async function signOutFromEditor(page) {
  await page.locator('#btn-account-menu').click();
  await page.locator('#account-menu').waitFor({ state: 'visible' });
  await page.locator('#account-menu-logout').waitFor({ state: 'visible' });
  await page.locator('#account-menu-logout').click();
  await page.waitForURL(/#templates$/);
}

test('gap-cross-account-draft-leak-depth#1: a signed-out account\'s local draft never resumes under the next account in a fresh tab', async () => {
  const shotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-r-02-shots-'));
  const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));

  await withServer({
    HIDOOK_TEST_PAY: '1',
    HIDOOK_ISOLATED_DEPLOY: '1',
    NODE_ENV: 'test',
    DATA_DIR: freshTmpDataDir('audit27-r-02-'),
    SERVER_SECRET: 'audit27-r-02-' + crypto.randomBytes(8).toString('hex'),
  }, async (base) => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      const emailA = 'audit27-r02-a-' + crypto.randomUUID().slice(0, 8) + '@example.com';
      const emailB = 'audit27-r02-b-' + crypto.randomUUID().slice(0, 8) + '@example.com';
      const secretMarker = 'DATE-PRIVATE-USER-A-' + crypto.randomUUID().slice(0, 8);

      // ---- Account A: sign in, type a private marker, do NOT publish, sign
      // out via the real "Deconectare" menu item (real UI, no direct API call). ----
      const pageA = await context.newPage();
      pageA.setDefaultTimeout(30000);
      await acceptCookiesAndStart(pageA, base, 'product-menu');
      await editBusinessName(pageA, secretMarker);
      await signIn(pageA, emailA);
      await editBusinessName(pageA, secretMarker); // re-assert after sign-in resume
      assert.equal(await readBusinessName(pageA), secretMarker, 'account A really has the private marker in its own tab');
      await pageA.screenshot({ path: path.join(shotDir, '01-account-a-private-marker-before-logout.png') });

      await signOutFromEditor(pageA);
      await pageA.screenshot({ path: path.join(shotDir, '02-account-a-after-real-logout.png') });
      await pageA.close();

      // ---- A GENUINELY FRESH tab (app.js never ran here before) — same
      // browser context, so it shares localStorage/cookies, but nothing is
      // pinned in sessionStorage. Signs in as a DIFFERENT real account, then
      // opens /app/#edit DIRECTLY (not via dashboard "Editează" — the exact
      // worst-case path from the finding). ----
      const pageB = await context.newPage();
      pageB.setDefaultTimeout(30000);
      await pageB.goto(base + '/app/#dashboard', { waitUntil: 'networkidle' });
      await pageB.locator('#hb-cookie-accept').click().catch(() => {});
      await pageB.locator('#btn-dashboard-auth').click();
      await pageB.locator('#form-auth-email').waitFor({ state: 'visible' });
      await pageB.locator('#input-email').fill(emailB);
      await pageB.locator('#btn-send-magic').click();
      await pageB.locator('#dev-link').waitFor({ state: 'visible' });
      await pageB.locator('#dev-link').click();
      await pageB.waitForTimeout(600);

      await pageB.goto(base + '/app/#edit', { waitUntil: 'networkidle' });
      await pageB.waitForTimeout(800);
      await pageB.screenshot({ path: path.join(shotDir, '03-account-b-fresh-tab-edit-route.png') });

      // ---- The actual assertion: account B must NEVER see account A's
      // private marker — neither inside the editor canvas (the sandboxed
      // preview iframe, the real visible leak surface) nor in draft.config
      // itself, nor anywhere else in the rendered page. ----
      const canvasText = await pageB.frameLocator('#preview-iframe').locator('body').innerText().catch(() => '');
      assert.doesNotMatch(
        canvasText,
        new RegExp(escapeForRegExp(secretMarker)),
        'account B\'s editor canvas must never show account A\'s private business name after A signed out'
      );
      const inMemoryDraftName = await pageB.evaluate(() => (
        (typeof draft !== 'undefined' && draft.config && draft.config.business && draft.config.business.name) || ''
      ));
      assert.notEqual(
        inMemoryDraftName,
        secretMarker,
        'account B\'s in-memory draft.config must never be resumed from account A\'s local draft'
      );
      const bodyText = await pageB.locator('body').innerText().catch(() => '');
      assert.doesNotMatch(
        bodyText,
        new RegExp(escapeForRegExp(secretMarker)),
        'account B must never see account A\'s private business name anywhere in the rendered page'
      );

      // Storage-level check too: neither the legacy mirror nor any scope
      // still holds A's marker after A's own real logout.
      const storageDump = await pageB.evaluate(() => ({
        mirror: localStorage.getItem('hb.draft.v1'),
        scopes: localStorage.getItem('hb.draft.scopes.v1'),
      }));
      assert.doesNotMatch(
        JSON.stringify(storageDump),
        new RegExp(escapeForRegExp(secretMarker)),
        'doLogout() must have cleared account A\'s own draft records from localStorage'
      );

      await pageB.screenshot({ path: path.join(shotDir, '04-account-b-final-state-clean.png') });
      console.log('PASS audit27-r-02 (real UI repro): screenshots at', shotDir);
    } finally {
      await browser.close().catch(() => {});
    }
  });
});

test('gap-cross-account-draft-leak-depth#1 (gate only): a record already stamped to a DIFFERENT account is never adopted by a real signed-in account', async () => {
  const shotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-r-02-gate-shots-'));
  const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));

  await withServer({
    HIDOOK_TEST_PAY: '1',
    HIDOOK_ISOLATED_DEPLOY: '1',
    NODE_ENV: 'test',
    DATA_DIR: freshTmpDataDir('audit27-r-02-gate-'),
    SERVER_SECRET: 'audit27-r-02-gate-' + crypto.randomBytes(8).toString('hex'),
  }, async (base) => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      const foreignMarker = 'DATE-STRAINE-CONT-ALTUL-' + crypto.randomUUID().slice(0, 8);
      const seededRecord = {
        templateId: 'product-menu',
        config: { business: { name: foreignMarker, title: foreignMarker, metaDescription: 'x', lang: 'ro' } },
        // A plausible-looking, but definitely-not-this-browser's-signed-in-
        // account, id — the gate must reject on a MISMATCH, not on any
        // specific value.
        ownerUserId: 'seeded-foreign-account-' + crypto.randomUUID(),
        updatedAt: Date.now(),
      };
      await context.addInitScript((rec) => {
        try {
          localStorage.setItem('hb.draft.v1', JSON.stringify(rec));
          localStorage.setItem('hb.draft.scopes.v1', JSON.stringify({ 'local:seeded': rec }));
        } catch (_) { /* ignore */ }
      }, seededRecord);

      const email = 'audit27-r02-gate-' + crypto.randomUUID().slice(0, 8) + '@example.com';
      const page = await context.newPage();
      page.setDefaultTimeout(30000);

      await page.goto(base + '/app/#dashboard', { waitUntil: 'networkidle' });
      await page.locator('#hb-cookie-accept').click().catch(() => {});
      await page.locator('#btn-dashboard-auth').click();
      await page.locator('#form-auth-email').waitFor({ state: 'visible' });
      await page.locator('#input-email').fill(email);
      await page.locator('#btn-send-magic').click();
      await page.locator('#dev-link').waitFor({ state: 'visible' });
      await page.locator('#dev-link').click();
      await page.waitForTimeout(600);

      await page.goto(base + '/app/#edit', { waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(shotDir, '01-real-account-opens-edit-with-seeded-foreign-record.png') });

      const canvasText = await page.frameLocator('#preview-iframe').locator('body').innerText().catch(() => '');
      assert.doesNotMatch(
        canvasText,
        new RegExp(escapeForRegExp(foreignMarker)),
        'the editor canvas must never show a record already stamped to a DIFFERENT account'
      );
      const inMemoryDraftName = await page.evaluate(() => (
        (typeof draft !== 'undefined' && draft.config && draft.config.business && draft.config.business.name) || ''
      ));
      assert.notEqual(
        inMemoryDraftName,
        foreignMarker,
        'in-memory draft.config must never be resumed from a record stamped to a DIFFERENT account'
      );
      const bodyText = await page.locator('body').innerText().catch(() => '');
      assert.doesNotMatch(
        bodyText,
        new RegExp(escapeForRegExp(foreignMarker)),
        'a record already stamped to a DIFFERENT account must never be adopted, even by a real signed-in account'
      );

      console.log('PASS audit27-r-02 (gate only): screenshots at', shotDir);
    } finally {
      await browser.close().catch(() => {});
    }
  });
});
