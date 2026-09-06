import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const ROOT = '/Users/Work/Desktop/sitebuilder/.claude/worktrees/agent-a4a6193967c69a337';
const require = createRequire(import.meta.url);

process.env.HIDOOK_TEST_PAY = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cls-diag-'));
process.env.SERVER_SECRET = 'cls-diag-' + crypto.randomBytes(12).toString('hex');
delete process.env.PUBLIC_URL;
delete process.env.HIDOOK_FAKE_DEPLOY;

require(path.join(ROOT, 'scripts', 'build-builder.js'));
const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
const { onStripeEvent } = require(path.join(ROOT, 'bot', 'web.js'));
const server = startServer({ port: 0, onStripeEvent });
await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
const base = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

await page.goto(base + '/app/', { waitUntil: 'load' });
await page.waitForSelector('#templates-grid .template-card', { timeout: 20000 });
await page.click('#hb-cookie-accept').catch(() => {});
await page.click('.template-card[data-template-id="product-menu"] .btn-start-tpl');
await page.waitForSelector('#preview-iframe', { timeout: 20000 });
await page.waitForTimeout(800);
if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
  await page.locator('#btn-close-drawer').click({ timeout: 4000 }).catch(() => {});
}
const slug = 'clsdiag-' + Date.now().toString(36);
await page.locator('#btn-publish').click();
await page.locator('#modal-publish').waitFor({ state: 'visible' });
await page.locator('#input-slug').fill(slug);
await page.locator('#btn-publish-continue').click();
await page.locator('#form-auth-email').waitFor({ state: 'visible' });
await page.locator('#input-email').fill('clsdiag@example.com');
await page.locator('#btn-send-magic').click();
await page.locator('#dev-link').waitFor({ state: 'visible' });
await page.locator('#dev-link').click();
await page.waitForSelector('#btn-pay-publish', { timeout: 8000 });
await page.click('#btn-pay-publish');
await page.waitForSelector('#success-url-link', { timeout: 15000 });
await page.close();

// Fresh, unrelated browser context — no cookie-consent/localStorage carried
// over from the publish-flow page above (that's what the main measurement
// harness does for its liveSite_* sections too: a brand-new incognito-like
// context per measurement).
const context2 = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page2 = await context2.newPage();
await page2.addInitScript(() => {
  window.__shifts = [];
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (!e.hadRecentInput) {
        window.__shifts.push({
          value: e.value,
          time: e.startTime,
          sources: (e.sources || []).map((s) => ({
            node: s.node ? (s.node.tagName + (s.node.id ? '#' + s.node.id : '') + (s.node.className ? '.' + String(s.node.className).split(' ').join('.') : '')) : null,
            previousRect: s.previousRect, currentRect: s.currentRect,
          })),
        });
      }
    }
  }).observe({ type: 'layout-shift', buffered: true });
});
const client = await page2.context().newCDPSession(page2);
await client.send('Network.enable');
await client.send('Network.emulateNetworkConditions', {
  offline: false, latency: 150,
  downloadThroughput: 1.6 * 1024 * 1024 / 8,
  uploadThroughput: 750 * 1024 / 8,
});
await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await page2.goto(base + '/live/' + slug + '/', { waitUntil: 'load', timeout: 30000 });
await page2.waitForTimeout(8000);
const shifts = await page2.evaluate(() => window.__shifts);
console.log(JSON.stringify(shifts, null, 2));

await browser.close();
await new Promise((r) => server.close(r));
process.exit(0);
