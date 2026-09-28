'use strict';
/**
 * bot/test/audit27-u-02-demo-focus-select.test.js — PLAN-AUDIT-2026-09-27,
 * task U-02 (PLAN-UX-2026-09-27 §3, "Editing micro-UX in the preview").
 *
 * Two independent builder/edit-overlay.js gaps, both present on HEAD before
 * this task's changes:
 *
 *   - preview-fidelity lens: a field still carrying the amber "still demo"
 *     marker (.hb-demo-text) did nothing special on click — an owner had to
 *     already know Ctrl/Cmd+A (the separate R-08 fix) to clear the sample
 *     text before typing their own, or risk splicing new text into the
 *     middle of the old one. Fixed by selecting the field's whole content on
 *     the FIRST click only (setupTextFields()'s new click handler) — a later
 *     click, once the owner is genuinely editing, places the caret normally.
 *
 *   - editor-text-images#3: `.hb-img-btn` ("Înlocuiește fotografia" on a
 *     plain <img>, not the always-visible background-photo variant) was
 *     `opacity:0` with only a `:hover` rule to reveal it — invisible to
 *     anyone tabbing through the canvas (no `:focus-within` rule existed)
 *     and unreachable on a touch screen (no hover state at all). Fixed by a
 *     `.hb-img-wrap:focus-within > .hb-img-btn` rule plus an
 *     `@media (hover: none)` fallback that makes the button always visible
 *     on a device with no hover capability at all.
 *
 * RED (pre-fix, reproduced against HEAD before this task's changes):
 *   - clicking a still-demo field once left the caret collapsed at the click
 *     point, selection empty — typing spliced into the old text instead of
 *     replacing it.
 *   - focusing (Tab) or touch-emulating a non-empty photo's replace button
 *     left it at `opacity: 0`, invisible and unclickable without a mouse
 *     hover.
 *
 * GREEN (this task): first click on a still-demo field selects it all; a
 * second click on the same (now non-demo, or already-clicked) field behaves
 * like an ordinary click; the photo replace button is visible on keyboard
 * focus and on any hover:none (touch) device.
 *
 * Uses Playwright's bundled Chromium from node_modules (never a hardcoded
 * browser path) — this bug lives in edit-overlay.js, which only runs inside
 * the interactive builder's sandboxed iframe, not in a static build.js
 * render.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-u-02-demo-focus-select.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');
const EDIT_OVERLAY_SOURCE = fs.readFileSync(path.join(ROOT, 'builder/edit-overlay.js'), 'utf8');

function loadPlaywright() {
  const candidates = [
    path.join(ROOT, 'node_modules/playwright'),
    '/Users/Work/.hermes/hermes-agent/node_modules/playwright',
    path.join(ROOT, '../fullpass-63230d2/node_modules/playwright'),
  ];
  for (const cand of candidates) {
    try {
      return require(cand);
    } catch (_) {}
  }
  throw new Error('playwright not found in any candidate location');
}
const { chromium } = loadPlaywright();

async function openTemplateEditor(page, templateId) {
  await page.goto(global.__BASE__ + '/app/', { waitUntil: 'domcontentloaded' });
  if (await page.locator('#hb-cookie-accept').isVisible().catch(() => false)) {
    await page.locator('#hb-cookie-accept').click().catch(() => {});
  }
  await page.locator(`.template-card[data-template-id="${templateId}"] .btn-start-tpl`).click();
  await page.waitForURL(/#edit$/, { timeout: 30000 }).catch(() => {});
  await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(900);
  const drawer = page.locator('#details-drawer');
  if (await drawer.isVisible().catch(() => false)) {
    await page.locator('#btn-close-drawer').click({ timeout: 4000 }).catch(() => {});
    await drawer.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }
  await page.waitForTimeout(400);
}

async function visibleFieldLocator(page, dataHbEditPath) {
  const iframeHandle = await page.$('#preview-iframe');
  const iframeCtx = await iframeHandle.contentFrame();
  const visibleIndex = await iframeCtx.evaluate((p) => {
    const els = Array.from(document.querySelectorAll(`[data-hb-edit="${p}"]`));
    return els.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }, dataHbEditPath);
  assert.ok(visibleIndex >= 0, `no visible ${dataHbEditPath} occurrence found`);
  return page.frameLocator('#preview-iframe').locator(`[data-hb-edit="${dataHbEditPath}"]`).nth(visibleIndex);
}

async function screenshot(page, actionJustPerformed) {
  const file = path.join(os.tmpdir(), `audit27-u02-${actionJustPerformed}.png`);
  await page.screenshot({ path: file }).catch(() => {});
  return file;
}

let browser;
let server;

test.before(async () => {
  process.env.HIDOOK_TEST_PAY = '1';
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-u02-'));
  process.env.SERVER_SECRET = 'audit27-u02-' + crypto.randomBytes(8).toString('hex');
  for (const k of ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'CLOUDFLARE_API_TOKEN', 'VERCEL_TOKEN']) delete process.env[k];

  require(path.join(ROOT, 'scripts/build-builder.js'));
  const { startServer } = require(path.join(ROOT, 'bot/server.js'));
  server = startServer({ port: 0 });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  global.__BASE__ = 'http://127.0.0.1:' + server.address().port;

  browser = await chromium.launch({ headless: true });
});

test.after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (process.env.DATA_DIR) fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

test('source: setupTextFields() wires a first-click select-all guarded by demoFirstClickDone and hb-demo-text', () => {
  assert.match(
    EDIT_OVERLAY_SOURCE,
    /var demoFirstClickDone = false;\s*el\.addEventListener\('click', function \(\) \{\s*if \(demoFirstClickDone\) return;\s*demoFirstClickDone = true;\s*if \(!el\.classList\.contains\('hb-demo-text'\)\) return;\s*var range = document\.createRange\(\);\s*range\.selectNodeContents\(el\);\s*var sel = window\.getSelection\(\);\s*sel\.removeAllRanges\(\);\s*sel\.addRange\(range\);/,
    'setupTextFields() must select a still-demo field\'s whole content on the first click only, via a guard flag scoped per field'
  );
});

test('source: the R-08 Ctrl/Cmd+A keydown handler is untouched by the new click handler', () => {
  assert.match(
    EDIT_OVERLAY_SOURCE,
    /el\.addEventListener\('keydown', function \(e\) \{\s*if \(!isSelectAllShortcut\(e\)\) return;\s*e\.preventDefault\(\);\s*var range = document\.createRange\(\);\s*range\.selectNodeContents\(el\);\s*var sel = window\.getSelection\(\);\s*sel\.removeAllRanges\(\);\s*sel\.addRange\(range\);/,
    'the preview-fidelity#2 (R-08) Ctrl/Cmd+A handler must still exist unmodified'
  );
});

test('source: .hb-img-wrap:focus-within and @media (hover: none) both reveal .hb-img-btn', () => {
  // These CSS rules live as JS string-array literals (injected into the
  // iframe as a <style> at runtime), so the regex matches the raw source —
  // quotes, commas and all — not assembled CSS text.
  assert.match(
    EDIT_OVERLAY_SOURCE,
    /'\.hb-img-wrap:focus-within > \.hb-img-btn \{',\s*'\s*opacity: 1;',\s*'\s*pointer-events: auto;',\s*'\}',/,
    'a .hb-img-wrap:focus-within rule must reveal its .hb-img-btn for keyboard users'
  );
  assert.match(
    EDIT_OVERLAY_SOURCE,
    /'@media \(hover: none\) \{',\s*'\s*\.hb-img-btn \{',\s*'\s*opacity: 1;',\s*'\s*pointer-events: auto;',\s*'\s*\}',\s*'\}',/,
    'a @media (hover: none) rule must make .hb-img-btn always visible on touch devices'
  );
});

test('source: .hb-demo-text gets its own visible (amber) :focus outline', () => {
  assert.match(
    EDIT_OVERLAY_SOURCE,
    /'\[data-hb-edit\]\[data-hb-kind="text"\]\.hb-demo-text:focus \{',\s*'\s*outline: 2px solid rgba\(180,83,9,0\.95\);',\s*'\s*outline-offset: 2px;',\s*'\}',/,
    '.hb-demo-text must get a visible focus outline distinct from the ordinary blue one'
  );
});

test('behavior: first click on a still-demo field selects it all; the next click does not', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30000);
  try {
    await openTemplateEditor(page, 'product-menu');
    const target = await visibleFieldLocator(page, 'business.name');

    const isDemo = await target.evaluate((el) => el.classList.contains('hb-demo-text'));
    assert.ok(isDemo, 'business.name must still carry the demo marker for this test to mean anything');
    const fullText = (await target.evaluate((el) => el.textContent)) || '';
    assert.ok(fullText.length > 1, 'business.name demo preset must be non-trivial text');

    await target.click();
    await screenshot(page, '01-first-click-on-demo-field');
    const firstSelection = await target.evaluate((el) => el.ownerDocument.getSelection().toString());
    assert.equal(firstSelection, fullText, 'the first click on a still-demo field must select its whole text');

    // Second click, at a different point inside the same (still-demo,
    // un-typed) field: must behave like an ordinary click — caret only,
    // not another full selection.
    const box = await target.boundingBox();
    await page.mouse.click(box.x + Math.min(6, box.width / 4), box.y + box.height / 2);
    await screenshot(page, '02-second-click-on-demo-field');
    const secondSelection = await target.evaluate((el) => el.ownerDocument.getSelection().toString());
    assert.notEqual(
      secondSelection,
      fullText,
      'a second click on the same field must not re-select everything — only the FIRST click does'
    );
  } finally {
    await page.close();
  }
});

test('behavior: the photo replace button is visible on keyboard focus without any hover', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30000);
  try {
    await openTemplateEditor(page, 'product-menu');
    const btn = page.frameLocator('#preview-iframe').locator('.hb-img-wrap:not(.hb-img-wrap--empty) > .hb-img-btn').first();
    await btn.waitFor({ state: 'attached', timeout: 10000 });

    const baseline = await btn.evaluate((el) => getComputedStyle(el).opacity);
    assert.equal(baseline, '0', 'sanity: the button must start hidden (hover-only) before this fix\'s focus/touch rules kick in');

    await btn.evaluate((el) => el.focus());
    await screenshot(page, '03-photo-button-keyboard-focused');
    const focusedOpacity = await btn.evaluate((el) => getComputedStyle(el).opacity);
    const focusedPointerEvents = await btn.evaluate((el) => getComputedStyle(el).pointerEvents);
    assert.equal(focusedOpacity, '1', 'keyboard focus (via :focus-within on the wrapper) must reveal the replace button');
    assert.equal(focusedPointerEvents, 'auto', 'the focused replace button must be clickable, not just visible');
  } finally {
    await page.close();
  }
});

test('behavior: the photo replace button is visible by default on a touch (hover:none) device', async () => {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  page.setDefaultTimeout(30000);
  try {
    await openTemplateEditor(page, 'product-menu');
    const btn = page.frameLocator('#preview-iframe').locator('.hb-img-wrap:not(.hb-img-wrap--empty) > .hb-img-btn').first();
    await btn.waitFor({ state: 'attached', timeout: 10000 });
    await screenshot(page, '04-photo-button-touch-device');

    const opacity = await btn.evaluate((el) => getComputedStyle(el).opacity);
    const pointerEvents = await btn.evaluate((el) => getComputedStyle(el).pointerEvents);
    assert.equal(opacity, '1', 'on a device with no hover capability, the replace button must be visible without any interaction');
    assert.equal(pointerEvents, 'auto', 'the touch-visible replace button must be tappable');
  } finally {
    await page.close();
  }
});
