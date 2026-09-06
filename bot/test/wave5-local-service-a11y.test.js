'use strict';
/**
 * bot/test/wave5-local-service-a11y.test.js — audit mediums #31/#32 regression gate.
 *
 * Audit findings (04-QA-Evidence/Audit-2026-09-06-2225ca7/a11y/findings.json):
 *  - #31: the footer "IG"/"FB" links were bare text with no padding, measured
 *    13-23px wide/tall — under the WCAG 2.2 SC 2.5.8 24x24 CSS px minimum
 *    target size (the WhatsApp icon next to them measured 18x23, also short).
 *  - #32: on the default "renovari-bucuresti" preset, the hero stat numbers
 *    ("12+"/"240+") render in the owner's chosen accent (--cta, #0b3d91 navy
 *    for that preset) directly on the near-black hero background — measured
 *    1.8:1, under the 3:1 WCAG AA floor for bold 21.6px text.
 *
 * Both fixes are in templates/local-service/styles.css / template.html:
 *  - IG/FB are now real SVG icons inside a 44x44 anchor (matches
 *    professionals/desserdirina's existing icon pattern).
 *  - .ls-meter__n and .ls-punch__n::before use
 *    color-mix(in srgb, var(--cta) 50%, white) instead of the raw accent, so
 *    contrast holds for ANY colour a customer could pick via the colour
 *    picker (verified against navy, orange, and a worst-case near-black
 *    accent — see the code comment in styles.css).
 *
 * Also re-verifies the audit's existing 200%-zoom horizontal-overflow pass
 * for local-service still holds (a11y finding #30 was specific to
 * desserdirina, but the report notes local-service/portfolio share
 * collage.js and were confirmed clean — this locks that in for this
 * template rather than assuming it forever).
 *
 * Run: HIDOOK_TEST_PAY=1 HIDOOK_ISOLATED_DEPLOY=1 \
 *   node --experimental-sqlite --test bot/test/wave5-local-service-a11y.test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE_DIR = path.join(ROOT, '04-QA-Evidence', 'Wave5-local-service', 'a11y');

let failed = false;
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log('PASS', name))
    .catch((e) => {
      failed = true;
      console.error('FAIL', name, '-', e.message);
    });
}

function relLuminance([r, g, b]) {
  const c = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b);
}
function contrastRatio(c1, c2) {
  const l1 = relLuminance(c1), l2 = relLuminance(c2);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
function parseRgb(str) {
  // Chromium resolves color-mix() results as e.g. "color(srgb 0.52 0.62 0.78)"
  // (0-1 range) rather than "rgb(...)" (0-255) — handle both.
  const colorFn = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(str);
  if (colorFn) return [1, 2, 3].map((i) => parseFloat(colorFn[i]) * 255);
  const m = /rgba?\(([^)]+)\)/.exec(str);
  if (!m) throw new Error('unparseable colour: ' + str);
  const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
  return [parts[0], parts[1], parts[2]];
}

async function main() {
  process.env.HIDOOK_TEST_PAY = '1';
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wave5-ls-a11y-'));
  process.env.SERVER_SECRET = 'wave5-ls-a11y-' + crypto.randomBytes(12).toString('hex');
  delete process.env.PUBLIC_URL;
  delete process.env.HIDOOK_FAKE_DEPLOY;

  require(path.join(ROOT, 'scripts', 'build-builder.js'));
  const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
  const server = startServer({ port: 0 });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const base = 'http://127.0.0.1:' + server.address().port;

  fs.rmSync(EVIDENCE_DIR, { recursive: true, force: true });
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();

  try {
    await page.goto(base + '/app/', { waitUntil: 'networkidle' });
    await page.locator('#hb-cookie-accept').click();
    await page.locator('.template-card[data-template-id="local-service"] .btn-start-tpl').click();
    await page.waitForURL(/#edit$/);
    await page.frameLocator('#preview-iframe').locator('body').waitFor({ state: 'visible' });
    const closeDrawer = page.locator('#btn-close-drawer');
    if (await closeDrawer.isVisible().catch(() => false)) await closeDrawer.click();

    await page.locator('#btn-publish').click();
    await page.locator('#modal-publish').waitFor({ state: 'visible' });
    const slug = 'wave5-ls-a11y-' + Date.now().toString(36);
    await page.locator('#input-slug').fill(slug);
    await page.locator('#btn-publish-continue').click();
    await page.locator('#form-auth-email').waitFor({ state: 'visible' });
    await page.locator('#input-email').fill('wave5-ls-a11y@example.com');
    await page.locator('#btn-send-magic').click();
    await page.locator('#dev-link').waitFor({ state: 'visible' });
    await page.locator('#dev-link').click();
    await page.locator('#btn-pay-publish').waitFor({ state: 'visible' });
    await page.locator('#btn-pay-publish').click();
    await page.locator('#modal-success-title').filter({ hasText: 'Site-ul tău e live' }).waitFor({ state: 'visible', timeout: 20000 });
    const liveHref = await page.locator('#success-url-link').getAttribute('href');
    const liveUrl = new URL(liveHref, base).href;

    const livePage = await context.newPage();
    await livePage.goto(liveUrl, { waitUntil: 'networkidle' });

    await check('footer Instagram/Facebook/WhatsApp links each meet the 24x24 CSS px minimum target size (ideally 44x44)', async () => {
      const boxes = await livePage.evaluate(() => {
        return Array.from(document.querySelectorAll('.ls-foot__soc a')).map((a) => {
          const r = a.getBoundingClientRect();
          return { label: a.getAttribute('aria-label'), width: r.width, height: r.height };
        });
      });
      assert.ok(boxes.length >= 2, 'expected at least Instagram + Facebook links in the footer for this preset');
      boxes.forEach((b) => {
        assert.ok(b.width >= 24 && b.height >= 24, b.label + ' target is ' + b.width + 'x' + b.height + ', under the 24x24 minimum');
        assert.ok(b.width >= 44 && b.height >= 44, b.label + ' target is ' + b.width + 'x' + b.height + ', short of the 44x44 recommended size');
      });
    });

    await check('hero stat numbers (.ls-meter__n) meet 3:1 contrast against the hero background for this preset\'s navy accent', async () => {
      const data = await livePage.evaluate(() => {
        const el = document.querySelector('.ls-meter__n');
        const bgEl = document.querySelector('.ls-hero'); // carries the explicit background: var(--void)
        return el && bgEl ? { color: getComputedStyle(el).color, bg: getComputedStyle(bgEl).backgroundColor } : null;
      });
      assert.ok(data, '.ls-meter__n must be present on the default preset (business.yearsExp is set)');
      const ratio = contrastRatio(parseRgb(data.color), parseRgb(data.bg));
      console.log('  .ls-meter__n contrast =', ratio.toFixed(2), ':1 (color=' + data.color + ', bg=' + data.bg + ')');
      assert.ok(ratio >= 3, 'contrast ' + ratio.toFixed(2) + ':1 must be >= 3:1 for bold 21.6px text');
    });

    await check('numbered services list (.ls-punch__n) meets 4.5:1 contrast at its smaller 12px size', async () => {
      const data = await livePage.evaluate(() => {
        const el = document.querySelector('.ls-punch__n');
        const bgEl = document.querySelector('.ls-block--dark');
        if (!el || !bgEl) return null;
        const before = getComputedStyle(el, '::before');
        return { color: before.color, bg: getComputedStyle(bgEl).backgroundColor };
      });
      assert.ok(data, '.ls-punch__n must be present (services list is non-empty by default)');
      const ratio = contrastRatio(parseRgb(data.color), parseRgb(data.bg));
      console.log('  .ls-punch__n::before contrast =', ratio.toFixed(2), ':1');
      assert.ok(ratio >= 4.5, 'contrast ' + ratio.toFixed(2) + ':1 must be >= 4.5:1 for 12px text');
    });

    await check('no horizontal scrolling at 200% zoom (desktop)', async () => {
      const overflow = await livePage.evaluate(() => {
        document.documentElement.style.zoom = '2';
        return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
      });
      await livePage.screenshot({ path: path.join(EVIDENCE_DIR, 'zoom200-desktop.png') });
      await livePage.evaluate(() => { document.documentElement.style.zoom = '1'; });
      console.log('  zoom200 scrollWidth=' + overflow.sw + ' clientWidth=' + overflow.cw);
      assert.ok(overflow.sw <= overflow.cw + 1, 'horizontal overflow at 200% zoom: scrollWidth ' + overflow.sw + ' > clientWidth ' + overflow.cw);
    });

    await livePage.setViewportSize({ width: 390, height: 844 });
    await check('no horizontal scrolling at 200% zoom (mobile 390)', async () => {
      const overflow = await livePage.evaluate(() => {
        document.documentElement.style.zoom = '2';
        return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
      });
      await livePage.screenshot({ path: path.join(EVIDENCE_DIR, 'zoom200-mobile.png') });
      await livePage.evaluate(() => { document.documentElement.style.zoom = '1'; });
      console.log('  mobile zoom200 scrollWidth=' + overflow.sw + ' clientWidth=' + overflow.cw);
      assert.ok(overflow.sw <= overflow.cw + 1, 'horizontal overflow at 200% zoom (mobile): scrollWidth ' + overflow.sw + ' > clientWidth ' + overflow.cw);
    });

    await livePage.setViewportSize({ width: 1440, height: 1000 });
    await livePage.screenshot({ path: path.join(EVIDENCE_DIR, 'footer-social-icons.png'), clip: { x: 0, y: 0, width: 1440, height: 1000 } }).catch(() => {});

    if (failed) {
      console.error('\nwave5-local-service-a11y.test.js: FAILED');
      process.exit(1);
    }
    console.log('\nwave5-local-service-a11y.test.js: all checks passed');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error('FAIL wave5-local-service-a11y:', e.message);
  process.exit(1);
});
