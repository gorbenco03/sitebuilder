'use strict';
/**
 * bot/test/wave5-local-service-cls.test.js — CLS regression gate.
 *
 * Audit finding (performance lens, 04-QA-Evidence/Audit-2026-09-06-2225ca7/
 * performance/findings.json): a published live site measured CLS 0.20
 * (desktop 1440) / 0.1666 (mobile 390) against the 0.1 "good" threshold,
 * attributed to photo <img> tags with no width/height/aspect-ratio — the
 * browser can't reserve their box before the (also oversized, 3.7-7.5x)
 * JPEG finishes loading, so the layout jumps when it does.
 *
 * Direct measurement below (real PerformanceObserver 'layout-shift' entries
 * on templates/local-service's own published live site, default preset,
 * both viewports — not a proxy/estimate) shows this template was ALREADY
 * near zero CLS even before this change: templates/local-service/styles.css
 * already carried `aspect-ratio: 16 / 10` on `.ls-shot img` (portfolio
 * gallery) and `.ls-igcell img` (Instagram grid) — the audit's 0.20/0.17
 * figures were measured on a different, shared performance run (its own
 * evidence names a "Casa Nord" / product-menu site) and generalized to "the
 * product" rather than re-verified per template. This oracle's first check
 * pins that real number down for local-service specifically so a future
 * regression is caught here rather than assumed away.
 *
 * The one genuine gap this change closes: the two logo <img> tags
 * (.ls-hero__logo, .ls-foot__logo) — schema.json's "logo" field is a plain
 * path with no stored width/height, so an owner-uploaded logo had no
 * layout-reservation at all — had neither an aspect-ratio nor width/height.
 * The second check is a static, deterministic (zero-flakiness) source scan
 * that all four image classes still carry an aspect-ratio, so no one can
 * silently drop the protection again.
 *
 * Run: HIDOOK_TEST_PAY=1 HIDOOK_ISOLATED_DEPLOY=1 \
 *   node --experimental-sqlite --test bot/test/wave5-local-service-cls.test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const STYLES_PATH = path.join(ROOT, 'templates', 'local-service', 'styles.css');
const EVIDENCE_DIR = path.join(ROOT, '04-QA-Evidence', 'Wave5-local-service', 'cls');
const GOOD_THRESHOLD = 0.1; // Google's "good" CLS boundary.

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

// ---------------------------------------------------------------------------
// Static check: the CSS classes that carry the layout-reservation must keep
// an aspect-ratio declaration. Cheap, deterministic, catches the "someone
// deleted the one CSS line that mattered" regression instantly.
// ---------------------------------------------------------------------------
function checkAspectRatioDeclared() {
  const css = fs.readFileSync(STYLES_PATH, 'utf8');
  const required = ['.ls-shot img', '.ls-igcell img', '.ls-hero__logo', '.ls-foot__logo'];
  required.forEach((selector) => {
    const re = new RegExp(
      selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{[^}]*aspect-ratio\\s*:',
      's'
    );
    assert.ok(re.test(css), selector + ' must declare an aspect-ratio (or width+height) so its box is known before the image loads');
  });
}

// ---------------------------------------------------------------------------
// Real measurement: publish the actual default preset and read the browser's
// own layout-shift entries on the live site, at both required viewports.
// ---------------------------------------------------------------------------
async function measureLiveCls() {
  process.env.HIDOOK_TEST_PAY = '1';
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wave5-ls-cls-'));
  process.env.SERVER_SECRET = 'wave5-ls-cls-' + crypto.randomBytes(12).toString('hex');
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
    const slug = 'wave5-ls-cls-' + Date.now().toString(36);
    await page.locator('#input-slug').fill(slug);
    await page.locator('#btn-publish-continue').click();
    await page.locator('#form-auth-email').waitFor({ state: 'visible' });
    await page.locator('#input-email').fill('wave5-ls-cls@example.com');
    await page.locator('#btn-send-magic').click();
    await page.locator('#dev-link').waitFor({ state: 'visible' });
    await page.locator('#dev-link').click();
    await page.locator('#btn-pay-publish').waitFor({ state: 'visible' });
    await page.locator('#btn-pay-publish').click();
    await page.locator('#modal-success-title').filter({ hasText: 'Site-ul tău e live' }).waitFor({ state: 'visible', timeout: 20000 });
    const liveHref = await page.locator('#success-url-link').getAttribute('href');
    const liveUrl = new URL(liveHref, base).href;

    const out = {};
    for (const [name, size] of Object.entries({
      'desktop-1440': { width: 1440, height: 1000 },
      'mobile-390': { width: 390, height: 844 },
    })) {
      const p2 = await context.newPage();
      await p2.setViewportSize(size);
      await p2.addInitScript(() => {
        window.__cls = 0;
        try {
          new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
              if (!entry.hadRecentInput) window.__cls += entry.value;
            }
          }).observe({ type: 'layout-shift', buffered: true });
        } catch (_) {}
      });
      await p2.goto(liveUrl, { waitUntil: 'load' });
      await p2.waitForTimeout(2500); // let below-the-fold lazy images settle
      out[name] = await p2.evaluate(() => window.__cls);
      await p2.screenshot({ path: path.join(EVIDENCE_DIR, name + '.png'), fullPage: true });
      await p2.close();
    }
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'cls-results.json'), JSON.stringify({ liveUrl, ...out }, null, 2));
    return out;
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  }
}

(async () => {
  await check('layout-reservation CSS is present for every configurable/repeating photo slot', checkAspectRatioDeclared);

  const cls = await measureLiveCls();
  await check('published live site CLS (desktop 1440) is under the 0.1 "good" threshold', () => {
    console.log('  measured desktop-1440 CLS =', cls['desktop-1440']);
    assert.ok(cls['desktop-1440'] < GOOD_THRESHOLD, 'desktop CLS ' + cls['desktop-1440'] + ' must be < ' + GOOD_THRESHOLD);
  });
  await check('published live site CLS (mobile 390) is under the 0.1 "good" threshold', () => {
    console.log('  measured mobile-390 CLS =', cls['mobile-390']);
    assert.ok(cls['mobile-390'] < GOOD_THRESHOLD, 'mobile CLS ' + cls['mobile-390'] + ' must be < ' + GOOD_THRESHOLD);
  });

  if (failed) {
    console.error('\nwave5-local-service-cls.test.js: FAILED');
    process.exit(1);
  }
  console.log('\nwave5-local-service-cls.test.js: all checks passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
