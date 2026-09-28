'use strict';
/**
 * bot/test/audit27-t-4-details-hint-post-wizard.test.js — task T-4
 * (PLAN-UX-2026-09-27 §5.1 remainder, "Details auto-open after the wizard").
 *
 * RED (old behavior, before this task): startWithTemplate() always calls
 * prepareDrawerForNewDesign() with no way to tell "this design just came out
 * of a COMPLETED onboarding wizard" from any other design selection, so
 * Details auto-opens on top of the canvas immediately after the wizard
 * itself just asked the same name/phone/town questions.
 *
 * GREEN (this task): only the one design the wizard was actually completed
 * (not skipped) on skips the Details auto-open — the editor opens with
 * #details-drawer closed and #onboarding-details-hint visible instead, with
 * a button that opens Details on demand. A skipped wizard, and any later
 * design selection (including the very next one), auto-open Details exactly
 * as before.
 *
 * Screenshots: os.tmpdir()/audit27-t4-<action-just-performed>.png.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-t-4-details-hint-post-wizard.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');

function loadPlaywright() {
  const candidates = [
    path.join(ROOT, 'node_modules/playwright'),
    '/Users/Work/.hermes/hermes-agent/node_modules/playwright',
    path.join(ROOT, '../fullpass-63230d2/node_modules/playwright'),
  ];
  for (const cand of candidates) {
    try {
      return require(cand);
    } catch (_) {}
  }
  throw new Error('playwright not found in any candidate location');
}
const { chromium } = loadPlaywright();

async function shot(page, actionJustPerformed) {
  const file = path.join(os.tmpdir(), `audit27-t4-${actionJustPerformed}.png`);
  await page.screenshot({ path: file }).catch(() => {});
  return file;
}

/** Same one deliberate exception as audit27-s-1: override navigator.webdriver
 * so hidookOnboardingShouldRun() (builder/onboarding.js) actually shows the
 * wizard instead of treating this as automation. */
async function newPageAsRealVisitor(browser, viewport) {
  const page = await browser.newPage({ viewport: viewport || { width: 1280, height: 900 } });
  page.setDefaultTimeout(30000);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  return page;
}

async function gotoTemplates(page, base) {
  await page.goto(base + '/app/#templates-grid', { waitUntil: 'domcontentloaded' });
  if (await page.locator('#hb-cookie-accept').isVisible().catch(() => false)) {
    await page.locator('#hb-cookie-accept').click().catch(() => {});
  }
  await page.locator('.template-card[data-template-id="product-menu"] .btn-start-tpl').waitFor({ state: 'visible' });
}

let browser;
let server;
let base;

test.before(async () => {
  process.env.HIDOOK_TEST_PAY = '1';
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-t4-'));
  process.env.SERVER_SECRET = 'audit27-t4-' + crypto.randomBytes(8).toString('hex');
  for (const k of ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'CLOUDFLARE_API_TOKEN', 'VERCEL_TOKEN']) delete process.env[k];

  require(path.join(ROOT, 'scripts/build-builder.js'));
  const { startServer } = require(path.join(ROOT, 'bot/server.js'));
  server = startServer({ port: 0 });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  base = 'http://127.0.0.1:' + server.address().port;

  browser = await chromium.launch({ headless: true });
});

test.after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (process.env.DATA_DIR) fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

