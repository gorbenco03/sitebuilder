'use strict';
/**
 * bot/test/drawer-open-focus-steal.test.js
 *
 * Oracle for the "Cal.com race" PLAN-QA-2026-09-12.md §8 left open, now
 * identified: it was never Cal.com-specific and never a render race.
 *
 * openDrawer() (builder/app.js) used to focus the drawer's first field one
 * animation frame AFTER opening, via requestAnimationFrame. Anything that
 * moved focus to another drawer field inside that frame — Playwright's
 * fill()/press() (focus+select in one CDP call, the keystroke in the next),
 * or an owner whose click lands while the main thread is busy re-rendering
 * the preview — lost that focus to the first field a moment later, and the
 * keystrokes went THERE. fullpass saw it as "field empty and config empty
 * right after fill()": the value was not lost, it had been appended to
 * business.title, the site's own <title>. The same window explains the
 * fill-then-clear step (the Delete key landed in the title field, so the
 * phone stayed set and its tel: link "survived" a perfectly good re-render).
 *
 * Fix: openDrawer() focuses synchronously, the way openModal() already does
 * (see the doc comment there for the same reasoning applied to modals) —
 * there is no window left for anything to interleave.
 *
 * Deterministic: the test itself creates the ordering that used to be a
 * matter of luck (open the drawer and move focus in the SAME task, then wait
 * two frames), so it is causally RED against the old openDrawer() on every
 * run — not one in six — and GREEN after the fix.
 *
 * Run: node --experimental-sqlite bot/test/drawer-open-focus-steal.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');

function loadPlaywright() {
  return require(path.join(ROOT, 'node_modules', 'playwright'));
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drawer-open-focus-steal-'));
process.env.DATA_DIR = tmpDir;
process.env.SERVER_SECRET = 'drawer-open-focus-steal-' + crypto.randomBytes(8).toString('hex');
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

const TYPED_PHONE = '+40799112233';

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

/** Open Details and move to the phone field in the SAME task — the ordering
 * that used to lose, deterministically, to openDrawer()'s deferred focus. */
async function openAndFocusPhone(page) {
  const before = await page.evaluate(() => {
    document.getElementById('btn-open-drawer').click();
    const phone = document.getElementById('dr_contact_phone');
    if (!phone) return null;
    phone.focus();
    phone.select();
    return {
      active: document.activeElement && document.activeElement.id,
      firstFieldId: (document.querySelector('#drawer-body input,#drawer-body textarea,#drawer-body select') || {}).id,
      cfgPhone: draft.config.contact.phone,
      cfgTitle: draft.config.business.title,
    };
  });
  assert.ok(before, 'professionals Details has no #dr_contact_phone — the oracle has nothing to type into');
  assert.strictEqual(before.active, 'dr_contact_phone', 'sanity: focus moved to the phone field synchronously');
  assert.notStrictEqual(before.firstFieldId, 'dr_contact_phone',
    'sanity: the phone field must not be the drawer\'s first field, or this test cannot tell a steal from a no-op');
  // Two frames: one for the deferred focus to run, one for its effect to land.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return before;
}

async function runCase(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.setDefaultTimeout(30000);
  try {
    await openTemplateEditor(page, 'professionals');

    await check('opening Details does not move focus off a field the owner already moved to', async () => {
      const before = await openAndFocusPhone(page);
      const active = await page.evaluate(() => document.activeElement && document.activeElement.id);
      assert.strictEqual(active, 'dr_contact_phone',
        'focus was stolen a frame after opening: now on #' + active + ' (the drawer\'s first field is #' +
        before.firstFieldId + ') — keystrokes from here on go to the wrong field');
    });

    // Reset between checks so the second one proves the DATA consequence on
    // its own, regardless of whether the first assertion passed.
    await page.locator('#btn-close-drawer').click().catch(() => {});
    await page.locator('#details-drawer').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);

    await check('what the owner types right after opening Details lands in their field, not in business.title', async () => {
      const before = await openAndFocusPhone(page);
      await page.keyboard.insertText(TYPED_PHONE);
      const after = await page.evaluate(() => ({
        phoneField: document.getElementById('dr_contact_phone').value,
        cfgPhone: draft.config.contact.phone,
        cfgTitle: draft.config.business.title,
      }));
      assert.strictEqual(after.cfgTitle, before.cfgTitle,
        'the typed phone number was appended to business.title (the site\'s <title>): ' + JSON.stringify(after.cfgTitle));
      assert.strictEqual(after.phoneField, TYPED_PHONE, 'phone field did not receive the typed value');
      assert.strictEqual(after.cfgPhone, TYPED_PHONE, 'draft.config.contact.phone did not receive the typed value');
    });
  } finally {
    await page.close();
  }
}

(async function main() {
  execFileSync('node', [path.join(ROOT, 'scripts/build-builder.js')], {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  const { startServer } = require(path.join(ROOT, 'bot/server.js'));
  const server = startServer({ port: 0 });
  await new Promise((resolve) => {
    if (server.listening) return resolve();
    server.once('listening', resolve);
  });
  global.__BASE__ = 'http://127.0.0.1:' + server.address().port;

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  try {
    await runCase(browser);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  if (failed) {
    console.error('\n' + failed + ' check(s) failed');
    process.exit(1);
  }
  console.log('\nOK drawer-open-focus-steal');
})().catch((e) => {
  console.error('FATAL', e.stack || e.message);
  process.exit(1);
});
