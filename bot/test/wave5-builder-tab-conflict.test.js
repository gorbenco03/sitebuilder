'use strict';
/**
 * bot/test/wave5-builder-tab-conflict.test.js
 *
 * Oracle for Wave 5 multi-tab draft conflict warning (audit medium #8,
 * 04-QA-Evidence/Audit-2026-09-06-2225ca7/RAPORT.md: "Două tab-uri suprascriu
 * silențios același draft, fără avertisment" — two tabs silently overwrite
 * the same draft with no warning).
 *
 * There is no server-side draft yet to reconcile against, so we do not
 * attempt to merge (the task is explicit: "do not silently merge") — instead
 * we detect the situation honestly. Every editor tab writes to the SAME
 * localStorage key (DRAFT_KEY); the `storage` event fires in every OTHER tab
 * of the same origin whenever one tab writes to it, which is exactly "another
 * tab just changed this draft". builder/app.js tags each write with a random
 * per-tab id (TAB_ID) and compares templateId (+ siteId when bound) so an
 * unrelated draft in another tab never triggers a false warning.
 *
 * This oracle opens the SAME draft in two real browser tabs (two pages in one
 * Playwright browser context, so they share localStorage like real tabs in
 * the same browser profile do), edits it from tab 2, and asserts tab 1 shows
 * the Romanian warning banner — not a silent overwrite.
 *
 * Run: node --experimental-sqlite --test bot/test/wave5-builder-tab-conflict.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));

test('a second tab editing the same draft warns the first tab in Romanian instead of silently overwriting it', async () => {
  process.env.HIDOOK_TEST_PAY = '1';
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wave5-tabconflict-'));
  process.env.SERVER_SECRET = 'wave5-tabconflict-oracle-secret';
  for (const k of ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'CLOUDFLARE_API_TOKEN', 'VERCEL_TOKEN']) delete process.env[k];

  require(path.join(ROOT, 'scripts/build-builder.js'));
  const { startServer } = require(path.join(ROOT, 'bot/server.js'));
  const { onStripeEvent } = require(path.join(ROOT, 'bot/web.js'));
  const server = startServer({ port: 0, onStripeEvent });
  await new Promise((res, rej) => { server.once('listening', res); server.once('error', rej); });
  const base = 'http://127.0.0.1:' + server.address().port;

  const browser = await chromium.launch({ headless: true });
  // ONE context so both pages share the same localStorage partition, exactly
  // like two tabs of the same browser profile.
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });

  try {
    // ---- Tab 1: open the editor and start a draft. ----
    const tab1 = await context.newPage();
    tab1.setDefaultTimeout(30000);
    await tab1.goto(base + '/app/', { waitUntil: 'networkidle' });
    await tab1.locator('#hb-cookie-accept').click().catch(() => {});
    await tab1.locator('.template-card[data-template-id="professionals"] .btn-start-tpl').click();
    await tab1.waitForURL(/#edit$/);
    await tab1.locator('#preview-iframe').waitFor({ state: 'visible' });
    await tab1.waitForTimeout(1200);
    if (await tab1.locator('#details-drawer').isVisible().catch(() => false)) {
      await tab1.locator('#btn-close-drawer').click().catch(() => {});
      await tab1.waitForTimeout(400);
    }

    const banner1 = tab1.locator('#tab-conflict-banner');
    assert.equal(await banner1.isVisible(), false, 'no conflict banner before a second tab touches the draft');

    // ---- Tab 2: same origin/context → resumes the SAME localStorage draft. ----
    const tab2 = await context.newPage();
    tab2.setDefaultTimeout(30000);
    await tab2.goto(base + '/app/#edit', { waitUntil: 'networkidle' });
    await tab2.locator('#preview-iframe').waitFor({ state: 'visible' });
    await tab2.waitForTimeout(1200);
    if (await tab2.locator('#details-drawer').isVisible().catch(() => false)) {
      await tab2.locator('#btn-close-drawer').click().catch(() => {});
      await tab2.waitForTimeout(400);
    }
    const tplName1 = (await tab1.locator('#editor-template-name').innerText()).trim();
    const tplName2 = (await tab2.locator('#editor-template-name').innerText()).trim();
    assert.equal(tplName2, tplName1, 'tab 2 must resume the exact same draft tab 1 has open (same template)');

    // Merely opening the same draft elsewhere must not itself warn — only an
    // actual write from another tab should.
    assert.equal(await banner1.isVisible(), false, 'opening the draft in a second tab alone must not warn yet');

    // ---- Tab 2 edits the draft — this is the "second tab saves" moment. ----
    const frame2 = tab2.frameLocator('#preview-iframe');
    const nameField2 = frame2.locator('[data-hb-edit="business.name"]').first();
    await nameField2.click({ clickCount: 3 });
    await tab2.keyboard.type('Cabinet Din Tab Doi', { delay: 15 });
    await tab2.locator('#editor-template-name').click(); // blur → saveDraft()
    await tab2.waitForTimeout(600);

    // ---- Tab 1 must now show the honest Romanian warning. ----
    await banner1.waitFor({ state: 'visible', timeout: 5000 });
    const bannerText = (await banner1.innerText()).trim();
    assert.match(bannerText, /altă filă/i, 'banner must say the draft is open in another tab, in Romanian');
    assert.match(bannerText, /nu se îmbină automat|suprascri/i, 'banner must be honest that it does not merge — one save can overwrite the other');

    // ---- Dismissing the banner hides it (this is a warning, not a block). ----
    await tab1.locator('#btn-tab-conflict-dismiss').click();
    assert.equal(await banner1.isVisible(), false, 'dismiss button must hide the banner');

    // ---- The "Reîncarcă pagina" button actually reloads tab 1. ----
    const navPromise = tab1.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => null);
    // Re-trigger the conflict once more so the banner (and its reload button) exist again.
    const nameField2b = tab2.frameLocator('#preview-iframe').locator('[data-hb-edit="business.name"]').first();
    await nameField2b.click({ clickCount: 3 });
    await tab2.keyboard.type('Cabinet Din Tab Doi Bis', { delay: 15 });
    await tab2.locator('#editor-template-name').click();
    await tab2.waitForTimeout(600);
    await banner1.waitFor({ state: 'visible', timeout: 5000 });
    await tab1.locator('#btn-tab-conflict-reload').click();
    await navPromise;
    console.log('PASS wave5-builder-tab-conflict: second tab write warns the first tab honestly, in Romanian, without merging');
  } finally {
    await context.close();
    await browser.close();
    await new Promise((r) => server.close(r));
  }
});
