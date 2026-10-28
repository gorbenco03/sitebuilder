'use strict';
/**
 * bot/test/suite13-session-expiry-recovery.test.js
 *
 * SESS-01 (MAJOR): after a session expires or is revoked mid-edit, the save
 * pill only said "Nu s-a salvat" (the Romanian explanation was tooltip-only),
 * and "Publică" never re-checked auth (it only guards on the client's
 * cached `currentUser`, which is stale exactly in this scenario) — it called
 * the server and showed the server's raw English 401 body ("Sign-in
 * required.") as a toast, with no way to sign in again without leaving the
 * editor. Draft content was never lost (local-first, see saveDraft()).
 *
 * SESS-02 (MINOR): same root, noticed cross-tab — signing out in one tab
 * left another tab that was still "signed in" with no idea its session was
 * gone.
 *
 * SESS-03 (MINOR): the "Link trimis!" screen was a dead end for the SPA — no
 * polling, no continuation once the link was used, and no explanation of
 * what happens if the link is opened on a different device.
 *
 * Fix (builder/app.js): handleAuthExpired() is the single choke point for a
 * 401 on autosave (runServerAutosave) or publish (doActualPublish), and for
 * a same-account sign-out noticed in another tab (initCrossTabAuthWatcher /
 * broadcastAuthSignedOut). It always shows one fixed Romanian banner
 * (#session-expired-banner) — never the server's own words — with a button
 * (reauthenticateInline) that reopens the EXISTING magic-link modal inline
 * and retries whatever was interrupted once signed in again. wireAuthForm()
 * additionally polls /api/me with backoff (and on window focus) while
 * waiting on "Link trimis!", so the SAME browser continues on its own.
 *
 * Form editor removed 2026-10-28: the editor-side halves of SESS-01 (a 401 on
 * editor autosave, a 401 on the publish modal's step 1 and the retry of that
 * publish) are gone with the editor, so those two tests were deleted. Kept, now
 * on the dashboard: SESS-02 (cross-tab sign-out banner) and SESS-03 (the
 * "Link trimis!" wait in the sign-in modal continues on its own once this
 * browser is signed in). Accounts are seeded through the API
 * (bot/test/lib/dash-seed.js).
 *
 * Local only — HIDOOK_TEST_PAY offline checkout stub.
 * Run: node --experimental-sqlite --test bot/test/suite13-session-expiry-recovery.test.js
 * Evidence: 04-QA-Evidence/Suite13-session-and-drafts/
 */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = path.join(ROOT, '04-QA-Evidence', 'Suite13-session-and-drafts');
const { signInPage } = require('./lib/dash-seed.js');

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

test('SESS-02: a sign-out in another tab is noticed and handled the same way', async () => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));

  await withServer({
    HIDOOK_TEST_PAY: '1',
    HIDOOK_ISOLATED_DEPLOY: '1',
    NODE_ENV: 'test',
    DATA_DIR: freshTmpDataDir('suite13-sess02-'),
    SERVER_SECRET: 'suite13-sess02-' + crypto.randomBytes(8).toString('hex'),
  }, async (base) => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      const email = 'suite13-sess02-' + crypto.randomUUID().slice(0, 8) + '@example.com';

      // Tab 1: signed in, on Site-urile mele.
      const pageEditor = await context.newPage();
      pageEditor.setDefaultTimeout(30000);
      await signInPage(pageEditor, base, email);
      await pageEditor.locator('#user-badge, #btn-account-menu-header').first().waitFor({ state: 'visible' });

      // A SECOND tab, same signed-in account, signs out via the normal UI —
      // never a direct API call, so this proves the real doLogout() path
      // broadcasts the signal the first tab picks up.
      const pageOther = await context.newPage();
      pageOther.setDefaultTimeout(30000);
      await pageOther.goto(base + '/app/#dashboard', { waitUntil: 'networkidle' });
      await pageOther.waitForTimeout(400);
      const logoutBtn = pageOther.locator('#btn-logout');
      if (await logoutBtn.isVisible().catch(() => false)) {
        await logoutBtn.click();
      } else {
        await pageOther.evaluate(() => doLogout());
      }
      await pageOther.waitForTimeout(300);

      await assert.doesNotReject(
        pageEditor.locator('#session-expired-banner').waitFor({ state: 'visible', timeout: 8000 }),
        'SESS-02: a sign-out noticed from another tab must show the same session-expired banner'
      );
      const bodyText = await pageEditor.locator('body').innerText();
      assert.doesNotMatch(bodyText, /Sign-in required/i, 'cross-tab sign-out must not surface raw server English either');
      await pageEditor.screenshot({ path: path.join(EVIDENCE, '09-sess02-cross-tab-banner.png') });

      console.log('PASS suite13 SESS-02: a sign-out in another tab is noticed and handled the same way');
    } finally {
      await browser.close().catch(() => {});
    }
  });
});

