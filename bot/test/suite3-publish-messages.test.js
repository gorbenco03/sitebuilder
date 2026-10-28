'use strict';
/**
 * bot/test/suite3-publish-messages.test.js
 *
 * PLAN-QA-2026-09-12, Suita 3 / S3-4 — four small, independently-wrong
 * messages around publish/auth (m9, m10, m22, m1). Each sub-test checks the
 * ACTUAL text a real browser shows, not the code that produces it.
 *
 * Form editor removed 2026-10-28. Kept:
 * - m9:  a genuine first publish (unpaid draft -> pay -> live) keeps the trial
 *        message in the success modal ("trial de 14 zile început").
 * - m1:  the auth modal opened from the DASHBOARD ("Autentificare" button,
 *        nobody is publishing anything) must not claim the user is publishing.
 * Dropped with the editor: m9's republish-of-a-paid-site half (the success modal
 * is one static title now and republish lives in the block editor), m10 (reserved
 * slug message) and m22 (slug normalization note) — both were publish step 1's
 * slug chooser, which is gone — and m1's publish-flow-title guard.
 *
 * Run: node --experimental-sqlite --test bot/test/suite3-publish-messages.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));
const { signInPage, publishAndPayInUi } = require('./lib/dash-seed.js');

process.env.HIDOOK_TEST_PAY = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hidook-s3b-messages-'));
process.env.SERVER_SECRET = 's3b-messages-' + crypto.randomBytes(8).toString('hex');
delete process.env.PUBLIC_URL;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.VERCEL_TOKEN;

require(path.join(ROOT, 'scripts', 'build-builder.js'));
const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));

let server;
let base;

test.before(async () => {
  server = startServer({ port: 0 });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  base = 'http://127.0.0.1:' + server.address().port;
});

test.after(() => {
  if (server) server.close();
});

async function acceptCookiesIfShown(page) {
  const banner = page.locator('#hb-cookie-banner');
  if (await banner.isVisible().catch(() => false)) {
    await page.locator('#hb-cookie-accept').click();
    await banner.waitFor({ state: 'hidden' }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// m9 — a genuine first publish announces the trial
// ---------------------------------------------------------------------------

test('a genuine first publish still announces the trial', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    // Unpaid blocks site seeded through the API; the customer returns from the
    // (test) checkout, which opens the success modal.
    await signInPage(page, base, 's3b-m9-first-' + Date.now().toString(36) + '@example.com');
    await publishAndPayInUi(page, base, { slug: 's3b-firstpub-' + Date.now().toString(36), pack: 'restaurant', name: 'Restaurant S3B' });
    await page.locator('#modal-success-title').filter({ hasText: /trial/i }).waitFor({ state: 'visible', timeout: 15000 });

    const title = (await page.locator('#modal-success-title').innerText()).trim();
    assert.match(title, /trial/i, `a genuine first publish must still say "trial" — got "${title}"`);

    await context.close();
  } finally {
    await browser.close();
  }
});

// ---------------------------------------------------------------------------
// m1 — dashboard auth modal must not claim the user is publishing
// ---------------------------------------------------------------------------

test('the auth modal opened from the dashboard does not claim the user is publishing', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

    // Context A: open the auth modal from #dashboard, no publish involved.
    const pageA = await context.newPage();
    pageA.setDefaultTimeout(20000);
    await pageA.goto(base + '/app/', { waitUntil: 'networkidle' });
    await acceptCookiesIfShown(pageA);
    await pageA.evaluate(() => { window.location.hash = '#dashboard'; });
    await pageA.waitForTimeout(300);
    await pageA.locator('#btn-dashboard-auth').click();
    await pageA.locator('#form-auth-email').waitFor({ state: 'visible' });
    const dashboardTitle = (await pageA.locator('#publish-step-2 .modal-title').innerText()).trim();
    assert.doesNotMatch(
      dashboardTitle, /public/i,
      `the dashboard's own auth modal must not talk about publishing — got "${dashboardTitle}"`
    );

    await context.close();
  } finally {
    await browser.close();
  }
});
