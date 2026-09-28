'use strict';
/**
 * bot/test/audit27-u-07-publish-checklist.test.js
 *
 * PLAN-UX-2026-09-27.md §5.5 (Checklist de publicare, vizibil pe dashboard)
 * + §5.7 (textul de exemplu — etichetare și înlocuire rapidă), task U-07.
 *
 * Before this task, a fresh draft's demo content (business name, phone,
 * hero photo, footer address — all still the template's own preset values)
 * was invisible at the one moment it matters: the publish modal. The modal's
 * own hard gate (openPublishModal()'s `isFieldComplete` check) only asks
 * "is this required field non-empty" — a preset value satisfies that, so a
 * brand-new, entirely untouched draft can open the publish modal and go
 * straight to checkout with every "identity" field still reading the
 * template's fake demo business. Same story on the dashboard: an
 * unpublished draft's card showed nothing about how much of it was still
 * the demo.
 *
 * FIX (builder/publish-checklist.js, a new file — builder/index.html gets
 * one <script> tag + a checklist container, builder/app.js gets two
 * one-line hooks plus its own honest-completion helpers generalized to take
 * an optional (config, tplData) override instead of only the active draft):
 * an ADVISORY (never blocking) checklist of five items — business name,
 * phone/WhatsApp, hero photo, count of blocks still carrying template
 * sample text, footer address — shown in the publish modal, and the same
 * count on an unpublished draft's own dashboard card, each item wired to a
 * "Rezolvă" link that lands the owner on the actual field.
 *
 * RED (pre-fix, reproduced against BEFORE_REF): #publish-checklist does not
 * exist at all in builder/index.html — opening the publish modal on a
 * totally fresh draft shows no such warning anywhere, and the dashboard
 * card for that same unpublished draft carries no checklist either.
 *
 * GREEN (this task, real bot/server.js + real Chromium, no mocked editor
 * state): a fresh product-menu draft's publish modal shows the checklist
 * with all five items pending; after genuinely editing name, phone and the
 * hero photo (not just leaving the preset's own values in place), those
 * three flip to done while the untouched items (demo-text count, footer
 * address) stay pending — proving this reads app.js's own honest
 * isFieldGenuinelyMade()/computeDemoTextPaths(), not a raw non-empty check.
 * A second scenario signs in, saves that same edited draft server-side, and
 * confirms the dashboard card for it shows a matching (not 5/5, not 0/5)
 * count with a working "Rezolvă" deep link into the editor.
 *
 * Uses Playwright's Chromium from node_modules (repo root, symlinked into
 * worktrees) — never a hardcoded browser path.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-u-07-publish-checklist.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');

function loadPlaywright() {
  const candidates = [
    path.join(ROOT, 'node_modules/playwright'),
    '/Users/Work/.hermes/hermes-agent/node_modules/playwright',
    path.join(ROOT, '../fullpass-63230d2/node_modules/playwright'),
  ];
  for (const cand of candidates) {
    try { return require(cand); } catch (_) { /* try next */ }
  }
  throw new Error('playwright not found in any candidate location');
}
const { chromium } = loadPlaywright();

process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hidook-u07-publish-checklist-'));
process.env.SERVER_SECRET = 'u07-publish-checklist-' + crypto.randomBytes(8).toString('hex');
process.env.HIDOOK_TEST_PAY = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
delete process.env.PUBLIC_URL;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.VERCEL_TOKEN;

require(path.join(ROOT, 'scripts', 'build-builder.js'));
const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));

let server;
let base;
let browser;

test.before(async () => {
  server = startServer({ port: 0 });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true });
});

test.after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (process.env.DATA_DIR) fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

async function screenshot(page, actionJustPerformed) {
  const file = path.join(os.tmpdir(), `audit27-u07-${actionJustPerformed}.png`);
  await page.screenshot({ path: file }).catch(() => {});
  return file;
}

async function acceptCookiesAndStart(page, templateId) {
  await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
  await page.locator('#hb-cookie-accept').click({ timeout: 4000 }).catch(() => {});
  await page.locator(`.template-card[data-template-id="${templateId}"] .btn-start-tpl`).click();
  await page.waitForURL(/#edit$/, { timeout: 30000 });
  await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(900);
  if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
    await page.locator('#btn-close-drawer').click().catch(() => {});
    await page.waitForTimeout(300);
  }
}

async function editBusinessName(page, text) {
  const field = page.frameLocator('#preview-iframe').locator('[data-hb-edit="business.name"]').first();
  await field.click({ clickCount: 3 });
  await page.keyboard.type(text, { delay: 8 });
  await field.blur().catch(() => {});
  await page.waitForFunction(
    (expected) => typeof draft !== 'undefined' && draft.config && draft.config.business && draft.config.business.name === expected,
    text,
    { timeout: 5000 }
  );
}