test('SESS-03: the desktop tab waiting on a magic link explains itself and continues on its own once this browser is signed in', async () => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));

  await withServer({
    HIDOOK_TEST_PAY: '1',
    HIDOOK_ISOLATED_DEPLOY: '1',
    NODE_ENV: 'test',
    DATA_DIR: freshTmpDataDir('suite13-sess03-'),
    SERVER_SECRET: 'suite13-sess03-' + crypto.randomBytes(8).toString('hex'),
  }, async (base) => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    try {
      // The sign-in modal as a visitor reaches it from Site-urile mele.
      await page.goto(base + '/app/#dashboard', { waitUntil: 'networkidle' });
      await page.locator('#hb-cookie-accept').click({ timeout: 3000 }).catch(() => {});
      await page.locator('#btn-dashboard-auth').click();
      await page.locator('#form-auth-email').waitFor({ state: 'visible' });

      const email = 'suite13-sess03-' + crypto.randomUUID().slice(0, 8) + '@example.com';
      await page.locator('#input-email').fill(email);
      await page.locator('#btn-send-magic').click();
      await page.locator('#auth-sent').waitFor({ state: 'visible' });

      // Explains what to do AND why a phone/other-device link cannot silently
      // continue this desktop tab (magic-link sessions are per-browser).
      const sentText = await page.locator('#auth-sent').innerText();
      assert.match(sentText, /continuăm automat|verificăm automat/i, 'must say it will notice sign-in automatically');
      assert.match(sentText, /alt (dispozitiv|calculator)|telefon/i, 'must address the cross-device case explicitly');
      await page.screenshot({ path: path.join(EVIDENCE, '10-sess03-auth-sent-explains.png') });

      // Simulate "verified the link in THIS SAME browser" — e.g. a second tab
      // that shares this browser's cookie jar completed it — and prove the
      // waiting tab notices via focus without any manual reload.
      const devHref = await page.locator('#dev-link').getAttribute('href');
      const otherTab = await context.newPage();
      await otherTab.goto(base + devHref, { waitUntil: 'networkidle' });
      await otherTab.close();

      await page.bringToFront(); // fires a 'focus' event the poll loop listens for

      await assert.doesNotReject(
        page.locator('#modal-publish').waitFor({ state: 'hidden', timeout: 20000 }),
        'once this browser is actually signed in, the waiting tab must close the sign-in modal on its own'
      );
      await assert.doesNotReject(
        page.locator('#btn-dashboard-auth').waitFor({ state: 'detached', timeout: 10000 }),
        'and the dashboard must stop asking for sign-in (it loads the signed-in account\'s sites)'
      );
      await page.screenshot({ path: path.join(EVIDENCE, '11-sess03-continues-same-browser.png') });

      console.log('PASS suite13 SESS-03: the waiting tab explains the cross-device case and continues on its own in-browser');
    } finally {
      await browser.close().catch(() => {});
    }
  });
});
