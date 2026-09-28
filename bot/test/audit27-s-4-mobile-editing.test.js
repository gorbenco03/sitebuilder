'use strict';
/**
 * bot/test/audit27-s-4-mobile-editing.test.js — PLAN-UX-2026-09-27 §5.4
 * "Editare mobilă de rang întâi" (task S-4).
 *
 * Three independent gaps, all present on HEAD before this task's changes,
 * driven with a real touch-emulated Chromium at 390x844 (iPhone 12/13
 * class — matching HANDOFF-mobile.md's own investigation width):
 *
 *   1. Tapping an editable heading in the preview canvas gave the
 *      sandboxed iframe's own contenteditable field native keyboard focus
 *      — on a real phone that fights the OS on-screen keyboard inside a
 *      ~360px-wide cross-origin iframe (see HANDOFF-mobile.md's "still
 *      needs a bigger change" section). RED: no #mobile-edit-sheet exists
 *      at all pre-fix; the tap just focuses the canvas field directly.
 *   2. The topbar's tool rail (Instagram/Culoare/Poze/Detalii/downloads) put
 *      every tool in front of a phone thumb at once, seven+ buttons deep.
 *      RED: no #btn-topbar-more exists pre-fix, and Instagram/Culoare/both
 *      downloads render directly in the rail alongside everything else.
 *   3. The Details drawer stayed a `min(400px,94vw)` right-hand panel on
 *      a phone — narrower than a true full-width sheet, and without a
 *      sheet's rounded-top visual identity. RED: pre-fix width is capped
 *      at 94vw, never 100%.
 *
 * GREEN (this task, builder/app.css + builder/edit-overlay.js +
 * builder/app.js, all scoped to `(max-width: 640px) and (pointer: coarse)`
 * — see each file's own PLAN-UX §5.4 comment):
 *   1. The tap opens a bottom sheet (a real top-level <textarea>, not the
 *      iframe's own field) with the field's label, "Gata" and "Anulează".
 *      "Gata" commits through the SAME onInlineTextEdit()/{hb:'set'} path
 *      an ordinary canvas keystroke uses — history, autosave, and (for
 *      business.name) the identity cascade — and both the still-open
 *      editor preview AND the published site show the new text.
 *   2. The rail collapses to Publică/Detalii/Poze/Previzualizare; Instagram,
 *      Culoare and both downloads move behind a "Mai mult" menu that
 *      proxies to those same buttons' own existing click handlers (nothing
 *      duplicated — history/autosave/etc. unchanged, only the path a phone
 *      takes to reach them). wave11-mobile-editor-touch.test.js's own
 *      color-popover test was updated to go through "Mai mult" too, since
 *      #btn-color-picker is one of the buttons this now hides on phones.
 *   3. The drawer becomes a full-width, rounded-top sheet, while staying
 *      below the topbar (`top: var(--topbar-h)`, unchanged from R-06) so
 *      #btn-publish stays reachable while it is open.
 *
 * Desktop/tablet and any fine-pointer (mouse) session at the same 390px
 * width must be completely unaffected — the second test below proves it.
 *
 * Uses Playwright's bundled Chromium from node_modules (never a hardcoded
 * browser path) and boots its own isolated server (HIDOOK_TEST_PAY=1,
 * temp DATA_DIR), same pattern as bot/test/audit27-r-08-preview-editing-
 * fixes.test.js and bot/test/wave11-mobile-editor-touch.test.js.
 * Screenshots go to os.tmpdir(), named after the action just performed.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-s-4-mobile-editing.test.js
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
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hidook-s4-mobile-edit-'));
process.env.SERVER_SECRET = 's4-mobile-edit-' + crypto.randomBytes(8).toString('hex');
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

function screenshot(page, actionJustPerformed) {
  const file = path.join(os.tmpdir(), `audit27-s4-${actionJustPerformed}.png`);
  return page.screenshot({ path: file }).catch(() => {});
}

async function openEditorAtPhoneWidth(page) {
  await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
  await page.locator('#hb-cookie-accept').click({ timeout: 4000 }).catch(() => {});
  await page.goto(base + '/app/#templates', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(300);
  await page.locator('.template-card[data-template-id="professionals"] .btn-start-tpl').click();
  await page.waitForURL(/#edit$/, { timeout: 30000 });
  await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(900);
  // Suite 12: Details no longer auto-opens at phone width — nothing to
  // close here (see wave11-mobile-editor-touch.test.js's own doc comment).
}

test('phone + touch: tapping a canvas heading opens the bottom sheet; Gata updates the editor AND the published site', { timeout: 90000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(40000);
    await openEditorAtPhoneWidth(page);

    const pointerCoarse = await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches);
    assert.equal(pointerCoarse, true, 'test setup must emulate a coarse (touch) pointer at 390px — check hasTouch/isMobile');

    const nameField = page.frameLocator('#preview-iframe').locator('[data-hb-edit="business.name"]').first();
    await nameField.waitFor({ state: 'visible' });
    const originalText = (await nameField.textContent() || '').trim();
    assert.ok(originalText.length > 0, 'business.name must start non-empty for this test to mean anything');

    await nameField.tap();
    await screenshot(page, '01-tapped-heading');

    // RED-old-behavior guard: the tap must NOT hand the iframe field native
    // focus (pre-fix, this is exactly what happened — no sheet exists to
    // open instead).
    const iframeFocusedIsField = await page.frameLocator('#preview-iframe').locator('[data-hb-edit="business.name"]').first()
      .evaluate((el) => document.activeElement === el);
    assert.equal(iframeFocusedIsField, false, 'the canvas field must NOT receive native focus on a coarse-pointer phone tap — that is the on-screen-keyboard fight this task removes');

    const sheet = page.locator('#mobile-edit-sheet');
    await sheet.waitFor({ state: 'visible', timeout: 10000 });
    const label = (await page.locator('#mobile-edit-sheet-label').textContent() || '').trim();
    assert.ok(label.length > 0, 'the sheet must show the field\'s label');

    const input = page.locator('#mobile-edit-sheet-input');
    await input.waitFor({ state: 'visible' });
    const prefilled = await input.inputValue();
    assert.equal(prefilled, originalText, 'the sheet must prefill the textarea with the field\'s current value');
    const inputBox = await input.boundingBox();
    assert.ok(inputBox && inputBox.height >= 44, 'the sheet\'s textarea must be a real, roomy touch target');

    const doneBtn = page.locator('#mobile-edit-sheet-done');
    const cancelBtn = page.locator('#mobile-edit-sheet-cancel');
    const doneBox = await doneBtn.boundingBox();
    const cancelBox = await cancelBtn.boundingBox();
    assert.ok(doneBox && doneBox.width >= 44 && doneBox.height >= 44, '"Gata" must be >=44x44px, got ' + JSON.stringify(doneBox));
    assert.ok(cancelBox && cancelBox.width >= 44 && cancelBox.height >= 44, '"Anulează" must be >=44x44px, got ' + JSON.stringify(cancelBox));

    const newName = 'Salon Nou ' + Date.now().toString(36);
    await input.fill(newName);
    await doneBtn.tap();
    await screenshot(page, '02-tapped-gata');

    await sheet.waitFor({ state: 'hidden', timeout: 10000 });

    // The still-open editor preview reflects the new text immediately
    // (VISION.md §4.5: preview reflects text).
    await page.waitForTimeout(300);
    const canvasNow = (await nameField.textContent() || '').trim();
    assert.equal(canvasNow, newName, 'the canvas field must show the new text once the sheet commits');

    // Same path a real keystroke uses (history/autosave/business.name
    // cascade): undo must be enabled now.
    const undoDisabled = await page.locator('#btn-undo').isDisabled();
    assert.equal(undoDisabled, false, '"Gata" must push a real history step — #btn-undo must enable');

    // Publish and confirm the LIVE page shows the new text too.
    await page.locator('#btn-publish').tap();
    await page.locator('#modal-publish').waitFor({ state: 'visible' });
    const slug = 'audit27-s4-mobile-' + Date.now().toString(36);
    await page.locator('#input-slug').fill(slug);
    await page.locator('#btn-publish-continue').tap();
    await page.locator('#form-auth-email').waitFor({ state: 'visible' });
    await page.locator('#input-email').fill('audit27-s4-mobile@example.com');
    await page.locator('#btn-send-magic').tap();
    await page.locator('#dev-link').waitFor({ state: 'visible' });
    await page.locator('#dev-link').tap();
    await page.locator('#btn-pay-publish').waitFor({ state: 'visible' });
    await page.locator('#btn-pay-publish').tap();
    await page.locator('#modal-success-title').waitFor({ state: 'visible', timeout: 25000 });
    await screenshot(page, '03-published-with-new-name');

    let liveResp;
    let liveHtml = '';
    for (let attempt = 0; attempt < 10; attempt++) {
      liveResp = await page.request.get(base + '/live/' + slug + '/');
      if (liveResp.status() === 200) { liveHtml = await liveResp.text(); break; }
      await page.waitForTimeout(300);
    }
    assert.equal(liveResp.status(), 200, 'the published page must be reachable');
    assert.ok(liveHtml.includes(newName), 'the published live HTML must contain the name set through the mobile sheet');

    await page.close();
    await context.close();
  } finally {
    await browser.close();
  }
});

test('phone + touch: toolbar shows the primary actions plus a working "Mai mult" menu, all targets >=44px', { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(40000);
    await openEditorAtPhoneWidth(page);

    // Primary actions stay directly reachable, no menu needed.
    const primaries = ['btn-publish', 'btn-open-drawer', 'btn-open-gallery', 'btn-preview-desktop', 'btn-preview-mobile'];
    for (const id of primaries) {
      const box = await page.locator('#' + id).boundingBox();
      assert.ok(box, '#' + id + ' must be visible as a primary action');
      assert.ok(box.width >= 44 && box.height >= 44, '#' + id + ' must be >=44x44px, got ' + JSON.stringify(box));
    }

    // The actual collapse: these must NOT be independently visible/tappable
    // in the rail any more — reaching them now goes through "Mai mult"
    // only. This is the criterion the previous round shipped as a no-op
    // (menu added, nothing removed, rail still 8 buttons deep) — assert it
    // for real this time.
    const secondaries = ['btn-add-instagram', 'btn-color-picker', 'btn-download-html', 'btn-download-zip'];
    for (const id of secondaries) {
      const visible = await page.locator('#' + id).isVisible().catch(() => false);
      assert.equal(visible, false, '#' + id + ' must be hidden from the rail on a coarse-pointer phone — it belongs behind "Mai mult" now');
    }

    const moreBtn = page.locator('#btn-topbar-more');
    await moreBtn.waitFor({ state: 'visible', timeout: 4000 });
    const moreBox = await moreBtn.boundingBox();
    assert.ok(moreBox && moreBox.width >= 44 && moreBox.height >= 44, '"Mai mult" must be >=44x44px, got ' + JSON.stringify(moreBox));

    await moreBtn.tap();
    await screenshot(page, '04-mai-mult-open');
    const menu = page.locator('#topbar-more-menu');
    await menu.waitFor({ state: 'visible', timeout: 4000 });
    const items = page.locator('.topbar-more-menu-item');
    const itemCount = await items.count();
    assert.ok(itemCount >= 4, '"Mai mult" must list Instagram, Culoare temă and both downloads, got ' + itemCount + ' items');
    for (let i = 0; i < itemCount; i++) {
      const box = await items.nth(i).boundingBox();
      assert.ok(box && box.height >= 44, 'Mai mult item ' + i + ' must be >=44px tall, got ' + JSON.stringify(box));
    }

    // Tapping an item proxies to the real, still-existing topbar button's
    // own click handler — the Instagram modal opens exactly as it did
    // before this button was moved out of the always-visible rail.
    await page.getByRole('menuitem', { name: 'Adaugă Instagram' }).tap();
    await page.locator('#modal-instagram').waitFor({ state: 'visible', timeout: 4000 });
    assert.equal(await menu.isVisible(), false, 'the Mai mult menu must close once an item is chosen');

    // Culoare temă proxies too, and its popover must land fully on-screen
    // even though #btn-color-picker itself is hidden (0x0 rect) — the
    // popover positioning must fall back to a visible anchor.
    await page.locator('#btn-close-instagram').click();
    await page.locator('#modal-instagram').waitFor({ state: 'hidden', timeout: 4000 });
    await moreBtn.tap();
    await menu.waitFor({ state: 'visible', timeout: 4000 });
    await page.getByRole('menuitem', { name: 'Culoare temă' }).tap();
    const popover = page.locator('#color-popover');
    await popover.waitFor({ state: 'visible', timeout: 4000 });
    const popBox = await popover.boundingBox();
    assert.ok(popBox && popBox.x >= 0 && popBox.x + popBox.width <= 390, 'color popover must stay on-screen when opened via Mai mult, got ' + JSON.stringify(popBox));

    await page.close();
    await context.close();
  } finally {
    await browser.close();
  }
});

test('phone + touch: the Details drawer is a full-width sheet, and Publică stays reachable while it is open', { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(40000);
    await openEditorAtPhoneWidth(page);

    await page.locator('#btn-open-drawer').tap();
    const drawer = page.locator('#details-drawer');
    await drawer.waitFor({ state: 'visible', timeout: 4000 });
    await screenshot(page, '05-drawer-open-phone-touch');

    const drawerBox = await drawer.boundingBox();
    assert.ok(drawerBox, '#details-drawer must have a visible box');
    assert.ok(
      drawerBox.width >= 388,
      'the drawer must be a full-width sheet on a coarse-pointer phone (390px), got width=' + drawerBox.width
    );

    // R-06 must still hold: the topbar (and Publică inside it) sits ABOVE
    // the sheet's own top edge, never covered by it.
    const topbarBox = await page.locator('.editor-topbar').boundingBox();
    assert.ok(topbarBox, '.editor-topbar must have a visible box');
    assert.ok(
      drawerBox.y >= topbarBox.y + topbarBox.height - 1,
      'the drawer sheet must start at or below the topbar, never covering it — topbar bottom=' +
        (topbarBox.y + topbarBox.height) + ' vs drawer top=' + drawerBox.y
    );

    const publishBtn = page.locator('#btn-publish');
    const pubBox = await publishBtn.boundingBox();
    assert.ok(pubBox, '#btn-publish must still have a visible box while the drawer sheet is open');
    const hitId = await page.evaluate(([px, py]) => {
      const el = document.elementFromPoint(px, py);
      return el ? (el.id || el.closest('button')?.id || el.className || el.tagName) : null;
    }, [pubBox.x + pubBox.width / 2, pubBox.y + pubBox.height / 2]);
    assert.ok(
      String(hitId).includes('btn-publish'),
      'a real tap on Publică\'s own coordinates must still hit Publică while the drawer sheet is open, not the sheet/backdrop — got: ' + hitId
    );

    await page.close();
    await context.close();
  } finally {
    await browser.close();
  }
});

test('mouse-driven desktop/laptop at the same 390px width is completely unaffected (no sheet, no Mai mult, old drawer width)', { timeout: 60000 }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    // No hasTouch/isMobile: a real mouse-driven browser window resized to
    // 390px wide — the case every change in this task must NOT touch.
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(40000);
    await openEditorAtPhoneWidth(page);

    const pointerCoarse = await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches);
    assert.equal(pointerCoarse, false, 'test setup must emulate a fine (mouse) pointer here — check no hasTouch/isMobile leaked in');

    const nameField = page.frameLocator('#preview-iframe').locator('[data-hb-edit="business.name"]').first();
    await nameField.waitFor({ state: 'visible' });
    await nameField.click();
    await page.waitForTimeout(200);

    const sheetVisible = await page.locator('#mobile-edit-sheet').isVisible().catch(() => false);
    assert.equal(sheetVisible, false, 'a mouse click at 390px must NOT open the mobile bottom sheet');
    const focusedIsField = await page.frameLocator('#preview-iframe').locator('[data-hb-edit="business.name"]').first()
      .evaluate((el) => document.activeElement === el);
    assert.equal(focusedIsField, true, 'a mouse click must still focus the canvas field directly, exactly as before this task');

    const moreVisible = await page.locator('#btn-topbar-more').isVisible().catch(() => false);
    assert.equal(moreVisible, false, '"Mai mult" must not appear for a mouse-driven session, even at phone width');

    await page.locator('#btn-open-drawer').click();
    const drawer = page.locator('#details-drawer');
    await drawer.waitFor({ state: 'visible' });
    const drawerBox = await drawer.boundingBox();
    assert.ok(drawerBox.width < 388, 'a mouse session must keep the existing min(400px,94vw) drawer width, got ' + drawerBox.width);

    await page.close();
  } finally {
    await browser.close();
  }
});
