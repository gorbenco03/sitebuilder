'use strict';
/**
 * bot/test/wave11-mobile-editor-touch.test.js
 *
 * Wave 11 set out to answer one question nobody had checked before: can a
 * customer build and publish a site from their phone? Every prior audit
 * measured the PUBLISHED site at 390px; nobody had measured the EDITOR at
 * 390px. Driving the real editor with Playwright at a 390x844 touch-emulated
 * viewport (iPhone 12/13 class) found a severe, concrete bug before any CSS
 * was touched:
 *
 *   .editor-topbar-right is `flex:1 1 auto; justify-content:flex-end;
 *   overflow:visible`. At 390px its buttons (instagram/color/gallery/
 *   drawer/download html/download zip/publish, ~17 controls in the whole
 *   topbar) need far more width than flexbox gives that box. Because the
 *   box is right-aligned and never clips, the overflow bled BACKWARD past
 *   its own left edge — measured, instagram/color/gallery rendered starting
 *   around x=70px, stacking directly on top of the back button, account
 *   menu, undo/redo and the desktop/mobile preview toggle (x 63-232px).
 *   Later-DOM elements win hit-testing on overlap, so a real tap on
 *   #btn-preview-mobile timed out — Playwright reported an <svg> from
 *   .editor-topbar-right intercepting the pointer event. On a real phone
 *   this reads as: several topbar buttons just don't respond to touch.
 *
 * The fix (builder/index.html + builder/app.css only, see HANDOFF-mobile.md
 * for what could not be fixed here) wraps everything except #btn-publish in
 * a new `.editor-topbar-scroll` rail. Above 640px it is `display:contents`
 * — a layout no-op, byte-identical to the old markup. Below 640px it
 * becomes its own horizontally-scrollable flex row: content that doesn't
 * fit scrolls within its own box instead of bleeding onto siblings.
 * Publish stays outside the rail so it is never scrolled out of reach.
 * Touch targets across the topbar, drawer-close, and the cookie-consent
 * accept button are also brought up to the 44x44 baseline, and the color
 * popover is clamped to stay on-screen regardless of the inline position
 * app.js (frozen for this wave) computes for it.
 *
 * This test is the regression guard for all of that. It must keep passing
 * on the real editor, at a real 390px touch viewport, with real taps.
 *
 * Run: node --experimental-sqlite --test bot/test/wave11-mobile-editor-touch.test.js
 */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { test } = require('node:test');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const MIN_TARGET = 44;
const VIEWPORT = { width: 390, height: 844 };

function intersects(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

async function withEditor(run) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wave11-mobile-editor-'));
  const env = {
    DATA_DIR: dataDir,
    SERVER_SECRET: 'wave11-mobile-' + crypto.randomBytes(8).toString('hex'),
    HIDOOK_FAKE_DEPLOY: '1',
  };
  const prevEnv = {};
  for (const key of Object.keys(env)) { prevEnv[key] = process.env[key]; process.env[key] = env[key]; }
  const prevPublicUrl = process.env.PUBLIC_URL;
  delete process.env.PUBLIC_URL;

  delete require.cache[require.resolve(path.join(ROOT, 'scripts', 'build-builder.js'))];
  require(path.join(ROOT, 'scripts', 'build-builder.js'));
  delete require.cache[require.resolve(path.join(ROOT, 'bot', 'server.js'))];
  const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
  const server = startServer({ port: 0 });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const base = 'http://127.0.0.1:' + server.address().port;

  const browser = await chromium.launch({ headless: process.env.HIDOOK_E2E_HEADLESS !== '0' });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  try {
    await page.goto(base + '/app/', { waitUntil: 'networkidle' });
    await run(page, context);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
    for (const key of Object.keys(env)) {
      if (prevEnv[key] === undefined) delete process.env[key]; else process.env[key] = prevEnv[key];
    }
    if (prevPublicUrl !== undefined) process.env.PUBLIC_URL = prevPublicUrl;
  }
}

