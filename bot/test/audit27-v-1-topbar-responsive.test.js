'use strict';
/**
 * bot/test/audit27-v-1-topbar-responsive.test.js — PLAN-UX-2026-09-27 §4
 * "Bara de instrumente reactivă la spațiul real disponibil" (task V-1).
 *
 * Before: fixed media-query breakpoints decided which labels showed, and the
 * tool rail simply scrolled (and faded) whatever did not fit, so at split-screen
 * widths and at 200% zoom controls sat half-clipped inside the rail with no
 * sign they were there. After: builder/app.js layoutEditorTopbar() measures the
 * bar (ResizeObserver) and, lowest priority first, drops each control's label
 * and then moves it into "Mai mult".
 *
 * Property checked at 700/900/1100/1280/1440/1920 and 1440@200% zoom
 * (720 CSS px, deviceScaleFactor 2), each with the Details drawer closed and
 * open, plus a touch tablet:
 *   - every primary action (Instagram, secțiune, Culoare, Poze, Detalii,
 *     Descarcă HTML/ZIP, Publică) is either fully visible and tappable, or has
 *     a visible entry in the "Mai mult" menu;
 *   - no two visible controls overlap and none is clipped by the rail/bar;
 *   - a menu entry really runs the control's own handler;
 *   - on a coarse pointer every visible control keeps a 44px target.
 *
 * Screenshots go to os.tmpdir(), named after the action just performed.
 * Run: node --experimental-sqlite --test bot/test/audit27-v-1-topbar-responsive.test.js
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
process.env.HIDOOK_TEST_PAY = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hidook-v1-topbar-'));
process.env.SERVER_SECRET = 'v1-topbar-' + crypto.randomBytes(8).toString('hex');
for (const k of ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'CLOUDFLARE_API_TOKEN', 'VERCEL_TOKEN']) delete process.env[k];

require(path.join(ROOT, 'scripts', 'build-builder.js'));
const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));

let server;
let base;

test.before(async () => {
  server = startServer({ port: 0 });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => { if (server) server.close(); });

const ACTIONS = [
  'btn-add-instagram', 'btn-open-add-section', 'btn-color-picker', 'btn-open-gallery',
  'btn-open-drawer', 'btn-download-html', 'btn-download-zip',
];

function shot(page, name) {
  return page.screenshot({ path: path.join(os.tmpdir(), 'audit27-v1-' + name + '.png'), clip: { x: 0, y: 0, width: page.viewportSize().width, height: 130 } }).catch(() => {});
}

async function openEditor(page) {
  await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
  await page.locator('#hb-cookie-accept').click({ timeout: 3000 }).catch(() => {});
  await page.locator('.template-card[data-template-id="professionals"] .btn-start-tpl').click();
  await page.waitForURL(/#edit$/, { timeout: 30000 });
  await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(1200);
}

async function setDrawer(page, wantOpen) {
  const open = await page.locator('#details-drawer').isVisible().catch(() => false);
  if (open === wantOpen) return;
  if (open) await page.locator('#btn-close-drawer').click();
  else await page.evaluate(() => document.getElementById('btn-open-drawer').click());
  await page.waitForTimeout(500);
}

/** Geometry of the live bar: what is shown, where, and what is clipped or covered. */
function measure(actionIds) {
  const bar = document.getElementById('editor-topbar');
  const rail = document.querySelector('.editor-topbar-scroll');
  const barRect = bar.getBoundingClientRect();
  const railRect = rail.getBoundingClientRect();
  const visible = [];
  const problems = [];
  const sel = 'button[id], .demo-legend, #save-status, #checklist-indicator';
  bar.querySelectorAll(sel).forEach((el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    if (el.disabled && !/^btn-(undo|redo)$/.test(el.id)) return;
    const name = el.id || el.className;
    visible.push({ name, l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height });
    if (r.left < -0.5 || r.right > window.innerWidth + 0.5) problems.push(name + ' leaves the viewport');
    if (r.right > barRect.right + 0.5) problems.push(name + ' is clipped by the bar');
    if (rail.contains(el) && (r.left < railRect.left - 0.5 || r.right > railRect.right + 0.5)) problems.push(name + ' is clipped by the tool rail');
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!(top === el || el.contains(top)) && !el.disabled) problems.push(name + ' is covered by ' + (top ? (top.id || top.className || top.tagName) : 'nothing'));
  });
  for (let i = 0; i < visible.length; i++) {
    for (let j = i + 1; j < visible.length; j++) {
      const a = visible[i], c = visible[j];
      const ox = Math.min(a.r, c.r) - Math.max(a.l, c.l);
      const oy = Math.min(a.b, c.b) - Math.max(a.t, c.t);
      if (ox > 1 && oy > 1) problems.push(a.name + ' overlaps ' + c.name);
    }
  }
  const more = document.getElementById('btn-topbar-more');
  const moreVisible = !!more && more.getBoundingClientRect().width > 0;
  const shown = {};
  actionIds.forEach((id) => { const el = document.getElementById(id); shown[id] = !!el && el.getBoundingClientRect().width > 0; });
  const publish = document.getElementById('btn-publish').getBoundingClientRect();
  return { problems, moreVisible, shown, publishVisible: publish.width > 0 && publish.right <= window.innerWidth + 0.5, visible: visible.map((v) => v.name) };
}

const CASES = [
  { label: '700', width: 700, scale: 1 },
  { label: '900', width: 900, scale: 1 },
  { label: '1100', width: 1100, scale: 1 },
  { label: '1280', width: 1280, scale: 1 },
  { label: '1440', width: 1440, scale: 1 },
  { label: '1920', width: 1920, scale: 1 },
  { label: '1440-at-200pct-zoom', width: 720, scale: 2 },
];

