'use strict';
/**
 * bot/test/audit27-w-3-topbar-and-pay-button-fit.test.js
 *
 * VERIFICARE-2026-10-04 H-02 and the layout mediums behind it (billing-account#2,
 * journey-phone#2, layout-responsive#1/#2/#4). Real Chromium, real server,
 * real magic-link sign-in; screenshots go to os.tmpdir(), named after the
 * action just performed.
 *
 * Property, at 320/360/375/390/420/440/700/768 CSS px, touch and mouse,
 * signed in and not:
 *   1. nothing in the editor topbar overlaps anything else, leaves the bar, or
 *      sits half-clipped (rail does not need to scroll, no fade mask over a
 *      control, text fits its own box);
 *   2. the template name is never reduced to a stub covered by Publică, and
 *      the account button never covers undo;
 *   3. at phone widths the pay button of the success modal and the
 *      "Adaugă un card" button of the dashboard card wrap instead of clipping
 *      (scrollWidth <= clientWidth, rect inside the viewport).
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-w-3-topbar-and-pay-button-fit.test.js
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
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hidook-w3-'));
process.env.SERVER_SECRET = 'w3-' + crypto.randomBytes(8).toString('hex');
for (const k of ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'CLOUDFLARE_API_TOKEN', 'VERCEL_TOKEN']) delete process.env[k];

require(path.join(ROOT, 'scripts', 'build-builder.js'));
const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));

const SHOT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-w3-shots-'));
const only = (process.env.W3_ONLY || '').split(',').filter(Boolean).map(Number);
const pick = (list) => (only.length ? list.filter((w) => only.includes(w)) : list);
const WIDTHS = pick([320, 360, 375, 390, 420, 440, 700, 768]);
const PHONE_WIDTHS = pick([320, 360, 375, 390, 420, 440]);

let server;
let base;
let signedState;

test.before(async () => {
  server = startServer({ port: 0 });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => { if (server) server.close(); });

function shot(page, name) {
  return page.screenshot({ path: path.join(SHOT_DIR, name + '.png'), clip: { x: 0, y: 0, width: page.viewportSize().width, height: 140 } }).catch(() => {});
}

async function startEditor(page) {
  await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
  await page.locator('#hb-cookie-accept').click({ timeout: 3000 }).catch(() => {});
  await page.locator('.template-card[data-template-id="professionals"] .btn-start-tpl').click();
  await page.waitForURL(/#edit$/, { timeout: 30000 });
  await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(900);
  if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
    await page.locator('#btn-close-drawer').click({ timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
}

/** Real magic-link sign-in from the editor, then publish up to the unpaid success modal. */
async function signInAndPublishUnpaid(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  await startEditor(page);
  await page.locator('#btn-publish').click();
  await page.locator('#modal-publish').waitFor({ state: 'visible' });
  await page.locator('#input-slug').fill('w3-' + crypto.randomUUID().slice(0, 8));
  await page.locator('#btn-publish-continue').click();
  await page.locator('#form-auth-email').waitFor({ state: 'visible' });
  await page.locator('#input-email').fill('w3-' + crypto.randomUUID().slice(0, 8) + '@example.com');
  await page.locator('#btn-send-magic').click();
  await page.locator('#dev-link').waitFor({ state: 'visible' });
  await page.locator('#dev-link').click();
  await page.locator('#modal-success').waitFor({ state: 'visible', timeout: 30000 });
  await page.locator('#btn-pay-publish').waitFor({ state: 'visible' });
  const state = await context.storageState();
  await context.close();
  return state;
}

/** Geometry of the live bar: everything shown, what overlaps, what is clipped.
 *  scrollRail: a mouse-driven window at phone width keeps the old scrolling rail
 *  (audit27-s-4 / suite12-mobile-topbar-discoverable), so rail controls beyond
 *  its edge are reached by scrolling and are checked at the end of the scroll
 *  by measureRailEnd instead. */