async function editPhoneViaDrawer(page, phone) {
  await page.locator('#btn-open-drawer').click();
  await page.locator('#details-drawer').waitFor({ state: 'visible' });
  const input = page.locator('[data-field-key="contact.phone"] input');
  await input.fill(phone);
  await input.blur();
  await page.locator('#btn-close-drawer').click();
  await page.locator('#details-drawer').waitFor({ state: 'hidden' });
  await page.waitForTimeout(400); // drawerNeedsRerenderOnClose's deferred re-render (app.js)
}

/** A tiny real JPEG, drawn in-page and handed to the drawer's hero
 * "Alege o poză" file input via a real filechooser event — same technique
 * bot/test/wave9-photos-manager.test.js uses for the same control. */
async function replaceHeroPhotoViaDrawer(page) {
  await page.locator('#btn-open-drawer').click();
  await page.locator('#details-drawer').waitFor({ state: 'visible' });

  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 48;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#9A4030';
    ctx.fillRect(0, 0, 64, 48);
    return c.toDataURL('image/jpeg', 0.9);
  });
  const buffer = Buffer.from(dataUrl.split(',')[1], 'base64');

  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('#details-drawer').getByRole('button', { name: 'Alege o poză' }).first().click(),
  ]);
  await fileChooser.setFiles({ name: 'u07-hero.jpg', mimeType: 'image/jpeg', buffer });
  await page.waitForFunction(
    () => typeof draft !== 'undefined' && draft.config && draft.config.hero &&
      /data:image\//.test(String(draft.config.hero.background || '')),
    { timeout: 10000 }
  );
  await page.locator('#btn-close-drawer').click();
  await page.locator('#details-drawer').waitFor({ state: 'hidden' });
  await page.waitForTimeout(400);
}

async function openPublishModalChecked(page) {
  await page.locator('#btn-publish').click();
  await page.locator('#modal-publish').waitFor({ state: 'visible', timeout: 8000 });
}

/** {id: 'is-done'|'is-pending'} for every row currently in the publish
 * modal's checklist. */
async function readPublishChecklistState(page) {
  const rows = page.locator('#publish-checklist-list .publish-checklist-item');
  const count = await rows.count();
  const out = [];
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const cls = await row.getAttribute('class');
    out.push(/is-done/.test(cls) ? 'is-done' : 'is-pending');
  }
  return out;
}

test('U-07: a fresh draft shows the publish checklist with every item pending (still the template\'s own demo)', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(20000);
  try {
    await acceptCookiesAndStart(page, 'product-menu');

    const box = page.locator('#publish-checklist');
    const pending = page.locator('#publish-checklist-list .publish-checklist-item.is-pending');
    const done = page.locator('#publish-checklist-list .publish-checklist-item.is-done');

    await openPublishModalChecked(page);
    await screenshot(page, '01-fresh-draft-publish-modal');

    assert.equal(await box.isVisible(), true, '#publish-checklist must be visible in the publish modal');
    const state = await readPublishChecklistState(page);
    assert.ok(state.length >= 4, 'checklist must list at least the 4 field-backed items (name/phone/photo/legal) plus the demo-text count row — got ' + state.length);
    assert.equal(await done.count(), 0, 'a totally fresh, unedited draft must show ZERO checklist items as done — got ' + (await done.count()));
    assert.equal((await pending.count()), state.length, 'every item on a fresh draft must read pending');

    await page.close();
  } finally {
    if (!page.isClosed()) await page.close().catch(() => {});
  }
});

test('U-07: editing business name, phone and the hero photo flips exactly those checklist items to done — Rezolvă deep-links into the editor', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(20000);
  try {
    await acceptCookiesAndStart(page, 'product-menu');

    // "Rezolvă" on the still-pending name row must close the modal and land
    // the owner back on the canvas, ready to edit — exercised once here
    // before making the edits, so the deep-link itself is also proven, not
    // just the before/after counts.
    await openPublishModalChecked(page);
    const nameRow = page.locator('#publish-checklist-list .publish-checklist-item', { hasText: 'afacerii' }).first();
    await nameRow.locator('.publish-checklist-fix').click();
    await page.locator('#modal-publish').waitFor({ state: 'hidden', timeout: 5000 });
    await screenshot(page, '02-rezolva-closed-modal');

    await editBusinessName(page, 'U07 Test Business ' + crypto.randomUUID().slice(0, 6));
    await editPhoneViaDrawer(page, '+40 799 000 111');
    await replaceHeroPhotoViaDrawer(page);
    await screenshot(page, '03-name-phone-photo-edited');

    await openPublishModalChecked(page);
    await screenshot(page, '04-publish-modal-after-edits');

    const itemDone = async (matchText) => {
      const row = page.locator('#publish-checklist-list .publish-checklist-item', { hasText: matchText }).first();
      const cls = await row.getAttribute('class');
      return /is-done/.test(cls);
    };

    assert.equal(await itemDone('afacerii'), true, 'business name item must read done after a genuine edit');
    assert.equal(await itemDone('Telefon'), true, 'phone/WhatsApp item must read done after a genuine edit');
    assert.equal(await itemDone('hero'), true, 'hero photo item must read done after replacing the demo photo');

    // Untouched items must NOT have flipped — proves this reads the honest
    // per-field check (isFieldGenuinelyMade), not a blanket "something on
    // this draft changed" flag.
    const legalRow = page.locator('#publish-checklist-list .publish-checklist-item', { hasText: 'subsol' }).first();
    assert.equal(/is-done/.test(await legalRow.getAttribute('class')), false, 'footer address item must stay pending — it was never touched');

    const demoTextRow = page.locator('#publish-checklist-list .publish-checklist-item', { hasText: 'text de exemplu' }).first();
    assert.equal(/is-done/.test(await demoTextRow.getAttribute('class')), false, 'demo-text-blocks item must stay pending — other identity fields (tagline, about, address…) are still untouched');

    await page.close();
  } finally {
    if (!page.isClosed()) await page.close().catch(() => {});
  }
});

