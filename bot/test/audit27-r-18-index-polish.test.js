'use strict';
/**
 * bot/test/audit27-r-18-index-polish.test.js
 *
 * Oracle for PLAN-AUDIT-2026-09-27.md task R-18 (owned file: builder/index.html):
 *
 *   landing#2    On a fresh mobile visit (390px), before consent, scrolled to
 *                the true bottom of the page, the footer's Termeni /
 *                Confidențialitate / Cookie-uri links must still be the
 *                element hit by a tap at their own center — not the fixed
 *                cookie banner sitting over them.
 *   copy-i18n#1  The nav tab and the dashboard title say "Site-urile mele",
 *                not "Proiectele mele" (the account-menu item is out of
 *                scope for this task and keeps its own text).
 *   landing#3    Clicking the logo, or "Designuri" in the nav, from a
 *                scrolled position returns the visitor to the top of the
 *                page (the hero), instead of leaving them stranded where
 *                they were.
 *
 * Each check is false against the pre-fix builder/index.html and true once
 * this task's fix lands.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-r-18-index-polish.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));
const SHOT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-r-18-'));

async function boot(tag) {
  process.env.HIDOOK_TEST_PAY = '1';
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-r18-' + tag + '-'));
  process.env.SERVER_SECRET = 'audit27-r18-' + tag + '-secret';
  for (const k of ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'CLOUDFLARE_API_TOKEN', 'VERCEL_TOKEN']) delete process.env[k];
  delete require.cache[require.resolve(path.join(ROOT, 'bot/server.js'))];
  const { startServer } = require(path.join(ROOT, 'bot/server.js'));
  const server = startServer({ port: 0 });
  await new Promise((res, rej) => { server.once('listening', res); server.once('error', rej); });
  return { server, base: 'http://127.0.0.1:' + server.address().port };
}

test('landing#2: the footer legal links stay tappable at 390px while the cookie banner is visible', async () => {
  const { server, base } = await boot('landing2');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(base + '/app/', { waitUntil: 'networkidle' });
    // Fresh visit — no prior consent, so the banner is up.
    assert.strictEqual(
      await page.evaluate(() => document.getElementById('hb-cookie-banner').hidden),
      false,
      'banner must be visible pre-consent for this check to mean anything'
    );

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(SHOT_DIR, '01-scrolled-to-bottom-390.png') }).catch(() => {});

    const hit = await page.evaluate(() => {
      const link = document.querySelector('.landing-footer-legal a[href="/app/terms.html"]');
      const r = link.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const el = document.elementFromPoint(cx, cy);
      return {
        inViewport: cy >= 0 && cy <= window.innerHeight,
        hitIsLink: !!(el && (el === link || link.contains(el))),
        hitTag: el ? el.tagName + (el.id ? '#' + el.id : '') : null,
      };
    });
    await page.screenshot({ path: path.join(SHOT_DIR, '02-measured-hit-test.png') }).catch(() => {});
    assert.strictEqual(hit.inViewport, true, 'Termeni link must be scrolled into the viewport by "scroll to bottom"');
    assert.strictEqual(hit.hitIsLink, true, 'a tap at the Termeni link center must hit the link, not ' + hit.hitTag);
  } finally {
    await browser.close();
    server.close();
  }
});

test('copy-i18n#1 (index.html part): nav tab and dashboard title say "Site-urile mele"', async () => {
  const { server, base } = await boot('copyi18n1');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(base + '/app/', { waitUntil: 'networkidle' });

    const navText = await page.locator('#nav-dashboard').textContent();
    assert.strictEqual(navText.trim(), 'Site-urile mele', 'nav tab must read "Site-urile mele"');

    const titleText = await page.evaluate(() => {
      const h2 = document.querySelector('#screen-dashboard h2');
      return h2 ? h2.textContent.trim() : null;
    });
    assert.strictEqual(titleText, 'Site-urile mele', 'dashboard title must read "Site-urile mele"');

    assert.ok(
      !/Proiectele mele/.test(navText) && titleText !== 'Proiectele mele',
      'old "Proiectele mele" wording must not remain in the nav/title'
    );
  } finally {
    await browser.close();
    server.close();
  }
});

test('landing#3: clicking the logo or "Designuri" from a scrolled position returns to the top', async () => {
  const { server, base } = await boot('landing3');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(base + '/app/', { waitUntil: 'networkidle' });
    const cookieAccept = page.locator('#hb-cookie-accept');
    if (await cookieAccept.isVisible().catch(() => false)) await cookieAccept.click().catch(() => {});

    // -- logo --
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(100);
    const beforeLogo = await page.evaluate(() => window.scrollY);
    assert.ok(beforeLogo > 200, 'must actually be scrolled down before the logo click (was ' + beforeLogo + ')');
    await page.locator('a.logo').click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(SHOT_DIR, '03-after-logo-click.png') }).catch(() => {});
    const afterLogo = await page.evaluate(() => window.scrollY);
    assert.ok(afterLogo < 50, 'logo click must scroll back to the hero (scrollY was ' + afterLogo + ')');

    // -- "Designuri" nav link --
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(100);
    const beforeNav = await page.evaluate(() => window.scrollY);
    assert.ok(beforeNav > 200, 'must actually be scrolled down before the nav click (was ' + beforeNav + ')');
    await page.locator('.header-nav a[data-route="templates"]').click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(SHOT_DIR, '04-after-designuri-click.png') }).catch(() => {});
    const afterNav = await page.evaluate(() => window.scrollY);
    assert.ok(afterNav < 50, '"Designuri" click must scroll back to the hero (scrollY was ' + afterNav + ')');
  } finally {
    await browser.close();
    server.close();
  }
});