function measureTopbar(scrollRail) {
  const bar = document.getElementById('editor-topbar');
  const rail = document.querySelector('.editor-topbar-scroll');
  const barRect = bar.getBoundingClientRect();
  const railRect = rail.getBoundingClientRect();
  const problems = [];
  const items = [];
  const sel = 'button[id], #save-status, #checklist-indicator, #demo-legend, #editor-template-name';
  bar.querySelectorAll(sel).forEach((el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const name = el.id || el.className;
    items.push({ name, l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width });
    if (scrollRail && rail.contains(el)) {
      if ((el.id === 'save-status' || el.id === 'checklist-indicator') && r.right > railRect.right + 0.5) problems.push(name + ' is clipped by the tool rail');
      return;
    }
    if (r.left < -0.5 || r.right > window.innerWidth + 0.5) problems.push(name + ' leaves the viewport');
    if (r.right > barRect.right + 0.5 || r.bottom > barRect.bottom + 0.5) problems.push(name + ' is clipped by the bar');
    if (rail.contains(el) && (r.left < railRect.left - 0.5 || r.right > railRect.right + 0.5)) problems.push(name + ' is clipped by the tool rail');
    if (el.scrollWidth > el.clientWidth + 1 && el.id !== 'editor-template-name') problems.push(name + ' text is clipped (' + el.scrollWidth + ' > ' + el.clientWidth + ')');
    if (!el.disabled && el.id !== 'editor-template-name') {
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!(top === el || el.contains(top))) problems.push(name + ' is covered by ' + (top ? (top.id || top.className || top.tagName) : 'nothing'));
    }
  });
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], c = items[j];
      const ox = Math.min(a.r, c.r) - Math.max(a.l, c.l);
      const oy = Math.min(a.b, c.b) - Math.max(a.t, c.t);
      if (ox > 1 && oy > 1) problems.push(a.name + ' overlaps ' + c.name);
    }
  }
  if (!scrollRail) {
    const scrollingRail = getComputedStyle(rail).display !== 'contents' && rail.scrollWidth > rail.clientWidth + 1;
    if (scrollingRail) problems.push('the tool rail needs a horizontal scroll (' + rail.scrollWidth + ' > ' + rail.clientWidth + ')');
    if (rail.classList.contains('tb-scrolls')) problems.push('a fade mask covers the end of the tool rail');
  }
  const pub = document.getElementById('btn-publish').getBoundingClientRect();
  if (!(pub.width > 0 && pub.right <= window.innerWidth + 0.5)) problems.push('Publică is not fully visible');
  const nameEl = document.getElementById('editor-template-name');
  const nameW = nameEl && nameEl.getBoundingClientRect().width;
  if (nameEl && nameEl.getClientRects().length && nameW < 40) problems.push('template name is a ' + Math.round(nameW) + 'px stub');
  if (document.documentElement.scrollWidth > window.innerWidth + 1) problems.push('the page scrolls horizontally');
  return { problems, names: items.map((i) => i.name) };
}

/** Scrolled to its end, a scrolling rail shows its last control whole and unfaded. */
function measureRailEnd() {
  const rail = document.querySelector('.editor-topbar-scroll');
  const problems = [];
  const railRect = rail.getBoundingClientRect();
  const visible = Array.from(rail.children).filter((el) => el.getBoundingClientRect().width > 0);
  const last = visible[visible.length - 1];
  if (last) {
    const r = last.getBoundingClientRect();
    if (r.right > railRect.right + 0.5 || r.left < railRect.left - 0.5) problems.push((last.id || last.className) + ' is clipped at the end of the scrolled rail');
    const mask = getComputedStyle(rail).webkitMaskImage || getComputedStyle(rail).maskImage;
    if (mask && mask !== 'none') problems.push('a fade mask still covers the last control at the end of the rail');
  }
  return problems;
}

