import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const ROOT = '/Users/Work/Desktop/sitebuilder/.claude/worktrees/agent-a4a6193967c69a337';
const require = createRequire(import.meta.url);
const OUT = '/Users/Work/Desktop/sitebuilder/.claude/worktrees/agent-a4a6193967c69a337/04-QA-Evidence/Audit-Fixes-2026-09-06/performance';

process.env.HIDOOK_TEST_PAY = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-check-'));
process.env.SERVER_SECRET = 'visual-check-' + crypto.randomBytes(12).toString('hex');
delete process.env.PUBLIC_URL;
delete process.env.HIDOOK_FAKE_DEPLOY;

require(path.join(ROOT, 'scripts', 'build-builder.js'));
const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
const { onStripeEvent } = require(path.join(ROOT, 'bot', 'web.js'));
const server = startServer({ port: 0, onStripeEvent });
await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
const base = 'http://127.0.0.1:' + server.address().port;

const browser = await chromium.launch({ headless: true });

for (const tid of ['local-service', 'professionals']) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(base + '/app/', { waitUntil: 'load' });
  await page.waitForSelector('#templates-grid .template-card', { timeout: 20000 });
  await page.click('#hb-cookie-accept').catch(() => {});
  await page.click(`.template-card[data-template-id="${tid}"] .btn-start-tpl`);
  await page.waitForSelector('#preview-iframe', { timeout: 20000 });
  await page.waitForTimeout(800);
  if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
    await page.locator('#btn-close-drawer').click({ timeout: 4000 }).catch(() => {});
  }
  const slug = 'visualcheck-' + tid + '-' + Date.now().toString(36);
  await page.locator('#btn-publish').click();
  await page.locator('#modal-publish').waitFor({ state: 'visible' });
  await page.locator('#input-slug').fill(slug);
  await page.locator('#btn-publish-continue').click();
  await page.locator('#form-auth-email').waitFor({ state: 'visible' });
  await page.locator('#input-email').fill('visualcheck@example.com');
  await page.locator('#btn-send-magic').click();
  await page.locator('#dev-link').waitFor({ state: 'visible' });
  await page.locator('#dev-link').click();
  await page.waitForSelector('#btn-pay-publish', { timeout: 8000 });
  await page.click('#btn-pay-publish');
  await page.waitForSelector('#success-url-link', { timeout: 15000 });
  await page.close();

  const context2 = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page2 = await context2.newPage();
  await page2.goto(base + '/live/' + slug + '/', { waitUntil: 'load' });
  await page2.waitForTimeout(500);
  await page2.screenshot({ path: path.join(OUT, `visual-check-${tid}.png`), fullPage: true });
  console.log('captured', tid);
  await context2.close();
  await context.close();
}

await browser.close();
await new Promise((r) => server.close(r));
process.exit(0);
