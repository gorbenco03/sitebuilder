'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { prepareLandingScroll } = require('./helpers/landing-scroll-ready');

test('landing readiness waits for real smooth-scroll progress; native destinations still reject disabled navigation', async () => {
  process.env.HIDOOK_TEST_PAY = '1';
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'landing-scroll-ready-'));
  process.env.SERVER_SECRET = 'isolated-landing-scroll-ready-secret';
  for (const key of ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'CLOUDFLARE_API_TOKEN', 'VERCEL_TOKEN']) delete process.env[key];
  const { startServer } = require('../server');
  const server = startServer({ port: 0 });
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const browser = await chromium.launch({ headless: true });
  try {
    for (const disabled of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      await page.goto('http://127.0.0.1:' + server.address().port + '/app/', { waitUntil: 'networkidle' });
      const accept = page.locator('#hb-cookie-accept');
      if (await accept.isVisible()) await accept.click();
      assert.strictEqual(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), 'smooth');
      if (disabled) {
        // Intercept the actual click before inline/default navigation, without touching product files.
        await page.evaluate(() => document.addEventListener('click', event => {
          if (event.target.closest('a.logo, .header-nav a[data-route="templates"]')) {
            event.preventDefault();
            event.stopImmediatePropagation();
          }
        }, true));
      }
      for (const selector of ['a.logo', '.header-nav a[data-route="templates"]']) {
        await page.evaluate(() => requestAnimationFrame(() => {
          const end = performance.now() + 180;
          while (performance.now() < end) { /* Controlled main-thread frame delay. */ }
        }));
        await prepareLandingScroll(page);
        const before = await page.evaluate(() => scrollY);
        assert.ok(before > 200, 'preparation requires observed movement, not elapsed time');
        await page.locator(selector).click();
        const arrival = page.waitForFunction(() => window.scrollY < 50, null, { timeout: 3000 });
        if (disabled) {
          await assert.rejects(arrival, /Timeout/);
          assert.ok(await page.evaluate(() => scrollY > 200), 'disabled navigation must remain rejected');
        } else {
          await arrival;
          assert.ok(await page.evaluate(() => scrollY < 50), 'native product navigation reaches hero');
        }
      }
      await page.close();
    }
    const stationary = await browser.newPage();
    await stationary.setContent('<p>No scrollable space</p>');
    await assert.rejects(prepareLandingScroll(stationary), /Timeout/);
    assert.strictEqual(await stationary.evaluate(() => scrollY), 0);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
