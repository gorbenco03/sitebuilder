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
  await page.waitForURL(/#edit$/);
  await page.locator('#preview-iframe').waitFor({ state: 'visible' });
  await page.waitForTimeout(600);
  if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
    await page.locator('#btn-close-drawer').click().catch(() => {});
    await page.waitForTimeout(300);
  }
}

async function revokeSessionServerSide(page) {
  await page.evaluate(() => fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }));
}

test('SESS-01: a 401 on autosave shows the Romanian session-expired banner (never the raw server English) and re-auth retries the save', async () => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));

  await withServer({
    HIDOOK_TEST_PAY: '1',
    HIDOOK_ISOLATED_DEPLOY: '1',
    NODE_ENV: 'test',
    DATA_DIR: freshTmpDataDir('suite13-sess01-autosave-'),
    SERVER_SECRET: 'suite13-sess01-autosave-' + crypto.randomBytes(8).toString('hex'),
  }, async (base) => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(30000);
    try {
      await acceptCookiesAndStart(page, base, 'local-service');
      const email = 'suite13-sess01-' + crypto.randomUUID().slice(0, 8) + '@example.com';
      await signIn(page, email);

      // Revoke the session SERVER-SIDE only — the client still thinks it is
      // signed in (currentUser cached truthy), exactly the SESS-01 scenario.
      await revokeSessionServerSide(page);

      await editBusinessName(page, 'Suite13 Sesiune Autosave');

      const banner = page.locator('#session-expired-banner');
      await assert.doesNotReject(
        banner.waitFor({ state: 'visible', timeout: 8000 }),
        'a 401 on autosave must show the session-expired banner'
      );
      const bannerText = (await page.locator('#session-expired-text').innerText()).trim();
      assert.match(bannerText, /Sesiunea a expirat/, 'banner must explain in Romanian that the session expired');
      assert.match(bannerText, /păstrate pe acest dispozitiv/, 'banner must reassure that local work is kept');
      assert.doesNotMatch(bannerText, /Sign-in required/i, 'the raw server English must never reach the owner');
      const pageText = await page.locator('body').innerText();
      assert.doesNotMatch(pageText, /Sign-in required/i, 'the raw server English must not appear anywhere on the page');
      await page.screenshot({ path: path.join(EVIDENCE, '05-sess01-autosave-banner.png') });

      // Work stays in the page regardless.
      const nameField = page.frameLocator('#preview-iframe').locator('[data-hb-edit="business.name"]').first();
      assert.equal((await nameField.innerText()).trim(), 'Suite13 Sesiune Autosave', 'the edit must remain visible after the 401');

      // ---- Re-auth inline, without leaving the editor. ----
      await page.locator('#btn-session-expired-reauth').click();
      await page.locator('#modal-publish').waitFor({ state: 'visible' });
      await page.locator('#form-auth-email').waitFor({ state: 'visible' });
      await page.locator('#input-email').fill(email);
      await page.locator('#btn-send-magic').click();
      await page.locator('#dev-link').waitFor({ state: 'visible' });
      await page.locator('#dev-link').click();

      await assert.doesNotReject(
        page.locator('#session-expired-banner').waitFor({ state: 'hidden', timeout: 8000 }),
        'the session-expired banner must clear once signed in again'
      );
      // Never left #edit — reauthenticateInline() is inline, not a navigation.
      assert.match(page.url(), /#edit$/, 'inline re-auth must not navigate away from the editor');
      await assert.doesNotReject(
        page.locator('#save-status[data-state="saved"]').waitFor({ state: 'visible', timeout: 8000 }),
        'the interrupted autosave must retry and settle to "saved" once signed in again'
      );
      await page.screenshot({ path: path.join(EVIDENCE, '06-sess01-autosave-recovered.png') });

      console.log('PASS suite13 SESS-01 autosave: session-expiry banner is Romanian-only and re-auth retries the save');
    } finally {
      await browser.close().catch(() => {});
    }
  });
});