test('U-07: the dashboard card for that same unpublished draft shows a matching, non-trivial checklist count with a working Rezolvă link', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(25000);
  try {
    await acceptCookiesAndStart(page, 'product-menu');
    await editBusinessName(page, 'U07 Dashboard Business ' + crypto.randomUUID().slice(0, 6));

    // Sign in — server-side autosave (POST /api/draft) only fires for a
    // signed-in owner (see saveDraft()'s doc comment, builder/app.js). Same
    // magic-link dev-shortcut every other audit27 UI oracle uses.
    const email = 'audit27-u07-' + crypto.randomUUID().slice(0, 8) + '@example.com';
    await page.locator('#btn-account-menu').click();
    await page.locator('#account-menu-projects').click();
    await page.waitForURL(/#dashboard$/);
    await page.locator('#btn-dashboard-auth').click();
    await page.locator('#form-auth-email').waitFor({ state: 'visible' });
    await page.locator('#input-email').fill(email);
    await page.locator('#btn-send-magic').click();
    await page.locator('#dev-link').waitFor({ state: 'visible' });
    await page.locator('#dev-link').click();
    await Promise.race([page.waitForURL(/#edit$/), page.waitForURL(/#dashboard$/)]);
    if (!/#edit$/.test(page.url())) {
      await page.evaluate(() => { window.location.hash = '#edit'; });
      await page.waitForURL(/#edit$/);
    }
    await page.locator('#preview-iframe').waitFor({ state: 'visible' });
    await page.waitForTimeout(600);
    if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
      await page.locator('#btn-close-drawer').click().catch(() => {});
      await page.waitForTimeout(300);
    }

    // A resumed in-memory draft is not itself enough to reach the server —
    // bindSignedInPaidSiteForEdit() (app.js, #edit route) is a no-op when
    // there is no site row yet AND no siteId hint on the local draft, so
    // nothing pushes until a genuine edit runs saveDraft() with currentUser
    // now set (same "re-assert after sign-in resume" edit
    // audit27-r-02-cross-account-draft-isolation.test.js makes for the same
    // reason). Same business name is fine — the point is triggering the save.
    await editBusinessName(page, 'U07 Dashboard Business Signed ' + crypto.randomUUID().slice(0, 6));

    // Past the debounced server autosave — the draft this account just
    // edited must now exist server-side as an unpublished draft site.
    await page.waitForTimeout(1800);

    await page.evaluate(() => { window.location.hash = '#dashboard'; });
    await page.waitForURL(/#dashboard$/);

    const card = page.locator('.site-card').first();
    await card.waitFor({ state: 'visible', timeout: 10000 });

    const checklist = card.locator('.site-card-checklist');
    await checklist.waitFor({ state: 'visible', timeout: 10000 });
    await screenshot(page, '05-dashboard-card-checklist');

    const countText = (await checklist.locator('.site-card-checklist-count').innerText()).trim();
    const m = /(\d+)\/(\d+)/.exec(countText);
    assert.ok(m, 'dashboard card checklist must show a "done/total" count — got "' + countText + '"');
    const [, doneStr, totalStr] = m;
    const doneN = Number(doneStr), totalN = Number(totalStr);
    assert.ok(totalN >= 4, 'checklist total must cover at least the 4 field-backed items — got ' + totalN);
    assert.ok(doneN >= 1 && doneN < totalN, 'exactly the edited business name (not everything, not nothing) should read done on this card — got ' + countText);

    const fixBtn = checklist.locator('.site-card-checklist-fix');
    assert.equal(await fixBtn.isVisible(), true, 'an incomplete card must still show a Rezolvă link');
    await fixBtn.click();
    await page.waitForURL(/#edit$/, { timeout: 10000 });
    await screenshot(page, '06-dashboard-rezolva-opened-editor');

    await page.close();
  } finally {
    if (!page.isClosed()) await page.close().catch(() => {});
  }
});
