'use strict';
/**
 * bot/test/wave8-calendar-reachable-demo-preserved.test.js
 *
 * Wave 8 touched bot/calendar-native/owner/preview.html to add a real-owner
 * mode (?customerId=&siteId=). The task explicitly calls out that screenshot
 * tooling depends on the existing no-query demo path
 * (data-customer-id="demo_customer_elena") still working exactly as before —
 * this oracle locks that in as its own fast, narrow regression test, separate
 * from the full reachability walk in wave8-calendar-reachable-e2e.test.js.
 *
 * Run: node --experimental-sqlite --test bot/test/wave8-calendar-reachable-demo-preserved.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));

test('GET /calendar-native/owner/ with no query string still mints the DEMO tenant, unchanged', async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wave8-demo-preserved-'));
  process.env.SERVER_SECRET = 'wave8-demo-preserved-secret';
  for (const k of ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'CLOUDFLARE_API_TOKEN', 'VERCEL_TOKEN']) delete process.env[k];

  const { startServer } = require(path.join(ROOT, 'bot/server.js'));
  const { onStripeEvent } = require(path.join(ROOT, 'bot/web.js'));
  const server = startServer({ port: 0, onStripeEvent });
  await new Promise((res, rej) => { server.once('listening', res); server.once('error', rej); });
  const base = 'http://127.0.0.1:' + server.address().port;

  const browser = await chromium.launch({ headless: true });
  // Fresh context — no cookies at all, exactly like the screenshot tooling's
  // first visit to this page.
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  try {
    let previewSessionCalled = false;
    page.on('request', (req) => {
      if (req.url().includes('/api/calendar-native/owner/preview-session')) previewSessionCalled = true;
    });

    await page.goto(base + '/calendar-native/owner/', { waitUntil: 'networkidle' });
    await page.locator('.hod-shell').waitFor({ state: 'visible' });

    assert.ok(previewSessionCalled, 'no-query visit must still call the demo preview-session endpoint, exactly as before this wave');

    const root = page.locator('#hod-root');
    assert.equal(await root.getAttribute('data-customer-id'), 'demo_customer_elena', 'demo mode must still mint the DEMO tenant');
    assert.equal(await root.getAttribute('data-site-id'), 'demo_site_cabinet');
    assert.equal(await page.locator('.hod-auth').count(), 0, 'the demo session must mount the dashboard without an auth wall');

    console.log('PASS wave8-calendar-reachable-demo-preserved: no-query /calendar-native/owner/ is untouched by the real-owner-mode change');
  } finally {
    await context.close();
    await browser.close();
    await new Promise((r) => server.close(r));
  }
});
