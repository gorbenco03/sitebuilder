'use strict';
/**
 * bot/test/wave5-builder-undo-redo.test.js
 *
 * Oracle for Wave 5 undo/redo (audit finding #45, high — "the builder has no
 * undo/redo at all", 04-QA-Evidence/Audit-2026-09-06-2225ca7/RAPORT.md).
 *
 * Every mutation in this editor ends up writing to draft.config and calling
 * saveDraft() (builder/app.js) — including inline canvas text edits, colour
 * changes, photo replacement, list add/remove and the business-name rename
 * cascade (04-QA-Evidence/Audit-2026-09-06-2225ca7/CORECTII.md, PS-01: this
 * is a real structured document, not regex-over-HTML). saveDraft() now also
 * calls pushHistory(), so a plain undo/redo stack of draft.config snapshots
 * covers all of those mutation kinds for free — this oracle drives the real
 * browser through three of them (text, colour, list add) plus both undo entry
 * points: the visible toolbar buttons AND the Ctrl+Z/Ctrl+Shift+Z shortcut,
 * including the tricky case where focus is inside the sandboxed preview
 * iframe's contenteditable canvas (edit-overlay.js has to forward the
 * shortcut to the parent itself, since a keydown never bubbles out of an
 * iframe document).
 *
 * Memory cap (see builder/app.js, HISTORY_MAX_ENTRIES / HISTORY_MAX_BYTES):
 * configs can carry several base64 data: URI photos worth a few MB combined,
 * so the stack is capped at 40 entries AND a combined 15MB of serialized
 * snapshots, whichever limit is hit first, oldest entries evicted first. 40
 * steps is generous for "undo a recent mistake"; 15MB keeps worst-case stack
 * memory in the tens-of-MB range even for a photo-heavy session instead of
 * growing unboundedly with how long the visitor keeps editing.
 *
 * Run: node --experimental-sqlite --test bot/test/wave5-builder-undo-redo.test.js
 * Evidence: 04-QA-Evidence/Wave5-builder/
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = path.join(ROOT, '04-QA-Evidence', 'Wave5-builder');
const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));

test('undo/redo covers text edit, colour change and list add — toolbar buttons + Ctrl+Z', async () => {
  fs.mkdirSync(EVIDENCE, { recursive: true });

  process.env.HIDOOK_TEST_PAY = '1';
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wave5-undo-'));
  process.env.SERVER_SECRET = 'wave5-undo-oracle-secret';
  for (const k of ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'CLOUDFLARE_API_TOKEN', 'VERCEL_TOKEN']) delete process.env[k];

  require(path.join(ROOT, 'scripts/build-builder.js'));
  const { startServer } = require(path.join(ROOT, 'bot/server.js'));
  const { onStripeEvent } = require(path.join(ROOT, 'bot/web.js'));
  const server = startServer({ port: 0, onStripeEvent });
  await new Promise((res, rej) => { server.once('listening', res); server.once('error', rej); });
  const base = 'http://127.0.0.1:' + server.address().port;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30000);

  try {
    await page.goto(base + '/app/', { waitUntil: 'networkidle' });
    await page.locator('#hb-cookie-accept').click().catch(() => {});
    await page.locator('.template-card[data-template-id="local-service"] .btn-start-tpl').click();
    await page.waitForURL(/#edit$/);
    await page.locator('#preview-iframe').waitFor({ state: 'visible' });
    await page.waitForTimeout(1200);
    if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
      await page.locator('#btn-close-drawer').click().catch(() => {});
      await page.waitForTimeout(400);
    }

    const undoBtn = page.locator('#btn-undo');
    const redoBtn = page.locator('#btn-redo');
    const frame = () => page.frameLocator('#preview-iframe');

    // ---- Baseline: nothing to undo/redo on a freshly opened draft ----
    assert.equal(await undoBtn.isDisabled(), true, 'Undo starts disabled on a fresh draft');
    assert.equal(await redoBtn.isDisabled(), true, 'Redo starts disabled on a fresh draft');

    // =====================================================================
    // 1. TEXT EDIT — inline canvas contenteditable, via the toolbar button
    // =====================================================================
    const nameField = () => frame().locator('[data-hb-edit="business.name"]').first();
    const originalName = (await nameField().innerText()).trim();
    assert.ok(originalName.length > 0, 'business.name must have preset text to begin with');

    await nameField().click({ clickCount: 3 }); // select existing text
    await page.keyboard.type('Atelier Nou SRL', { delay: 15 }); // rapid keystrokes — must coalesce into ONE step
    await page.locator('#editor-template-name').click(); // blur the field (outside the iframe)
    await page.waitForTimeout(500);

    assert.equal((await nameField().innerText()).trim(), 'Atelier Nou SRL', 'text edit must land in the canvas');
    assert.equal(await undoBtn.isDisabled(), false, 'Undo must become enabled after a text edit');
    await page.screenshot({ path: path.join(EVIDENCE, '01-text-edit-after.png') });

    await undoBtn.click();
    await page.waitForTimeout(1200); // undo triggers a full re-render (new srcdoc)
    assert.equal(
      (await nameField().innerText()).trim(),
      originalName,
      'ONE undo must fully revert the whole rapid-typing burst (keystrokes coalesce into one step), not just the last keystroke'
    );
    await page.screenshot({ path: path.join(EVIDENCE, '02-text-edit-after-undo.png') });

    await redoBtn.click();
    await page.waitForTimeout(1200);
    assert.equal((await nameField().innerText()).trim(), 'Atelier Nou SRL', 'redo must reapply the text edit');
    await page.screenshot({ path: path.join(EVIDENCE, '03-text-edit-after-redo.png') });

    // ---- Ctrl+Z pressed WHILE focus is still inside the iframe's
    // contenteditable — edit-overlay.js must forward it to the parent
    // (a keydown never bubbles out of an iframe document on its own). ----
    await nameField().click({ clickCount: 3 }); // select all existing text again
    await page.keyboard.type('Interim', { delay: 15 });
    await page.keyboard.press('Control+Z'); // no blur first — proves the cross-iframe forward, not just the parent-level shortcut
    await page.waitForTimeout(1200);
    assert.equal(
      (await nameField().innerText()).trim(),
      'Atelier Nou SRL',
      'Ctrl+Z pressed inside the canvas contenteditable must undo via the app history, not the browser\'s native per-field undo'
    );

    // =====================================================================
    // 2. COLOUR CHANGE — theme accent, via the toolbar button
    // =====================================================================
    await page.locator('#btn-color-picker').click();
    await page.locator('#color-popover').waitFor({ state: 'visible' });
    const hexInput = page.locator('#color-custom-text');
    const originalHex = (await hexInput.inputValue()).trim().toLowerCase();

    const dots = page.locator('#color-presets .color-preset-dot');
    let newHex = originalHex;
    const dotCount = await dots.count();
    for (let i = 0; i < dotCount && newHex === originalHex; i++) {
      await dots.nth(i).click();
      await page.waitForTimeout(150);
      newHex = (await hexInput.inputValue()).trim().toLowerCase();
    }
    assert.notEqual(newHex, originalHex, 'clicking a different colour preset must change theme.primary');
    await page.keyboard.press('Escape'); // closes the popover (existing focus-trap/Escape handling)
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(EVIDENCE, '04-color-change-after.png') });

    await undoBtn.click();
    await page.waitForTimeout(1200);
    await page.locator('#btn-color-picker').click();
    await page.locator('#color-popover').waitFor({ state: 'visible' });
    assert.equal((await hexInput.inputValue()).trim().toLowerCase(), originalHex, 'undo must revert the colour change');
    await page.screenshot({ path: path.join(EVIDENCE, '05-color-change-after-undo.png') });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    await redoBtn.click();
    await page.waitForTimeout(1200);
    await page.locator('#btn-color-picker').click();
    await page.locator('#color-popover').waitFor({ state: 'visible' });
    assert.equal((await hexInput.inputValue()).trim().toLowerCase(), newHex, 'redo must reapply the colour change');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // =====================================================================
    // 3. LIST ADD — "+ Adaugă" on the canvas, via the toolbar button
    // =====================================================================
    const totalEditableNodes = async () => frame().locator('[data-hb-edit]').count();
    const beforeAdd = await totalEditableNodes();

    // local-service ships its OWN list controls (.hb-ls-add) rather than the
    // shared overlay's (.hb-add-btn), because the overlay's safe-list omits
    // some of its lists. Waiting only for the shared class made this test hang
    // for 30s and then fail on every run -- and because it failed constantly,
    // several later waves recorded it as a known flake and stopped reading it.
    // A test that always fails teaches people to ignore it.
    const addBtn = frame().locator('.hb-add-btn, .hb-ls-add').first();
    await addBtn.waitFor({ state: 'visible', timeout: 20000 });
    await addBtn.scrollIntoViewIfNeeded();
    await addBtn.click();
    await page.waitForTimeout(800);
    const afterAdd = await totalEditableNodes();
    assert.ok(afterAdd > beforeAdd, `"+ Adaugă" must add editable nodes (before ${beforeAdd}, after ${afterAdd})`);
    await page.screenshot({ path: path.join(EVIDENCE, '06-list-add-after.png') });

    await undoBtn.click();
    await page.waitForTimeout(1200);
    assert.equal(await totalEditableNodes(), beforeAdd, 'undo must remove the added list item');
    await page.screenshot({ path: path.join(EVIDENCE, '07-list-add-after-undo.png') });

    await redoBtn.click();
    await page.waitForTimeout(1200);
    assert.equal(await totalEditableNodes(), afterAdd, 'redo must reapply the list add');
    await page.screenshot({ path: path.join(EVIDENCE, '08-list-add-after-redo.png') });

    // =====================================================================
    // 4. Disabled-state sanity: undoing all the way back disables Undo, and
    // making a fresh edit after an undo clears the redo branch (Redo disabled).
    // =====================================================================
    await undoBtn.click(); // back to before the list add
    await page.waitForTimeout(1000);
    await undoBtn.click(); // back to before the colour redo — one more step back
    await page.waitForTimeout(1000);
    // Keep undoing until disabled, bounded so a regression can't hang the oracle.
    for (let i = 0; i < 20 && !(await undoBtn.isDisabled()); i++) {
      await undoBtn.click();
      await page.waitForTimeout(400);
    }
    assert.equal(await undoBtn.isDisabled(), true, 'Undo must disable once back at the original baseline');
    assert.equal(await redoBtn.isDisabled(), false, 'Redo must be enabled right after undoing to the baseline');

    await redoBtn.click();
    await page.waitForTimeout(600);
    await nameField().click({ clickCount: 3 });
    await page.keyboard.type('Alt Nume', { delay: 15 });
    await page.locator('#editor-template-name').click();
    await page.waitForTimeout(500);
    assert.equal(await redoBtn.isDisabled(), true, 'a fresh edit after an undo must discard the redo branch');

    console.log('PASS wave5-builder-undo-redo: text edit, colour change, list add all undo/redo correctly');
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
});
