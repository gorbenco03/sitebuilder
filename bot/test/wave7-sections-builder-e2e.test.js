'use strict';
/**
 * bot/test/wave7-sections-builder-e2e.test.js
 *
 * Wave 7 (audit finding #44, RAPORT.md — "no add/remove/reorder of
 * SECTIONS") end-to-end oracle: drives the real builder UI (professionals
 * template) through the new "Secțiuni pagină" panel — move a section,
 * remove a section, add it back — all via keyboard-operable <button>
 * elements (no drag required), then publishes the site and confirms the
 * LIVE page reflects the same order/visibility. Same mutation path as every
 * other edit in this editor: draft.config write → saveDraft() (the single
 * choke point undo/redo also hooks), so undo is also exercised here.
 *
 * Run: node --experimental-sqlite --test bot/test/wave7-sections-builder-e2e.test.js
 * Evidence: 04-QA-Evidence/Wave7-sections/
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = path.join(ROOT, '04-QA-Evidence', 'Wave7-sections');
const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));

test('Secțiuni pagină: move, remove, add back, undo, then publish and verify the live site', async () => {
  fs.mkdirSync(EVIDENCE, { recursive: true });

  process.env.HIDOOK_TEST_PAY = '1';
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wave7-sections-'));
  process.env.SERVER_SECRET = 'wave7-sections-oracle-secret';
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
  const frame = () => page.frameLocator('#preview-iframe');
  const mainSectionIds = async () =>
    frame().locator('main section[id]').evaluateAll((nodes) => nodes.map((n) => n.id));

  let livePage = null;
  try {
    await page.goto(base + '/app/', { waitUntil: 'networkidle' });
    await page.locator('#hb-cookie-accept').click().catch(() => {});
    await page.locator('.template-card[data-template-id="professionals"] .btn-start-tpl').click();
    await page.waitForURL(/#edit$/);
    await page.locator('#preview-iframe').waitFor({ state: 'visible' });
    await page.waitForTimeout(1200);

    // ---- Baseline order, per templates/professionals/template.html ----
    assert.deepEqual(
      await mainSectionIds(),
      ['services', 'process', 'about', 'appointment', 'faq', 'contact'],
      'professionals template order before any section edit'
    );

    if (!(await page.locator('#details-drawer').isVisible().catch(() => false))) {
      await page.locator('#btn-open-drawer').click();
    }
    await page.locator('#details-drawer').waitFor({ state: 'visible' });

    const secRow = (label) => page.locator('.hb-secrow', { hasText: label });
    const secRemoveBtn = (label) => secRow(label).locator('button', { hasText: /^Elimină$/ });
    const secAddBtn = (label) => secRow(label).locator('button', { hasText: /^Adaugă$/ });
    const secUpBtn = (label) => secRow(label).locator('button[aria-label*="mai sus"]');

    await page.locator('.hb-secrow', { hasText: 'Cum lucrezi' }).waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(EVIDENCE, '01-sections-panel-baseline.png') });

    const undoBtn = page.locator('#btn-undo');
    assert.equal(await undoBtn.isDisabled(), true, 'Undo starts disabled on a fresh draft');

    // =====================================================================
    // 1. REMOVE — "Cum lucrezi" (process, removable) via its Elimină button
    // =====================================================================
    await secRemoveBtn('Cum lucrezi').click();
    await page.waitForTimeout(1000);
    assert.ok(!(await mainSectionIds()).includes('process'), 'process section must disappear from the live preview');
    assert.equal(await undoBtn.isDisabled(), false, 'removing a section must be undoable');
    await page.screenshot({ path: path.join(EVIDENCE, '02-section-removed.png') });

    // Undo must bring it straight back — same choke point as every other edit.
    // The drawer overlay is modal (blocks the rest of the toolbar), so close
    // it first — exactly what a real user has to do to reach Undo too.
    await page.locator('#btn-close-drawer').click();
    await page.locator('#details-drawer').waitFor({ state: 'hidden' });
    await undoBtn.click();
    await page.waitForTimeout(1200);
    assert.ok((await mainSectionIds()).includes('process'), 'undo must restore the removed section');
    await page.screenshot({ path: path.join(EVIDENCE, '03-section-removed-undone.png') });

    await page.locator('#btn-open-drawer').click();
    await page.locator('#details-drawer').waitFor({ state: 'visible' });

    // Remove it again for the rest of this scenario.
    await secRemoveBtn('Cum lucrezi').click();
    await page.waitForTimeout(1000);
    assert.ok(!(await mainSectionIds()).includes('process'));

    // =====================================================================
    // 2. ADD BACK — the removed row now shows "Adaugă" instead of "Elimină"
    // =====================================================================
    await secAddBtn('Cum lucrezi').click();
    await page.waitForTimeout(1000);
    assert.ok((await mainSectionIds()).includes('process'), 'Adaugă must bring the section back into the rendered page');
    await page.screenshot({ path: path.join(EVIDENCE, '04-section-added-back.png') });

    // =====================================================================
    // 3. MOVE — "Întrebări frecvente" (faq) to the very top, via keyboard-
    // operable move-up buttons only (no drag gesture used anywhere here).
    // =====================================================================
    const faqUp = secUpBtn('Întrebări frecvente');
    for (let i = 0; i < 5 && (await mainSectionIds())[0] !== 'faq'; i++) {
      await faqUp.click();
      await page.waitForTimeout(700);
    }
    const reordered = await mainSectionIds();
    assert.equal(reordered[0], 'faq', 'faq must now render first');
    await page.screenshot({ path: path.join(EVIDENCE, '05-section-moved.png') });

    // Guardrail check while we're here: "Contact" and "Despre / credențiale"
    // are non-removable — the panel must not even offer an Elimină button.
    assert.equal(await secRemoveBtn('Contact și locație').count(), 0, 'Contact must have no remove control');
    assert.equal(await secRemoveBtn('Despre / credențiale').count(), 0, 'About must have no remove control');

    // Final state for publish: faq first, process removed.
    await secRemoveBtn('Cum lucrezi').click();
    await page.waitForTimeout(1000);
    const finalIds = await mainSectionIds();
    assert.deepEqual(finalIds, ['faq', 'services', 'about', 'appointment', 'contact'], 'final layout before publish');
    await page.screenshot({ path: path.join(EVIDENCE, '06-final-layout-before-publish.png') });

    // =====================================================================
    // 4. PUBLISH — the live site must show the exact same order/visibility.
    // =====================================================================
    await page.locator('#btn-close-drawer').click().catch(() => {});
    await page.locator('#btn-publish').click();
    await page.locator('#modal-publish').waitFor({ state: 'visible' });

    const runSlug = 'wave7-sections-' + crypto.randomBytes(4).toString('hex');
    await page.locator('#input-slug').fill(runSlug);
    await page.locator('#btn-publish-continue').click();
    await page.locator('#form-auth-email').waitFor({ state: 'visible' });

    await page.locator('#input-email').fill('wave7-sections@example.com');
    await page.locator('#btn-send-magic').click();
    await page.locator('#dev-link').waitFor({ state: 'visible' });
    await page.locator('#dev-link').click();
    await page.locator('#modal-success').waitFor({ state: 'visible' });
    await page.locator('#btn-pay-publish').waitFor({ state: 'visible' });
    await page.locator('#btn-pay-publish').click();
    await page
      .locator('#modal-success-title')
      .filter({ hasText: 'Site-ul tău e live' })
      .waitFor({ state: 'visible', timeout: 20000 });

    const opened = page.context().waitForEvent('page');
    await page.locator('#success-url-link').click();
    livePage = await opened;
    await livePage.waitForLoadState('networkidle');

    const liveIds = await livePage.locator('main section[id]').evaluateAll((nodes) => nodes.map((n) => n.id));
    assert.deepEqual(liveIds, finalIds, 'the LIVE published site must show the exact section order/visibility set in the editor');
    await livePage.screenshot({ path: path.join(EVIDENCE, '07-live-site-new-order.png'), fullPage: true });

    console.log('PASS wave7-sections-builder-e2e: move/remove/add-back/undo in the editor, verified on the live site');
  } finally {
    if (livePage) await livePage.close().catch(() => {});
    await browser.close();
    await new Promise((r) => server.close(r));
  }
});
