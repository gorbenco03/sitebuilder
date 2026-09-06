// Captures before/after screenshots (1440 + 390) and the real published-site
// JSON-LD, using the actual builder publish flow (isolated test server).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const ROOT = '/Users/Work/Desktop/sitebuilder/.claude/worktrees/agent-a21dfa8b0715457a4';
const EVDIR = path.join(ROOT, '04-QA-Evidence/Wave5-professionals');

const label = process.argv[2]; // 'before' | 'after'
if (!label) { console.error('usage: node capture-evidence.mjs <before|after>'); process.exit(1); }

process.env.HIDOOK_TEST_PAY = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wave5-evidence-' + label + '-'));
process.env.SERVER_SECRET = 'wave5-evidence-' + crypto.randomBytes(12).toString('hex');
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
await page.click('.template-card[data-template-id="professionals"] .btn-start-tpl');
await page.waitForSelector('#preview-iframe', { timeout: 20000 });
await page.waitForTimeout(800);
if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
    await page.locator('#btn-close-drawer').click({ timeout: 4000 }).catch(() => {});
}
const slug = 'wave5prof-' + label + '-' + Date.now().toString(36);
await page.locator('#btn-publish').click();
await page.locator('#modal-publish').waitFor({ state: 'visible' });
await page.locator('#input-slug').fill(slug);
await page.locator('#btn-publish-continue').click();
await page.locator('#form-auth-email').waitFor({ state: 'visible' });
await page.locator('#input-email').fill('wave5evidence@example.com');
await page.locator('#btn-send-magic').click();
await page.locator('#dev-link').waitFor({ state: 'visible' });
await page.locator('#dev-link').click();
await page.waitForSelector('#btn-pay-publish', { timeout: 8000 });
await page.click('#btn-pay-publish');
await page.waitForSelector('#success-url-link', { timeout: 15000 });
await page.close();
await context.close();

const liveUrl = base + '/live/' + slug + '/';

for (const viewport of [{ w: 1440, h: 1000, name: 'desktop-1440' }, { w: 390, h: 844, name: 'mobile-390' }]) {
    const ctx = await browser.newContext({ viewport: { width: viewport.w, height: viewport.h } });
    const p = await ctx.newPage();
    await p.goto(liveUrl, { waitUntil: 'load', timeout: 30000 });
    await p.waitForTimeout(1500);
    await p.screenshot({ path: path.join(EVDIR, `${label}-live-${viewport.name}.png`), fullPage: false });
    await ctx.close();
}

// Real JSON-LD as it appears on the actual published site.
const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const p2 = await ctx2.newPage();
await p2.goto(liveUrl, { waitUntil: 'load', timeout: 30000 });
await p2.waitForTimeout(500);
const jsonLd = await p2.evaluate(() => {
    const el = document.querySelector('script[type="application/ld+json"]');
    return el ? el.textContent : null;
});
let parsed = null;
try { parsed = jsonLd ? JSON.parse(jsonLd) : null; } catch (e) { parsed = { parseError: String(e) }; }
fs.writeFileSync(path.join(EVDIR, `${label}-jsonld.json`), JSON.stringify({ liveUrl, raw: jsonLd, parsed }, null, 2));
console.log(label, 'liveUrl:', liveUrl);
console.log(label, 'jsonLd parsed:', JSON.stringify(parsed, null, 2));
await ctx2.close();

await browser.close();
await new Promise((r) => server.close(r));
process.exit(0);
