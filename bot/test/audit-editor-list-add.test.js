'use strict';
/**
 * bot/test/audit-editor-list-add.test.js
 *
 * Oracle for the audit-2026-09-06 "+ Adaugă" repeatable-list defect, reported
 * on three templates and traced to a single root cause in
 * builder/edit-overlay.js:
 *
 *   - PM-02 [critical, product-menu]  "+ Adaugă" on Specialități creates a
 *     completely empty, unclickable, undeletable card that ships to the live
 *     published site.
 *   - prof-01 [high, professionals]   "+ Adaugă" on Servicii creates a card
 *     with no text at all.
 *   - prof-02 [high, professionals]   after "+ Adaugă", the button itself
 *     gets grafted INSIDE the newly created <li> instead of staying a sibling
 *     of the list.
 *
 * Root cause: findListItemContainer() in edit-overlay.js picked the FIRST DOM
 * ancestor that happened to contain every data-hb-edit field of an item. For
 * an item with a single text field, that is the field's own immediate visual
 * wrapper (e.g. a bare inline <span>), not the repeated "card" element the
 * list is built from. When that wrapper's text is empty it can collapse to a
 * 0x0 box (the remove "×" button becomes unclickable — PM-02), and inserting
 * "+ Adaugă" as `container.nextSibling` plants it INSIDE the card rather than
 * after it in the list (prof-02). Separately, app.js's onListAdd seeds new
 * items with empty strings for every itemShape field, so the card renders
 * with literally no text at all (prof-01).
 *
 * This oracle exercises the exact repro steps from the audit brief across all
 * three affected templates (product-menu, professionals, portfolio — the
 * third demonstrates the identical structural bug on its own "services" list)
 * and asserts, per template:
 *   1. clicking "+ Adaugă" adds exactly one new item;
 *   2. the new item's visible text is non-empty and NOT a generic factory
 *      placeholder ("New item" / "Element nou" are explicitly rejected);
 *   3. the new item's remove ("×") button has a non-zero, clickable bounding
 *      box;
 *   4. the "+ Adaugă" button remains a sibling of the list items — never a
 *      descendant of any .hb-list-item;
 *   5. the new item can be edited (typed text sticks) and then removed,
 *      restoring the original count.
 *
 * Causal RED before the edit-overlay.js fix (verify with `git stash`), GREEN
 * after.
 *
 * Run: node bot/test/audit-editor-list-add.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const PW_PATH = '/Users/Work/.hermes/hermes-agent/node_modules/playwright';
const BRAVE = (process.env.HIDOOK_BROWSER_PATH || '')  // opt-in only: these oracles ship
    // pinned to Playwright's Chromium so they are portable and CI-runnable.
    // Brave 150 renders the preview cookie banner at 0x0 on the second template
    // opened in a session, which made these specs fail on this machine only.;

// Forbidden, "factory" placeholder text the product oracle must never see on
// a freshly created list item — the whole point of this fix is that new
// items get sensible, vertical-appropriate Romanian text instead of this.
const FORBIDDEN_PLACEHOLDER = /^(new item|new section|element nou|item nou)$/i;

function loadPlaywright() {
  const candidates = [
    path.join(ROOT, 'node_modules/playwright'),
    PW_PATH,
    path.join(ROOT, '../fullpass-63230d2/node_modules/playwright'),
  ];
  for (const cand of candidates) {
    try {
      return require(cand);
    } catch (_) {}
  }
  throw new Error('playwright not found');
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-list-add-'));
process.env.DATA_DIR = tmpDir;
process.env.SERVER_SECRET = 'audit-list-add-' + crypto.randomBytes(8).toString('hex');
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

// Per-template case: how to reach the affected repeatable list and what a
// sane new item should look like once the fix is in place.
const CASES = [
  {
    templateId: 'product-menu',
    label: 'product-menu (PM-02: Specialități)',
    listSelector: '.pm-tickets',
    itemSelector: '.pm-tickets > .service-card',
  },
  {
    templateId: 'professionals',
    label: 'professionals (prof-01/prof-02: Servicii)',
    listSelector: '.pr-svc',
    itemSelector: '.pr-svc > .pr-svc__card',
  },
  {
    templateId: 'portfolio',
    label: 'portfolio (same structural bug on Servicii)',
    listSelector: '.pf-chips',
    itemSelector: '.pf-chips > .pf-chip',
  },
];

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

async function runCase(page, kase) {
  const frame = page.frameLocator('#preview-iframe');
  await frame.locator(kase.listSelector).first().waitFor({ state: 'attached', timeout: 20000 });

  // Descendant (not direct-child) selector: before the fix, the "+ Adaugă"
  // button can be mis-nested one level deeper (grafted inside the last item)
  // — we still need to find and click it to exercise the bug.
  const addBtnLocator = frame.locator(kase.listSelector + ' .hb-add-btn').first();
  await addBtnLocator.waitFor({ state: 'attached', timeout: 20000 });

  const beforeCount = await frame.locator(kase.itemSelector).count();
  assert.ok(beforeCount >= 1, kase.label + ': expected at least one pre-existing item');

  // 1) Click "+ Adaugă" like a real user would.
  await addBtnLocator.scrollIntoViewIfNeeded();
  await addBtnLocator.click({ timeout: 10000 });
  await page.waitForTimeout(700);

  const afterCount = await frame.locator(kase.itemSelector).count();
  assert.strictEqual(afterCount, beforeCount + 1, kase.label + ': "+ Adaugă" must add exactly one item');

  // Inspect the new item + button placement in one DOM pass inside the iframe.
  const iframeHandle = await page.$('#preview-iframe');
  const iframeCtx = await iframeHandle.contentFrame();
  const info = await iframeCtx.evaluate(
    ({ listSelector, itemSelector }) => {
      const items = Array.from(document.querySelectorAll(itemSelector));
      const last = items[items.length - 1];
      const list = document.querySelector(listSelector);
      const addBtn = list ? list.querySelector('.hb-add-btn') : null;
      const textFields = last
        ? Array.from(last.querySelectorAll('[data-hb-edit][data-hb-kind="text"]'))
        : [];
      const removeBtn = last ? last.querySelector('.hb-remove-btn') : null;
      const removeRect = removeBtn ? removeBtn.getBoundingClientRect() : null;
      return {
        lastText: textFields.map((el) => el.textContent),
        lastPaths: textFields.map((el) => el.getAttribute('data-hb-edit')),
        addBtnInsideListItem: !!(addBtn && addBtn.closest('.hb-list-item')),
        addBtnIsSiblingOfLast: !!(addBtn && last && addBtn.parentElement === last.parentElement),
        removeRect: removeRect ? { w: removeRect.width, h: removeRect.height } : null,
      };
    },
    { listSelector: kase.listSelector, itemSelector: kase.itemSelector }
  );

  // 2) New item must have real, non-empty, non-generic text.
  assert.ok(info.lastText.length > 0, kase.label + ': new item has no data-hb-edit text fields at all');
  const mainText = (info.lastText[0] || '').trim();
  assert.ok(mainText.length > 0, kase.label + ': new item text must not be empty — got "' + mainText + '"');
  assert.ok(
    !FORBIDDEN_PLACEHOLDER.test(mainText),
    kase.label + ': new item text must not be a generic factory placeholder — got "' + mainText + '"'
  );

  // 3) Remove button must be a real, clickable box (not collapsed to 0x0).
  assert.ok(info.removeRect, kase.label + ': new item has no remove button');
  assert.ok(
    info.removeRect.w > 0 && info.removeRect.h > 0,
    kase.label + ': remove button has a zero-size box (' + JSON.stringify(info.removeRect) + ') — unclickable'
  );

  // 4) "+ Adaugă" must stay OUTSIDE any wrapped list item, as a sibling of
  //    the list's items — never grafted inside the newly created card.
  assert.ok(!info.addBtnInsideListItem, kase.label + ': "+ Adaugă" button ended up nested inside a .hb-list-item');
  assert.ok(info.addBtnIsSiblingOfLast, kase.label + ': "+ Adaugă" button must be a sibling of the last item');

  // 5a) The new item must be genuinely editable: type custom text, blur, and
  //     confirm it sticks (overwrites the default placeholder).
  const customText = 'QA ' + kase.templateId + ' ' + Date.now();
  const lastFieldLocator = frame.locator(kase.itemSelector).last().locator('[data-hb-edit][data-hb-kind="text"]').first();
  await lastFieldLocator.click();
  await page.keyboard.press('Control+A').catch(() => {});
  await page.keyboard.press('Meta+A').catch(() => {});
  await page.keyboard.type(customText);
  await lastFieldLocator.blur();
  await page.waitForTimeout(300);
  const editedText = (await lastFieldLocator.textContent() || '').trim();
  assert.ok(editedText.length > 0, kase.label + ': edited item must not read back empty');
  assert.ok(editedText.indexOf('QA ' + kase.templateId) === 0, kase.label + ': typed text must be reflected — got "' + editedText + '"');

  // 5b) The new item must be deletable, restoring the original count.
  const lastRemoveBtn = frame.locator(kase.itemSelector).last().locator('.hb-remove-btn');
  await lastRemoveBtn.click({ timeout: 10000, force: true });
  await page.waitForTimeout(700);
  const finalCount = await frame.locator(kase.itemSelector).count();
  assert.strictEqual(finalCount, beforeCount, kase.label + ': removing the new item must restore the original count');
}

(async function main() {
  execFileSync('node', [path.join(ROOT, 'scripts/build-builder.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  const { startServer } = require('../server.js');
  const server = startServer({ port: 0 });
  await new Promise((resolve) => {
    if (server.listening) return resolve();
    server.once('listening', resolve);
  });
  const port = server.address().port;
  global.__BASE__ = 'http://127.0.0.1:' + port;

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({
    headless: true,
    executablePath: fs.existsSync(BRAVE) ? BRAVE : undefined,
  });

  try {
    for (const kase of CASES) {
      await check(kase.label + ': "+ Adaugă" adds a well-formed, editable, deletable item', async () => {
        const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
        page.setDefaultTimeout(30000);
        try {
          await openTemplateEditor(page, kase.templateId);
          await runCase(page, kase);
        } finally {
          await page.close();
        }
      });
    }
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  if (failed) {
    console.error('\n' + failed + ' check(s) failed');
    process.exit(1);
  }
  console.log('\nOK audit-editor-list-add');
})().catch((e) => {
  console.error('FATAL', e.stack || e.message);
  process.exit(1);
});
