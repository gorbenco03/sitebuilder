'use strict';
/**
 * V-3: live readability indicator in the color popover. Real browser:
 * accent #F6E9C6 on page background #FBF7EE shows "greu de citit"; the one-click
 * fix produces an accent with >=4.5:1 on the published /live page.
 * Run: node --experimental-sqlite --test bot/test/audit27-v3-color-contrast-indicator.test.js
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
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY = '1';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-v3-'));
process.env.SERVER_SECRET = 'audit27-v3-' + crypto.randomBytes(8).toString('hex');
for (const k of ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'VERCEL_TOKEN', 'CLOUDFLARE_API_TOKEN']) delete process.env[k];

function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); })
    .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
}
function ratio(a, b) {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

test('V-3: light accent on light background reads "greu de citit"; the fix button reaches 4.5:1 on the live page', async () => {
  require(path.join(ROOT, 'scripts', 'build-builder.js'));
  const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
  const server = startServer({ port: 0 });
  await new Promise((res, rej) => { server.once('listening', res); server.once('error', rej); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ headless: true });
  const shot = async (page, action) => page.screenshot({ path: path.join(os.tmpdir(), 'audit27-v3-' + action + '.png') }).catch(() => {});
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(30000);
    await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
    await page.locator('#hb-cookie-accept').click().catch(() => {});
    await page.locator('.template-card[data-template-id="product-menu"] .btn-start-tpl').click();
    await page.waitForURL(/#edit$/);
    await page.locator('#preview-iframe').waitFor({ state: 'visible' });
    await page.waitForTimeout(1000);
    if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
      await page.locator('#btn-close-drawer').click().catch(() => {});
      await page.waitForTimeout(400);
    }

    await page.locator('#btn-color-picker').click();
    await page.locator('#color-popover').waitFor({ state: 'visible' });

    // A readable combination first: no warning, no fix button.
    await page.locator('#color-bg-text').fill('#FBF7EE');
    await page.locator('#color-custom-text').fill('#1E3A5F');
    await page.waitForTimeout(500);
    await shot(page, '01-dark-accent-light-bg');
    assert.match(await page.locator('#color-contrast').innerText(), /Text ușor de citit/);
    assert.equal(await page.locator('#btn-color-readable').count(), 0, 'no fix button when readable');

    // The audit's pairing.
    await page.locator('#color-custom-text').fill('#F6E9C6');
    await page.waitForTimeout(500);
    await shot(page, '02-light-accent-light-bg');
    assert.match(await page.locator('#color-contrast').innerText(), /greu de citit/i, 'F6E9C6 on FBF7EE must read as hard to read');
    assert.ok(ratio('#F6E9C6', '#FBF7EE') < 4.5, 'sanity: the pairing really is below 4.5:1');
    assert.ok(await page.locator('#color-contrast svg').count() >= 1, 'indicator carries an icon');
    // The choice is never blocked: the swatch keeps what the owner picked.
    assert.equal((await page.locator('#color-custom-text').inputValue()).toUpperCase(), '#F6E9C6');

    await page.locator('#btn-color-readable').click();
    await page.waitForTimeout(500);
    await shot(page, '03-after-click-varianta-lizibila');
    const fixed = (await page.locator('#color-custom-text').inputValue()).toUpperCase();
    assert.match(fixed, /^#[0-9A-F]{6}$/);
    assert.notEqual(fixed, '#F6E9C6');
    assert.ok(ratio(fixed, '#FBF7EE') >= 4.5, 'fix gives >=4.5:1 on the chosen background');
    assert.match(await page.locator('#color-contrast').innerText(), /Text ușor de citit/);
    await page.keyboard.press('Escape').catch(() => {});

    // Publish and measure on the real /live page.
    await page.locator('#btn-publish').click();
    await page.locator('#modal-publish').waitFor({ state: 'visible' });
    const slug = 'audit27-v3-' + Date.now().toString(36);
    await page.locator('#input-slug').fill(slug);
    await page.locator('#btn-publish-continue').click();
    await page.locator('#form-auth-email').waitFor({ state: 'visible' });
    await page.locator('#input-email').fill('audit27-v3@example.com');
    await page.locator('#btn-send-magic').click();
    await page.locator('#dev-link').waitFor({ state: 'visible' });
    await page.locator('#dev-link').click();
    await page.locator('#btn-pay-publish').waitFor({ state: 'visible' });
    await page.locator('#btn-pay-publish').click();
    await page.locator('#modal-success-title').waitFor({ state: 'visible', timeout: 25000 });
    await shot(page, '04-published');

    const live = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await live.goto(base + '/live/' + slug + '/', { waitUntil: 'domcontentloaded' });
    const vars = await live.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      return { accent: cs.getPropertyValue('--color-primary').trim(), paper: cs.getPropertyValue('--color-cream').trim() };
    });
    await shot(live, '05-live-page');
    assert.equal(vars.accent.toUpperCase(), fixed, 'live page carries the fixed accent');
    assert.equal(vars.paper.toUpperCase(), '#FBF7EE');
    assert.ok(ratio(vars.accent, vars.paper) >= 4.5, 'accent vs page background measured on /live is >=4.5:1');
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
});
