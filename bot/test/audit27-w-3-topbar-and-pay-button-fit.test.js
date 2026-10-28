'use strict';
/**
 * bot/test/audit27-w-3-topbar-and-pay-button-fit.test.js
 *
 * VERIFICARE-2026-10-04 H-02 and the layout mediums behind it (billing-account#2,
 * journey-phone#2, layout-responsive#1/#2/#4). Real Chromium, real server,
 * real magic-link sign-in; screenshots go to os.tmpdir(), named after the
 * action just performed.
 *
 * Form editor removed 2026-10-28: the editor topbar property and the pay button of
 * the success modal no longer exist (the success modal has no pay button; the
 * topbar belonged to the editor), so those checks are gone. What survives:
 *
 * Property, at 320/360/375/390/420/440 CSS px, touch, signed in: the
 * "Adaugă un card" button of the unpaid dashboard card wraps instead of
 * clipping (scrollWidth <= clientWidth, rect inside the viewport and its
 * container, page does not scroll horizontally).
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-w-3-topbar-and-pay-button-fit.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));

process.env.NODE_ENV = 'test';
process.env.HIDOOK_TEST_PAY = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hidook-w3-'));
process.env.SERVER_SECRET = 'w3-' + crypto.randomBytes(8).toString('hex');
for (const k of ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'CLOUDFLARE_API_TOKEN', 'VERCEL_TOKEN']) delete process.env[k];

require(path.join(ROOT, 'scripts', 'build-builder.js'));
const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
const { signInPage, acceptCookies, postJson, blocksConfig } = require('./lib/dash-seed.js');

const SHOT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-w3-shots-'));
const only = (process.env.W3_ONLY || '').split(',').filter(Boolean).map(Number);
const pick = (list) => (only.length ? list.filter((w) => only.includes(w)) : list);
const PHONE_WIDTHS = pick([320, 360, 375, 390, 420, 440]);

let server;
let base;
let signedState;

test.before(async () => {
  server = startServer({ port: 0 });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => { if (server) server.close(); });

/** Real magic-link sign-in, then an unpaid blocks draft created through the API. */
async function signInWithUnpaidDraft(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await signInPage(page, base, 'w3-' + crypto.randomUUID().slice(0, 8) + '@example.com');
  const r = await postJson(page, base, '/api/draft', { templateId: 'blocks', config: blocksConfig('restaurant', 'Restaurant W3') });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const state = await context.storageState();
  await context.close();
  return state;
}

function measureButton(sel) {
  const el = document.querySelector(sel);
  if (!el) return { missing: true };
  const r = el.getBoundingClientRect();
  const problems = [];
  if (!r.width) problems.push('not rendered');
  if (el.scrollWidth > el.clientWidth + 1) problems.push('label clipped: scrollWidth ' + el.scrollWidth + ' > clientWidth ' + el.clientWidth);
  if (r.left < -0.5 || r.right > window.innerWidth + 0.5) problems.push('leaves the viewport');
  const parent = el.parentElement.getBoundingClientRect();
  if (r.left < parent.left - 0.5 || r.right > parent.right + 0.5) problems.push('sticks out of its container');
  if (document.documentElement.scrollWidth > window.innerWidth + 1) problems.push('the page scrolls horizontally');
  return { problems, h: Math.round(r.height) };
}

test('the "Adaugă un card" button of the dashboard card wraps instead of clipping at phone widths', { timeout: 300000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  try {
    signedState = await signInWithUnpaidDraft(browser);
    for (const width of PHONE_WIDTHS) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true, isMobile: true, storageState: signedState });
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      try {
        await page.goto(base + '/app/#dashboard', { waitUntil: 'domcontentloaded' });
        await acceptCookies(page);
        await page.locator('.site-card-actions .btn-primary').first().waitFor({ state: 'visible', timeout: 15000 });
        await page.waitForTimeout(300);
        assert.match(await page.locator('.site-card-actions .btn-primary').first().innerText(), /Adaugă un card/, 'the first primary action of an unpaid card is the pay button');
        const d = await page.evaluate(measureButton, '.site-card-actions .btn-primary');
        await page.screenshot({ path: path.join(SHOT_DIR, 'pay-dashboard-card-' + width + '.png') }).catch(() => {});
        (d.problems || ['missing']).forEach((p) => failures.push('dashboard ' + width + ': ' + p));
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  assert.deepEqual(failures, [], 'pay button failures (screenshots in ' + SHOT_DIR + '):\n' + failures.join('\n'));
});