test('SESS-01: a 401 on publish never shows the raw server English and retries the SAME publish after re-auth', async () => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));

  await withServer({
    HIDOOK_TEST_PAY: '1',
    HIDOOK_ISOLATED_DEPLOY: '1',
    NODE_ENV: 'test',
    DATA_DIR: freshTmpDataDir('suite13-sess01-publish-'),
    SERVER_SECRET: 'suite13-sess01-publish-' + crypto.randomBytes(8).toString('hex'),
  }, async (base) => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(30000);
    try {
      await acceptCookiesAndStart(page, base, 'professionals');
      const email = 'suite13-sess01-pub-' + crypto.randomUUID().slice(0, 8) + '@example.com';
      await signIn(page, email);
      await editBusinessName(page, 'Suite13 Sesiune Publish');
      await page.locator('#save-status[data-state="saved"]').waitFor({ state: 'visible', timeout: 6000 });

      // Client still thinks it is signed in (currentUser truthy) — doActualPublish's
      // own `!currentUser` guard never fires, so the 401 must be caught downstream.
      await revokeSessionServerSide(page);

      await page.locator('#btn-publish').click();
      const slug = 'suite13-sess01-pub-' + crypto.randomUUID().slice(0, 8);
      await page.locator('#modal-publish').waitFor({ state: 'visible' });
      // If the (stale) auth step shows instead, this run's scenario premise
      // does not hold for this build — fail loudly rather than silently pass.
      const slugStepVisible = await page.locator('#input-slug').isVisible().catch(() => false);
      assert.ok(slugStepVisible, 'expected the slug step (client believes it is signed in) before the 401');
      await page.locator('#input-slug').fill(slug);
      await page.locator('#btn-publish-continue').click();

      const banner = page.locator('#session-expired-banner');
      await assert.doesNotReject(
        banner.waitFor({ state: 'visible', timeout: 8000 }),
        'a 401 on publish must show the session-expired banner, not a raw-English toast'
      );
      const bodyText = await page.locator('body').innerText();
      assert.doesNotMatch(bodyText, /Sign-in required/i, 'publish 401 must never surface the raw server English anywhere on the page');
      await page.screenshot({ path: path.join(EVIDENCE, '07-sess01-publish-banner.png') });

      // ---- Re-auth inline and let it retry the SAME publish automatically. ----
      await page.locator('#btn-session-expired-reauth').click();
      await page.locator('#form-auth-email').waitFor({ state: 'visible' });
      await page.locator('#input-email').fill(email);
      await page.locator('#btn-send-magic').click();
      await page.locator('#dev-link').waitFor({ state: 'visible' });
      await page.locator('#dev-link').click();

      await assert.doesNotReject(
        page.locator('#modal-success').waitFor({ state: 'visible', timeout: 15000 }),
        'once re-authenticated, the interrupted publish must complete on its own'
      );
      await page.screenshot({ path: path.join(EVIDENCE, '08-sess01-publish-retried.png') });

      console.log('PASS suite13 SESS-01 publish: session-expiry banner never leaks English and re-auth completes the same publish');
    } finally {
      await browser.close().catch(() => {});
    }
  });
});

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

      const pageEditor = await context.newPage();
      pageEditor.setDefaultTimeout(30000);
      await acceptCookiesAndStart(pageEditor, base, 'portfolio');
      await editBusinessName(pageEditor, 'Suite13 Sesiune Alt Tab');
      await signIn(pageEditor, email);
      await editBusinessName(pageEditor, 'Suite13 Sesiune Alt Tab');
      await pageEditor.locator('#save-status[data-state="saved"]').waitFor({ state: 'visible', timeout: 6000 });

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
      await acceptCookiesAndStart(page, base, 'product-menu');
      await editBusinessName(page, 'Suite13 Sesiune Telefon');
      await page.locator('#save-status[data-state="saved"]').waitFor({ state: 'visible', timeout: 6000 });

      await page.locator('#btn-publish').click();
      await page.locator('#modal-publish').waitFor({ state: 'visible' });
      const slug = 'suite13-sess03-' + crypto.randomUUID().slice(0, 8);
      await page.locator('#input-slug').fill(slug);
      await page.locator('#btn-publish-continue').click();
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
        page.locator('#modal-success').waitFor({ state: 'visible', timeout: 20000 }),
        'once this browser is actually signed in, the waiting tab must continue the interrupted publish on its own'
      );
      await page.screenshot({ path: path.join(EVIDENCE, '11-sess03-continues-same-browser.png') });

      console.log('PASS suite13 SESS-03: the waiting tab explains the cross-device case and continues on its own in-browser');
    } finally {
      await browser.close().catch(() => {});
    }
  });
});