async function checkTopbar(browser, { width, touch, signed }) {
  const ctxOpts = { viewport: { width, height: 844 } };
  if (touch) { ctxOpts.hasTouch = true; ctxOpts.isMobile = true; }
  if (signed) ctxOpts.storageState = signedState;
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const tag = [width, touch ? 'touch' : 'mouse', signed ? 'signed' : 'anon'].join('-');
  const failures = [];
  try {
    await startEditor(page);
    // The pill and the checklist are the widest chrome: force the "Salvat" pill on.
    await page.evaluate(() => { setSaveState('saved'); });
    await page.waitForTimeout(500);
    for (const drawer of [false, true]) {
      if (drawer) {
        await page.evaluate(() => document.getElementById('btn-open-drawer').click()).catch(() => {});
        await page.waitForTimeout(450);
      }
      const t = tag + (drawer ? '-detalii-open' : '-detalii-closed');
      const scrollRail = !touch && width <= 640;
      const m = await page.evaluate(measureTopbar, scrollRail);
      await shot(page, 'topbar-' + t);
      m.problems.forEach((p) => failures.push(t + ': ' + p));
      if (scrollRail) {
        await page.evaluate(() => { const r = document.querySelector('.editor-topbar-scroll'); r.scrollLeft = r.scrollWidth; });
        await page.waitForTimeout(250);
        const end = await page.evaluate(measureRailEnd);
        await shot(page, 'rail-scrolled-to-end-' + t);
        await page.evaluate(() => { document.querySelector('.editor-topbar-scroll').scrollLeft = 0; });
        end.forEach((p) => failures.push(t + ': ' + p));
      }
    }
  } finally {
    await context.close();
  }
  return failures;
}

test('editor topbar: no overlap, no clipping, Publică clear of name/toggle, at 320-768px touch and mouse, signed in and not', { timeout: 590000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  try {
    signedState = await signInAndPublishUnpaid(browser);
    for (const width of WIDTHS) {
      for (const touch of [true, false]) {
        for (const signed of [false, true]) {
          failures.push(...await checkTopbar(browser, { width, touch, signed }));
        }
      }
    }
  } finally {
    await browser.close();
  }
  assert.deepEqual(failures, [], 'topbar failures (screenshots in ' + SHOT_DIR + '):\n' + failures.join('\n'));
});

function measureButton(sel) {
  const el = document.querySelector(sel);
  if (!el) return { missing: true };
  const r = el.getBoundingClientRect();
  const problems = [];
  if (!r.width) problems.push('not rendered');
  if (el.scrollWidth > el.clientWidth + 1) problems.push('label clipped: scrollWidth ' + el.scrollWidth + ' > clientWidth ' + el.clientWidth);
  if (r.left < -0.5 || r.right > window.innerWidth + 0.5) problems.push('leaves the viewport');
  const parent = el.parentElement.getBoundingClientRect();
  if (r.left < parent.left - 0.5 || r.right > parent.right + 0.5) problems.push('sticks out of its container');
  if (document.documentElement.scrollWidth > window.innerWidth + 1) problems.push('the page scrolls horizontally');
  return { problems, h: Math.round(r.height) };
}

test('the "Adaugă un card" buttons (success modal and dashboard card) wrap instead of clipping at phone widths', { timeout: 300000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  const failures = [];
  try {
    if (!signedState) signedState = await signInAndPublishUnpaid(browser);
    for (const width of PHONE_WIDTHS) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true, isMobile: true, storageState: signedState });
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      try {
        await startEditor(page);
        await page.evaluate(() => showSuccessScreen('/draft', 'https://checkout.example.test/pay', false));
        await page.locator('#btn-pay-publish').waitFor({ state: 'visible' });
        await page.waitForTimeout(300);
        const m = await page.evaluate(measureButton, '#btn-pay-publish');
        await page.screenshot({ path: path.join(SHOT_DIR, 'pay-modal-' + width + '.png') }).catch(() => {});
        (m.problems || ['missing']).forEach((p) => failures.push('modal ' + width + ': ' + p));

        await page.evaluate(() => { window.location.hash = '#dashboard'; });
        await page.locator('.site-card-actions .btn-primary').first().waitFor({ state: 'visible', timeout: 15000 });
        await page.waitForTimeout(300);
        const d = await page.evaluate(measureButton, '.site-card-actions .btn-primary');
        await page.screenshot({ path: path.join(SHOT_DIR, 'pay-dashboard-card-' + width + '.png') }).catch(() => {});
        (d.problems || ['missing']).forEach((p) => failures.push('dashboard ' + width + ': ' + p));
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  assert.deepEqual(failures, [], 'pay button failures (screenshots in ' + SHOT_DIR + '):\n' + failures.join('\n'));
});