test('every primary action is visible or in "Mai mult", never overlapped or clipped, at split-screen widths and 200% zoom', { timeout: 280000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  try {
    for (const c of CASES) {
      const context = await browser.newContext({ viewport: { width: c.width, height: 900 }, deviceScaleFactor: c.scale });
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      try {
        await openEditor(page);
        for (const drawer of [false, true]) {
          await setDrawer(page, drawer);
          const tag = c.label + (drawer ? '-drawer-open' : '-drawer-closed');
          const m = await page.evaluate(measure, ACTIONS);
          await shot(page, 'topbar-' + tag);
          m.problems.forEach((p) => failures.push(tag + ': ' + p));
          if (!m.publishVisible) failures.push(tag + ': Publică is not fully visible');
          const hidden = ACTIONS.filter((id) => !m.shown[id]);
          if (hidden.length) {
            if (!m.moreVisible) failures.push(tag + ': ' + hidden.join(', ') + ' hidden and no "Mai mult" button');
            else {
              await page.locator('#btn-topbar-more').click();
              const items = await page.evaluate(() => Array.from(document.querySelectorAll('#topbar-more-menu .topbar-more-menu-item'))
                .filter((i) => i.getBoundingClientRect().width > 0).map((i) => i.dataset.target));
              await shot(page, 'more-menu-open-' + tag);
              hidden.forEach((id) => { if (!items.includes(id)) failures.push(tag + ': #' + id + ' is neither in the bar nor in "Mai mult"'); });
              items.forEach((id) => { if (m.shown[id]) failures.push(tag + ': #' + id + ' is both in the bar and in "Mai mult"'); });
              await page.keyboard.press('Escape');
            }
          }
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  assert.deepEqual(failures, [], 'topbar failures:\n' + failures.join('\n'));
});

test('a "Mai mult" entry runs the control\'s own handler, and focus has somewhere visible to return to', { timeout: 120000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 700, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    await openEditor(page);
    await setDrawer(page, false);
    // At 700px Poze and Detalii do not fit; both must still work from the menu.
    assert.equal(await page.evaluate(() => document.getElementById('btn-open-gallery').getBoundingClientRect().width), 0, 'precondition: Poze is in the menu at 700px');
    await page.locator('#btn-topbar-more').click();
    await page.locator('#topbar-more-menu [data-target="btn-open-gallery"]').click();
    await page.locator('#modal-gallery').waitFor({ state: 'visible' });
    await shot(page, 'poze-opened-from-more-menu-700');
    await page.keyboard.press('Escape');
    await page.locator('#modal-gallery').waitFor({ state: 'hidden' });

    await page.locator('#btn-topbar-more').click();
    await page.locator('#topbar-more-menu [data-target="btn-open-drawer"]').click();
    await page.locator('#details-drawer').waitFor({ state: 'visible' });
    await shot(page, 'detalii-opened-from-more-menu-700');
    await page.locator('#btn-close-drawer').click();
    await page.locator('#details-drawer').waitFor({ state: 'hidden' });
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
    assert.equal(focused, 'btn-topbar-more', 'closing Details returns focus to the visible "Mai mult" trigger');
    await context.close();
  } finally {
    await browser.close();
  }
});

test('the bar re-flows live when the window is resized (no reload)', { timeout: 120000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    await openEditor(page);
    await setDrawer(page, false);
    const wide = await page.evaluate(measure, ACTIONS);
    await page.setViewportSize({ width: 800, height: 900 });
    await page.waitForTimeout(400);
    await shot(page, 'resized-to-800');
    const narrow = await page.evaluate(measure, ACTIONS);
    assert.deepEqual(narrow.problems, [], 'no overlap/clipping after shrinking: ' + narrow.problems.join('; '));
    assert.ok(Object.values(narrow.shown).filter(Boolean).length < Object.values(wide.shown).filter(Boolean).length, 'shrinking moves controls into "Mai mult"');
    assert.ok(narrow.moreVisible);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(400);
    const back = await page.evaluate(measure, ACTIONS);
    assert.deepEqual(back.shown, wide.shown, 'growing again restores the same controls');
    await context.close();
  } finally {
    await browser.close();
  }
});

test('touch tablet keeps 44px targets for every visible control and every menu entry', { timeout: 120000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    await openEditor(page);
    await setDrawer(page, false);
    const m = await page.evaluate(measure, ACTIONS);
    await shot(page, 'touch-tablet-820');
    assert.deepEqual(m.problems, []);
    const small = await page.evaluate(() => Array.from(document.querySelectorAll('#editor-topbar button[id]'))
      .filter((b) => !b.disabled).map((b) => ({ id: b.id, r: b.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && (x.r.width < 43.5 || x.r.height < 43.5)).map((x) => x.id + ' ' + Math.round(x.r.width) + 'x' + Math.round(x.r.height)));
    assert.deepEqual(small, [], 'targets under 44px: ' + small.join(', '));
    if (m.moreVisible) {
      await page.locator('#btn-topbar-more').tap();
      const tiny = await page.evaluate(() => Array.from(document.querySelectorAll('#topbar-more-menu .topbar-more-menu-item'))
        .map((i) => i.getBoundingClientRect()).filter((r) => r.width > 0 && r.height < 43.5).length);
      assert.equal(tiny, 0, 'menu entries are at least 44px tall');
    }
    await context.close();
  } finally {
    await browser.close();
  }
});
