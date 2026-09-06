'use strict';
/**
 * bot/test/wave8-templates-zoom-overflow.test.js
 *
 * Oracle for Wave8 finding #3 (MEDIUM): horizontal overflow at 200% zoom on
 * product-menu, portfolio and professionals.
 *
 * Minimal reproduction (found by diagnosing which specific elements exceed
 * the viewport's right edge, rather than guessing): publish the template
 * with a realistic but long rename (an owner renaming to a real, longer
 * business name — nothing adversarial, well inside each schema's own
 * maxLen), open the live site at 390px, apply
 * `document.documentElement.style.zoom = 2` (this codebase's own
 * 200%-zoom test approximation), and check `document.documentElement`'s
 * scrollWidth/clientWidth and whether the page can actually be scrolled
 * sideways.
 *
 * Root causes found (two independent mechanisms, both about content that
 * cannot break onto a new line):
 *
 *   1. templates/professionals: contact.email ("contact@cabinet....ro") is
 *      one unbreakable token with no white-space to wrap on. It renders (a)
 *      inside `.pr-contact__list`, a CSS Grid whose implicit auto column
 *      has default min-width:auto on its <li> items — refusing to shrink
 *      the column below the email's own min-content width, and every row
 *      shares that one column so ALL of them got forced wide; and (b) as a
 *      plain inline `<a>` in `.pr-appt__fallback`, where inline text only
 *      wraps between words by default. Fixed with min-width:0 on the grid
 *      items (needed for anything else to have effect on a grid child) plus
 *      overflow-wrap/word-break on both spots. A separate, unrelated
 *      overflow source in the same template — `.pr-appt__submit`'s
 *      `min-width: 12rem` hard floor exceeding the ~195px effective layout
 *      width 200% zoom produces on a 390px phone — is fixed by switching to
 *      `width: min(100%, 12rem)`.
 *   2. templates/portfolio (same mechanism, different content): a long
 *      Instagram handle/address is one unbreakable token inside `.pf-row` /
 *      `.contact-item` chips. `.pf-appt__list` already wraps chips onto new
 *      lines (flex-wrap:wrap), but a flex item's default min-width still
 *      refuses to shrink a SINGLE chip below its own content's width. Fixed
 *      with the same overflow-wrap/word-break/max-width:100% shape.
 *      templates/product-menu's structurally identical `.pm-link` /
 *      `.contact-item` chips got the same defensive fix (checked
 *      statically below — not exercised live here since this preset's
 *      Instagram/Facebook labels are short and not derived from the
 *      business name, so this pass could not itself force a long token
 *      through them).
 *
 * Both templates also had a residual few-pixel-to-tens-of-pixels overflow
 * left over from non-content chrome (portfolio's off-canvas hamburger
 * drawer, which is `position:fixed` and hidden via `transform:
 * translateX(100%)` rather than `display:none` so it can slide in;
 * professionals' nav row, whose brand/CTA/hamburger are each already near
 * their practical minimum width). Both get `overflow-x: hidden` on `html`
 * AND `body` as a standard, low-risk backstop — confirmed by an ACTUAL
 * scroll attempt (`scrollTo`/mouse wheel), not just the scrollWidth number,
 * since a position:fixed/sticky descendant can still nudge that number
 * independently of what a visitor can actually scroll to.
 *
 * This oracle checks both effects per template: (a) scrollWidth no longer
 * exceeds clientWidth, and (b) the page is not actually scrollable
 * sideways (scrollX stays 0 after scrollTo + wheel) — the real user-facing
 * definition of "no horizontal overflow", since (a) alone can be misleading
 * under this zoom-approximation methodology.
 *
 * Causal RED before the templates/{professionals,portfolio}/styles.css
 * fixes, GREEN after.
 *
 * Run: node --experimental-sqlite --test bot/test/wave8-templates-zoom-overflow.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '../..');

const LONG_NAMES = {
  professionals: 'Cabinet de Avocatură și Consultanță Juridică Specializată în Drept Comercial',
  portfolio: 'Atelier de Înfrumusețare și Îngrijire Personală Ivoire Deluxe București',
};

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

async function publishWithLongName(browser, base, templateId, longName) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30000);

  await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
  if (await page.locator('#hb-cookie-accept').isVisible().catch(() => false)) {
    await page.locator('#hb-cookie-accept').click().catch(() => {});
  }
  await page.locator('.template-card[data-template-id="' + templateId + '"] .btn-start-tpl').click();
  await page.waitForURL(/#edit$/, { timeout: 30000 }).catch(() => {});
  await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(900);
  await page.locator('#btn-close-drawer').click().catch(() => {});
  await page.waitForTimeout(400);

  if (longName) {
    const iframeHandle = await page.$('#preview-iframe');
    const iframeCtx = await iframeHandle.contentFrame();
    const nameField = iframeCtx.locator('[data-hb-edit="business.name"]').first();
    await nameField.click();
    await page.keyboard.press('Control+A').catch(() => {});
    await page.keyboard.type(longName);
    await nameField.blur();
    await page.waitForTimeout(400);
  }

  await page.locator('#btn-publish').click();
  await page.waitForTimeout(300);
  const slug = 'wave8-zoom-' + templateId + '-' + Date.now();
  await page.locator('#input-slug').fill(slug);
  await page.waitForTimeout(200);
  await page.locator('#btn-publish-continue').click();
  await page.waitForTimeout(300);
  await page.locator('#input-email').fill('wave8-zoom-' + templateId + '@example.com');
  await page.locator('#btn-send-magic').click();
  await page.waitForTimeout(500);
  const devLink = page.locator('#dev-link');
  await devLink.waitFor({ state: 'visible', timeout: 10000 });
  await devLink.click();
  await page.waitForTimeout(1000);
  const payBtn = page.locator('#btn-pay-publish');
  await payBtn.waitFor({ state: 'visible', timeout: 15000 });
  await payBtn.click();
  await page.waitForTimeout(1200);
  const successLink = page.locator('#success-url-link');
  await successLink.waitFor({ state: 'visible', timeout: 15000 });
  const liveUrl = await successLink.getAttribute('href');
  await page.close();
  return liveUrl;
}

async function checkNoZoomOverflow(browser, liveUrl) {
  const live = await browser.newPage();
  live.setDefaultTimeout(30000);
  await live.setViewportSize({ width: 390, height: 844 });
  await live.goto(liveUrl, { waitUntil: 'networkidle' });
  if (await live.locator('#hb-cookie-accept').isVisible().catch(() => false)) {
    await live.locator('#hb-cookie-accept').click().catch(() => {});
  }
  await live.waitForTimeout(300);
  await live.evaluate(() => { document.documentElement.style.zoom = '2'; });
  await live.waitForTimeout(300);

  const before = await live.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));

  await live.evaluate(() => { window.scrollTo(9999, 0); });
  await live.waitForTimeout(150);
  await live.mouse.wheel(500, 0);
  await live.waitForTimeout(150);
  const scrollXAfter = await live.evaluate(() => window.scrollX);

  await live.close();
  return { ...before, scrollXAfter };
}

test('wave8 zoom overflow: professionals stays scroll-free at 200% zoom / 390px with a long business name', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave8-zoom-pr-'));
  process.env.DATA_DIR = tmpDir;
  process.env.SERVER_SECRET = 'wave8-zoom-pr-' + crypto.randomBytes(8).toString('hex');
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.HIDOOK_TEST_PAY = '1';
  process.env.NODE_ENV = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
  delete process.env.HIDOOK_FAKE_DEPLOY;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;

  execFileSync('node', [path.join(ROOT, 'scripts/build-builder.js')], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] });

  delete require.cache[require.resolve(path.join(ROOT, 'bot/server.js'))];
  const { startServer } = require(path.join(ROOT, 'bot/server.js'));
  const server = startServer({ port: 0 });
  await new Promise((resolve) => (server.listening ? resolve() : server.once('listening', resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  try {
    const liveUrl = await publishWithLongName(browser, base, 'professionals', LONG_NAMES.professionals);
    const result = await checkNoZoomOverflow(browser, liveUrl);

    assert.ok(
      result.scrollWidth <= result.clientWidth + 2,
      'professionals: scrollWidth (' + result.scrollWidth + ') must not exceed clientWidth (' + result.clientWidth + ') at 200% zoom / 390px'
    );
    assert.ok(
      result.scrollXAfter <= 2,
      'professionals: the page must not actually be scrollable sideways — scrollX reached ' + result.scrollXAfter + ' after scrollTo+wheel'
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('wave8 zoom overflow: portfolio stays scroll-free at 200% zoom / 390px with a long business name', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave8-zoom-pf-'));
  process.env.DATA_DIR = tmpDir;
  process.env.SERVER_SECRET = 'wave8-zoom-pf-' + crypto.randomBytes(8).toString('hex');
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.HIDOOK_TEST_PAY = '1';
  process.env.NODE_ENV = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
  delete process.env.HIDOOK_FAKE_DEPLOY;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;

  execFileSync('node', [path.join(ROOT, 'scripts/build-builder.js')], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] });

  delete require.cache[require.resolve(path.join(ROOT, 'bot/server.js'))];
  const { startServer } = require(path.join(ROOT, 'bot/server.js'));
  const server = startServer({ port: 0 });
  await new Promise((resolve) => (server.listening ? resolve() : server.once('listening', resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  try {
    const liveUrl = await publishWithLongName(browser, base, 'portfolio', LONG_NAMES.portfolio);
    const result = await checkNoZoomOverflow(browser, liveUrl);

    assert.ok(
      result.scrollWidth <= result.clientWidth + 2,
      'portfolio: scrollWidth (' + result.scrollWidth + ') must not exceed clientWidth (' + result.clientWidth + ') at 200% zoom / 390px'
    );
    assert.ok(
      result.scrollXAfter <= 2,
      'portfolio: the page must not actually be scrollable sideways — scrollX reached ' + result.scrollXAfter + ' after scrollTo+wheel'
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('wave8 zoom overflow: product-menu contact chips carry the same defensive overflow-wrap as the other two templates', () => {
  // Static check only (see file comment): this preset's Instagram/Facebook
  // labels are short and not derived from the business name, so a live
  // pass could not itself force a long enough token through .pm-link to
  // reproduce overflow — but the CSS class is shared verbatim with
  // portfolio's .pf-row/.contact-item, which COULD (and did) reproduce it,
  // so product-menu carries the identical latent risk and gets the
  // identical preventive fix.
  const css = fs.readFileSync(path.join(ROOT, 'templates/product-menu/styles.css'), 'utf8');
  const ruleMatch = css.match(/\.pm-link,\s*\.contact-item\s*\{([^}]*)\}/);
  assert.ok(ruleMatch, '.pm-link, .contact-item rule must exist in templates/product-menu/styles.css');
  const body = ruleMatch[1];
  assert.match(body, /overflow-wrap:\s*break-word/, '.pm-link/.contact-item must allow a long unbreakable token to wrap');
  assert.match(body, /max-width:\s*100%/, '.pm-link/.contact-item must not force a chip wider than its container');
});