test('mobile editor: topbar buttons neither overlap nor fall under 44x44 at 390px', { timeout: 60000 }, async () => {
  await withEditor(async (page) => {
    const cookieBtn = page.locator('#hb-cookie-accept');
    await cookieBtn.waitFor({ state: 'visible' });
    const cookieBox = await cookieBtn.boundingBox();
    assert.ok(cookieBox.height >= MIN_TARGET, 'cookie accept button height >= 44px, got ' + cookieBox.height);
    await cookieBtn.tap();
    await cookieBtn.waitFor({ state: 'hidden' });

    await page.locator('.template-card[data-template-id="professionals"] .btn-start-tpl').tap();
    await page.waitForURL(/#edit$/);
    await page.locator('#details-drawer').waitFor({ state: 'visible' });
    await page.locator('#btn-close-drawer').tap();
    await page.locator('#details-drawer').waitFor({ state: 'hidden' });

    const buttons = await page.locator('.editor-topbar button').all();
    const report = [];
    for (const btn of buttons) {
      const id = await btn.getAttribute('id');
      const visible = await btn.isVisible();
      const box = visible ? await btn.boundingBox() : null;
      report.push({ id, visible, box });
    }

    // Every visible topbar button must meet the 44x44 touch-target floor.
    const tooSmall = report.filter((b) => b.box && (b.box.width < MIN_TARGET || b.box.height < MIN_TARGET));
    assert.deepStrictEqual(tooSmall.map((b) => b.id), [], 'no topbar button should be under 44x44px');

    // No two on-screen topbar buttons may overlap (the exact shape of the
    // bug this test guards against: a later-DOM button silently eating an
    // earlier one's taps).
    const onScreen = report.filter((b) => b.box && b.box.x >= -1 && b.box.x + b.box.width <= VIEWPORT.width + 1);
    const overlaps = [];
    for (let i = 0; i < onScreen.length; i += 1) {
      for (let j = i + 1; j < onScreen.length; j += 1) {
        if (intersects(onScreen[i].box, onScreen[j].box)) overlaps.push(onScreen[i].id + ' x ' + onScreen[j].id);
      }
    }
    assert.deepStrictEqual(overlaps, [], 'no two on-screen topbar buttons should overlap');

    // The controls a customer must always be able to reach without any
    // horizontal scrolling: back, account, undo/redo, device toggle,
    // publish. These must always be fully within the 390px viewport.
    const alwaysPinned = ['btn-back-templates', 'btn-account-menu', 'btn-undo', 'btn-redo', 'btn-preview-desktop', 'btn-preview-mobile', 'btn-publish'];
    for (const id of alwaysPinned) {
      const entry = report.find((b) => b.id === id);
      assert.ok(entry && entry.visible, id + ' must be visible');
      assert.ok(entry.box.x >= 0 && entry.box.x + entry.box.width <= VIEWPORT.width, id + ' must be fully on-screen without scrolling, got ' + JSON.stringify(entry.box));
    }

    // The specific tap that used to time out: the mobile preview toggle
    // must be genuinely tappable (not just "visible" — Playwright's tap
    // fails if another element intercepts the pointer event).
    await page.locator('#btn-preview-mobile').tap({ timeout: 5000 });
    assert.strictEqual(await page.locator('#btn-preview-mobile').getAttribute('aria-pressed'), 'true', 'mobile preview toggle must register the tap');

    // Publish must be reachable and correctly sized without any scrolling.
    const publishBox = await page.locator('#btn-publish').boundingBox();
    assert.ok(publishBox.width >= MIN_TARGET && publishBox.height >= MIN_TARGET, 'publish button must be >= 44x44px');
  });
});

test('mobile editor: color popover stays fully on-screen at 390px', { timeout: 60000 }, async () => {
  await withEditor(async (page) => {
    await page.locator('#hb-cookie-accept').tap();
    await page.locator('.template-card[data-template-id="professionals"] .btn-start-tpl').tap();
    await page.waitForURL(/#edit$/);
    await page.locator('#btn-close-drawer').tap();
    await page.locator('#details-drawer').waitFor({ state: 'hidden' });

    await page.locator('#btn-color-picker').tap();
    await page.locator('#color-popover').waitFor({ state: 'visible' });
    const box = await page.locator('#color-popover').boundingBox();
    assert.ok(box.x >= 0, 'color popover left edge on-screen, got x=' + box.x);
    assert.ok(box.x + box.width <= VIEWPORT.width, 'color popover right edge on-screen, got right=' + (box.x + box.width));
    assert.ok(box.y >= 0, 'color popover top edge on-screen, got y=' + box.y);

    // The controls inside it must be usable too.
    await page.locator('#color-custom-text').fill('#2F6B5F');
    assert.strictEqual((await page.locator('#color-custom-text').inputValue()).toUpperCase(), '#2F6B5F');
  });
});

test('mobile editor: details drawer close button meets the touch-target floor', { timeout: 60000 }, async () => {
  await withEditor(async (page) => {
    await page.locator('#hb-cookie-accept').tap();
    await page.locator('.template-card[data-template-id="professionals"] .btn-start-tpl').tap();
    await page.waitForURL(/#edit$/);
    await page.locator('#details-drawer').waitFor({ state: 'visible' });
    const box = await page.locator('#btn-close-drawer').boundingBox();
    assert.ok(box.width >= MIN_TARGET && box.height >= MIN_TARGET, 'drawer close button must be >= 44x44px, got ' + JSON.stringify(box));
    await page.locator('#btn-close-drawer').tap();
    await page.locator('#details-drawer').waitFor({ state: 'hidden' });
  });
});

test('mobile editor: inline text edit stays above a simulated keyboard', { timeout: 60000 }, async () => {
  await withEditor(async (page) => {
    await page.locator('#hb-cookie-accept').tap();
    await page.locator('.template-card[data-template-id="professionals"] .btn-start-tpl').tap();
    await page.waitForURL(/#edit$/);
    await page.locator('#btn-close-drawer').tap();
    await page.locator('#details-drawer').waitFor({ state: 'hidden' });

    const nameField = page.frameLocator('#preview-iframe').locator('[data-hb-edit="business.name"]').first();
    await nameField.waitFor({ state: 'visible' });
    await nameField.tap();
    const box = await nameField.boundingBox();
    // A real iOS keyboard on an 844pt-tall viewport covers roughly the
    // bottom 336pt. The field being edited must render above that line —
    // this is a template-editor layout property (the hero name sits near
    // the top of the page), not something Wave 11 changed, but it is worth
    // guarding: a future template/editor change could push it down.
    const keyboardTop = VIEWPORT.height - 336;
    assert.ok(box.y + box.height < keyboardTop, 'edited field must stay above the simulated keyboard, got bottom=' + (box.y + box.height) + ' vs keyboard top=' + keyboardTop);
  });
});
