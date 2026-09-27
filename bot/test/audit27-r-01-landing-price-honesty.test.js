'use strict';
/**
 * Oracle for PLAN-AUDIT-2026-09-27.md task R-01 (finding landing#1).
 *
 * Owner decision 2026-09-27: the landing shows the 29/year renewal again
 * (reversing the intent of 194eb08/c121df3/76a35b0), the currency symbol
 * comes back on every price, and the copy must never say "o singură
 * plată" / "achiți o singură dată" — the product is a Stripe subscription
 * (14-day trial, 99 then 29/year renewal), and builder/terms.html §3 /
 * the publish+success modals already say so; only the landing lied.
 *
 * This oracle drives a real, isolated server + Chromium and reads the
 * rendered text of the four landing zones the finding named (hero,
 * proof-row, "Cum funcționează" step 03, footer) as an actual first-time
 * visitor would see them — not just the static HTML source — so it also
 * catches app.js failing to wire the price/renewal spans.
 *
 * It fails on the pre-fix landing (no currency symbol, no renewal, "o
 * singură dată" copy) and passes once the four zones show the
 * config-driven price with its currency symbol plus the renewal amount.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-r-01-landing-price-honesty.test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../..');
const SHOT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-r-01-'));

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-r-01-data-'));
process.env.DATA_DIR = tmpDir;
process.env.SERVER_SECRET = 'audit27-r-01-' + crypto.randomBytes(8).toString('hex');
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY = '1';
process.env.NODE_ENV = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
delete process.env.HIDOOK_FAKE_DEPLOY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;

let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log('PASS', name);
  } catch (e) {
    failed++;
    console.error('FAIL', name, '-', e.message);
    if (process.env.VERBOSE) console.error(e.stack);
  }
}

function loadPlaywright() {
  const candidates = [
    path.join(ROOT, 'node_modules/playwright'),
    '/Users/Work/.hermes/hermes-agent/node_modules/playwright',
  ];
  for (const cand of candidates) {
    try {
      return require(cand);
    } catch (_) {}
  }
  throw new Error('playwright not found');
}

async function main() {
  const { startServer } = require('../server.js');
  const server = startServer({ port: 0 });
  await new Promise((resolve) => (server.listening ? resolve() : server.once('listening', resolve)));
  const port = server.address().port;
  const base = 'http://127.0.0.1:' + port;

  let cfg;
  await check('GET /api/config exposes amount/currency/renewal', async () => {
    const res = await fetch(base + '/api/config', {
      headers: { Accept: 'application/json', 'CF-IPCountry': 'RO' },
    });
    assert.strictEqual(res.status, 200);
    cfg = await res.json();
    assert.strictEqual(cfg.amount, 99);
    assert.strictEqual(cfg.renewal, 29);
    assert.ok(cfg.currency, 'currency present');
  });

  const symbol = { eur: '€', gbp: '£', usd: '$' }[String(cfg.currency).toLowerCase()] || '€';
  const priceWithSymbol = symbol === '$' ? '$' + cfg.amount : cfg.amount + symbol;
  const renewalWithSymbol = symbol === '$' ? '$' + cfg.renewal : cfg.renewal + symbol;

  try {
    const { chromium } = loadPlaywright();
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
      page.setDefaultTimeout(20000);
      await page.goto(base + '/app/', { waitUntil: 'networkidle' });

      const cookieAccept = page.locator('#hb-cookie-accept');
      if (await cookieAccept.isVisible().catch(() => false)) {
        await cookieAccept.click().catch(() => {});
      }

      await check('hero mentions the price with currency symbol, the renewal, and never one-time-payment phrasing', async () => {
        const text = (await page.locator('#hero-sub').innerText()).replace(/\s+/g, ' ');
        await page.screenshot({ path: path.join(SHOT_DIR, '01-hero-sub-read.png') }).catch(() => {});
        assert.ok(text.includes(priceWithSymbol), 'hero shows price with currency symbol: ' + text);
        assert.ok(text.includes(renewalWithSymbol), 'hero shows renewal with currency symbol: ' + text);
        assert.ok(!/o singură dată|o singură plată/i.test(text), 'hero must not claim a one-time payment: ' + text);
      });

      await check('proof-row mentions the price with currency symbol, the renewal, and never one-time-payment phrasing', async () => {
        const text = (await page.locator('.proof-row').innerText()).replace(/\s+/g, ' ');
        await page.screenshot({ path: path.join(SHOT_DIR, '02-proof-row-read.png') }).catch(() => {});
        assert.ok(text.includes(priceWithSymbol), 'proof-row shows price with currency symbol: ' + text);
        assert.ok(text.includes(renewalWithSymbol), 'proof-row shows renewal with currency symbol: ' + text);
        assert.ok(!/o singură dată|o singură plată/i.test(text), 'proof-row must not claim a one-time payment: ' + text);
      });

      await check('"Cum funcționează" step 03 mentions the price with currency symbol, the renewal, and never one-time-payment phrasing', async () => {
        const howSection = page.locator('#cum-e');
        await howSection.scrollIntoViewIfNeeded();
        const text = (await howSection.locator('.how-step', { hasText: 'trialul de 14 zile' }).innerText()).replace(/\s+/g, ' ');
        await page.screenshot({ path: path.join(SHOT_DIR, '03-how-step-03-read.png') }).catch(() => {});
        assert.ok(text.includes(priceWithSymbol), 'how step 03 shows price with currency symbol: ' + text);
        assert.ok(text.includes(renewalWithSymbol), 'how step 03 shows renewal with currency symbol: ' + text);
        assert.ok(!/o singură dată|o singură plată/i.test(text), 'how step 03 must not claim a one-time payment: ' + text);
      });

      await check('footer mentions the price with currency symbol, the renewal, and never one-time-payment phrasing', async () => {
        const footer = page.locator('.landing-footer');
        await footer.scrollIntoViewIfNeeded();
        const text = (await footer.innerText()).replace(/\s+/g, ' ');
        await page.screenshot({ path: path.join(SHOT_DIR, '04-footer-read.png') }).catch(() => {});
        assert.ok(text.includes(priceWithSymbol), 'footer shows price with currency symbol: ' + text);
        assert.ok(text.includes(renewalWithSymbol), 'footer shows renewal with currency symbol: ' + text);
        assert.ok(!/o singură dată|o singură plată/i.test(text), 'footer must not claim a one-time payment: ' + text);
      });
    } finally {
      await browser.close();
    }
  } catch (e) {
    if (/playwright not found/.test(e.message)) {
      console.error('SKIP browser checks: playwright not installed —', e.message);
    } else {
      throw e;
    }
  }

  await new Promise((resolve) => server.close(resolve));
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_) {}

  if (failed) {
    console.error('\n' + failed + ' failure(s)');
    process.exit(1);
  }
  console.log('\nAll audit27-r-01-landing-price-honesty checks passed.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