test('behavior: wizard COMPLETED — editor opens with Details closed and the hint visible; the hint opens Details on demand; a later design selection auto-opens Details normally', async () => {
  const page = await newPageAsRealVisitor(browser);
  try {
    await gotoTemplates(page, base);

    await page.locator('.template-card[data-template-id="product-menu"] .btn-start-tpl').click();
    await page.locator('#onboarding-wizard .onb-box').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('#onboarding-wizard .onb-type-card[data-type="restaurant"]').click();
    await page.locator('#onboarding-wizard #onb-identity-form').waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('#onb-name').fill('Bistro Solaris');
    await page.locator('#onb-continue-btn').click();

    await page.waitForURL(/#edit$/, { timeout: 15000 });
    await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(900);
    await shot(page, '01-editor-opened-after-wizard-completed');

    const afterWizard = await page.evaluate(() => ({
      drawerOpenClass: document.body.classList.contains('details-drawer-open'),
      drawerVisible: (() => {
        const el = document.getElementById('details-drawer');
        return !!el && getComputedStyle(el).display !== 'none';
      })(),
      hintVisible: (() => {
        const el = document.getElementById('onboarding-details-hint');
        return !!el && getComputedStyle(el).display !== 'none';
      })(),
      hintText: (document.getElementById('onboarding-details-hint') || {}).textContent || '',
    }));
    assert.equal(afterWizard.drawerOpenClass, false, 'Details must NOT auto-open for the design the wizard just completed');
    assert.equal(afterWizard.drawerVisible, false, '#details-drawer must be hidden right after a completed wizard');
    assert.equal(afterWizard.hintVisible, true, 'the post-wizard Details hint must be visible instead');
    assert.match(afterWizard.hintText, /Poți completa oricând restul detaliilor din Detalii/);

    // The hint's own button opens Details on demand, and the hint itself
    // disappears once it does.
    await page.locator('#btn-onboarding-details-hint-open').click();
    await page.locator('#details-drawer').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(200);
    await shot(page, '02-hint-button-opens-details');
    const afterHintClick = await page.evaluate(() => ({
      drawerOpenClass: document.body.classList.contains('details-drawer-open'),
      hintVisible: (() => {
        const el = document.getElementById('onboarding-details-hint');
        return !!el && getComputedStyle(el).display !== 'none';
      })(),
    }));
    assert.equal(afterHintClick.drawerOpenClass, true, 'the hint button must actually open Details');
    assert.equal(afterHintClick.hintVisible, false, 'the hint must hide itself once Details opens');
    await page.locator('#btn-close-drawer').click();
    await page.locator('#details-drawer').waitFor({ state: 'hidden', timeout: 5000 });

    // A LATER design selection (wizard already seen — straight to editor,
    // no wizard) must auto-open Details exactly as before this task.
    await gotoTemplates(page, base);
    await page.locator('.template-card[data-template-id="local-service"] .btn-start-tpl').click();
    await page.waitForURL(/#edit$/, { timeout: 15000 });
    await page.locator('#details-drawer').waitFor({ state: 'visible', timeout: 8000 });
    await page.waitForTimeout(200);
    await shot(page, '03-later-design-selection-autoopens-details');
    const laterDesign = await page.evaluate(() => ({
      drawerOpenClass: document.body.classList.contains('details-drawer-open'),
      hintVisible: (() => {
        const el = document.getElementById('onboarding-details-hint');
        return !!el && getComputedStyle(el).display !== 'none';
      })(),
    }));
    assert.equal(laterDesign.drawerOpenClass, true, 'every later design selection must still auto-open Details');
    assert.equal(laterDesign.hintVisible, false, 'the post-wizard hint must not reappear on a later, non-wizard design selection');
  } finally {
    await page.close();
  }
});

test('behavior: wizard SKIPPED — Details auto-opens exactly as before (no hint)', async () => {
  const page = await newPageAsRealVisitor(browser);
  try {
    await gotoTemplates(page, base);
    await page.locator('.template-card[data-template-id="professionals"] .btn-start-tpl').click();
    await page.locator('#onboarding-wizard .onb-box').waitFor({ state: 'visible', timeout: 10000 });
    await shot(page, '04-skip-wizard-open');

    await page.keyboard.press('Escape');
    await page.waitForURL(/#edit$/, { timeout: 15000 });
    await page.locator('#details-drawer').waitFor({ state: 'visible', timeout: 8000 });
    await page.waitForTimeout(200);
    await shot(page, '05-skip-autoopens-details');

    const afterSkip = await page.evaluate(() => ({
      drawerOpenClass: document.body.classList.contains('details-drawer-open'),
      hintVisible: (() => {
        const el = document.getElementById('onboarding-details-hint');
        return !!el && getComputedStyle(el).display !== 'none';
      })(),
    }));
    assert.equal(afterSkip.drawerOpenClass, true, 'a skipped wizard must auto-open Details exactly as before this task');
    assert.equal(afterSkip.hintVisible, false, 'a skipped wizard must never show the post-wizard hint');
  } finally {
    await page.close();
  }
});
