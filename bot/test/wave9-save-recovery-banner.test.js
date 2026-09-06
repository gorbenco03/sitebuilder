'use strict';
/**
 * bot/test/wave9-save-recovery-banner.test.js
 *
 * Oracle for Wave 9 (save-state audit) item 4 — "Recover an interrupted
 * session. If someone's browser crashes or they close by accident, offer
 * their unsaved work back when they return, and let them decline it. Be
 * careful with the existing multi-tab conflict warning — the two must not
 * fight each other or double-warn."
 *
 * #edit already auto-resumed the local draft on a plain reload before this
 * wave (resumeLocalDraft, wired into handleRoute) — that part was never
 * broken. The gap was returning some OTHER way after an unclean close:
 * back on the templates screen, or a brand-new tab, with nothing offering
 * the interrupted draft back. builder/app.js now shows #recovery-banner
 * (maybeShowRecoveryBanner, wired from showScreen()'s non-edit branch) in
 * exactly that situation, with an explicit accept ("Continuă editarea") and
 * decline ("Renunță") — and it hides itself the instant #edit is showing
 * (the multi-tab conflict banner's own territory), so the two banners can
 * never both be on screen fighting for the same attention.
 *
 * Run: node --experimental-sqlite --test bot/test/wave9-save-recovery-banner.test.js
 * Evidence: 04-QA-Evidence/Wave9-save/
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = path.join(ROOT, '04-QA-Evidence', 'Wave9-save');
const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));

test('an interrupted local draft is offered back on return, and can be declined, without fighting the tab-conflict banner', async () => {
  fs.mkdirSync(EVIDENCE, { recursive: true });

  process.env.HIDOOK_TEST_PAY = '1';
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wave9-recovery-'));
  process.env.SERVER_SECRET = 'wave9-recovery-oracle-secret';
  for (const k of ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'CLOUDFLARE_API_TOKEN', 'VERCEL_TOKEN']) delete process.env[k];

  require(path.join(ROOT, 'scripts/build-builder.js'));
  const { startServer } = require(path.join(ROOT, 'bot/server.js'));
  const { onStripeEvent } = require(path.join(ROOT, 'bot/web.js'));
  const server = startServer({ port: 0, onStripeEvent });
  await new Promise((res, rej) => { server.once('listening', res); server.once('error', rej); });
  const base = 'http://127.0.0.1:' + server.address().port;

  const browser = await chromium.launch({ headless: true });
  // ONE context throughout — closing a Page and opening a new one in the
  // same context is the honest way to simulate "closed the tab / crashed,
  // then came back", since localStorage survives exactly like it would in
  // a real browser profile (a brand-new browser/context would NOT share it,
  // which is not what "came back to the same computer" means).
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });

  try {
    // ---- Start editing, make a real edit, let it settle to "saved". ----
    const page1 = await context.newPage();
    page1.setDefaultTimeout(30000);
    await page1.goto(base + '/app/', { waitUntil: 'networkidle' });
    await page1.locator('#hb-cookie-accept').click().catch(() => {});
    await page1.locator('.template-card[data-template-id="portfolio"] .btn-start-tpl').click();
    await page1.waitForURL(/#edit$/);
    await page1.locator('#preview-iframe').waitFor({ state: 'visible' });
    await page1.waitForTimeout(1200);
    if (await page1.locator('#details-drawer').isVisible().catch(() => false)) {
      await page1.locator('#btn-close-drawer').click().catch(() => {});
      await page1.waitForTimeout(400);
    }
    const templateName = (await page1.locator('#editor-template-name').innerText()).trim();

    const frame1 = () => page1.frameLocator('#preview-iframe');
    const nameField1 = () => frame1().locator('[data-hb-edit="business.name"]').first();
    await nameField1().click({ clickCount: 3 });
    await page1.keyboard.type('Studio Neterminat', { delay: 15 });
    await assert.doesNotReject(
      page1.locator('#save-status[data-state="saved"]').waitFor({ state: 'visible', timeout: 3000 }),
      'the edit must be safely persisted locally before simulating an unclean close'
    );

    // ---- Simulate "closed by accident / crashed" — just close the tab. ----
    await page1.close();

    // =====================================================================
    // A. Coming back (a fresh tab, templates screen — NOT #edit) offers the
    //    interrupted draft back, naming the design, with an explicit choice.
    // =====================================================================
    const page2 = await context.newPage();
    page2.setDefaultTimeout(30000);
    await page2.goto(base + '/app/', { waitUntil: 'networkidle' });
    await page2.locator('#hb-cookie-accept').click().catch(() => {});

    const banner = page2.locator('#recovery-banner');
    await assert.doesNotReject(banner.waitFor({ state: 'visible', timeout: 3000 }), 'returning to templates with an interrupted draft must offer it back');
    const bannerText = (await banner.locator('.recovery-banner-text').innerText()).trim();
    assert.match(bannerText, new RegExp(templateName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the recovery banner must name the interrupted design');
    await page2.screenshot({ path: path.join(EVIDENCE, '09-recovery-banner-offered.png') });

    // The tab-conflict banner is a DIFFERENT mechanism (another tab actively
    // writing to the same draft) — it must not also be showing here; there
    // is no second tab open right now, and we are not even on #edit.
    assert.equal(await page2.locator('#tab-conflict-banner').isVisible(), false, 'the tab-conflict banner must not fire for an ordinary single-tab recovery');

    // ---- Accept: "Continuă editarea" resumes the exact interrupted draft. ----
    await page2.locator('#btn-recovery-resume').click();
    await page2.waitForURL(/#edit$/);
    await page2.locator('#preview-iframe').waitFor({ state: 'visible' });
    await page2.waitForTimeout(1200);
    if (await page2.locator('#details-drawer').isVisible().catch(() => false)) {
      await page2.locator('#btn-close-drawer').click().catch(() => {});
      await page2.waitForTimeout(400);
    }
    const frame2 = () => page2.frameLocator('#preview-iframe');
    const recoveredName = (await frame2().locator('[data-hb-edit="business.name"]').first().innerText()).trim();
    assert.equal(recoveredName, 'Studio Neterminat', 'accepting recovery must resume the exact interrupted edit');
    // #edit hides the recovery banner — it is not a competing banner once
    // the owner is actually back in the editor.
    assert.equal(await page2.locator('#recovery-banner').isVisible(), false, 'the recovery banner must not linger once #edit is showing');
    await page2.screenshot({ path: path.join(EVIDENCE, '10-recovery-accepted-resumed.png') });

    // =====================================================================
    // B. Decline path — a SEPARATE interrupted draft, "Renunță" makes the
    //    offer (and the underlying local draft) actually go away.
    // =====================================================================
    const page3 = await context.newPage();
    page3.setDefaultTimeout(30000);
    await page3.goto(base + '/app/#templates', { waitUntil: 'networkidle' });
    await page3.locator('.template-card[data-template-id="local-service"] .btn-start-tpl').click();
    await page3.waitForURL(/#edit$/);
    await page3.locator('#preview-iframe').waitFor({ state: 'visible' });
    await page3.waitForTimeout(1200);
    if (await page3.locator('#details-drawer').isVisible().catch(() => false)) {
      await page3.locator('#btn-close-drawer').click().catch(() => {});
      await page3.waitForTimeout(400);
    }
    const frame3 = () => page3.frameLocator('#preview-iframe');
    await frame3().locator('[data-hb-edit="business.name"]').first().click({ clickCount: 3 });
    await page3.keyboard.type('Al Doilea Proiect', { delay: 15 });
    await assert.doesNotReject(
      page3.locator('#save-status[data-state="saved"]').waitFor({ state: 'visible', timeout: 3000 }),
      'second draft must also be safely persisted before closing'
    );
    await page3.close();

    const page4 = await context.newPage();
    page4.setDefaultTimeout(30000);
    await page4.goto(base + '/app/', { waitUntil: 'networkidle' });
    await assert.doesNotReject(
      page4.locator('#recovery-banner').waitFor({ state: 'visible', timeout: 3000 }),
      'the second interrupted draft must also be offered back'
    );
    await page4.locator('#btn-recovery-discard').click();
    assert.equal(await page4.locator('#recovery-banner').isVisible(), false, 'declining must dismiss the banner immediately');

    const clearedDraft = await page4.evaluate(() => localStorage.getItem('hb.draft.v1'));
    assert.equal(clearedDraft, null, 'declining ("Renunță") must actually clear the local draft, not just hide the banner');
    await page4.screenshot({ path: path.join(EVIDENCE, '11-recovery-declined-cleared.png') });

    // A later visit must not resurrect an offer for a draft that no longer exists.
    const page5 = await context.newPage();
    page5.setDefaultTimeout(30000);
    await page5.goto(base + '/app/', { waitUntil: 'networkidle' });
    assert.equal(await page5.locator('#recovery-banner').isVisible(), false, 'a declined/cleared draft must not keep reappearing');

    console.log('PASS wave9-save-recovery-banner: interrupted local drafts are offered back, declinable, and never collide with the tab-conflict banner');
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
});
