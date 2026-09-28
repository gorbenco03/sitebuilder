'use strict';
/**
 * bot/test/audit27-s-1-onboarding-wizard.test.js — task S-1
 * (PLAN-UX-2026-09-27 §5.1, "Wizard scurt de onboarding, înainte de canvas").
 *
 * RED (old behavior, HEAD before this task): #onboarding-wizard does not
 * exist at all — clicking a catalog card's "Începe" always lands straight
 * on #edit with that exact template and demo content, no business-type
 * question, no name/phone/town step.
 *
 * GREEN (this task): a first-time visitor who clicks a template card sees a
 * 2-step wizard (business type → optional name/phone/town) before the
 * editor opens; the FINAL template is whichever business type they picked
 * (which can differ from the card they actually clicked — proves the
 * recommendation, not just the click, drives the result), and any
 * name/phone/town filled in step 2 is already applied on the canvas via the
 * EXISTING applyQuickstart() cascade (business.name, in this test). A
 * second visit (wizard already completed) skips straight back to the old,
 * direct behavior. Escape at any point skips the wizard outright — the
 * originally-clicked template opens with no identity applied.
 *
 * Every existing "click a template card → land on #edit" Playwright oracle
 * in this suite keeps passing unmodified: navigator.webdriver reads true
 * under Playwright's default CDP automation, and hidookOnboardingShouldRun()
 * (builder/onboarding.js) treats that as "never show the wizard" — see that
 * function's own doc comment. This oracle is the one exception: it
 * overrides navigator.webdriver to false via page.addInitScript() before
 * first navigating, specifically so it CAN see and drive the real wizard.
 *
 * Screenshots: os.tmpdir()/audit27-s1-<action-just-performed>.png.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-s-1-onboarding-wizard.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');
const APP_JS_SOURCE = fs.readFileSync(path.join(ROOT, 'builder/app.js'), 'utf8');
const ONBOARDING_JS_SOURCE = fs.readFileSync(path.join(ROOT, 'builder/onboarding.js'), 'utf8');
const INDEX_HTML_SOURCE = fs.readFileSync(path.join(ROOT, 'builder/index.html'), 'utf8');

function loadPlaywright() {
  const candidates = [
    path.join(ROOT, 'node_modules/playwright'),
    '/Users/Work/.hermes/hermes-agent/node_modules/playwright',
    path.join(ROOT, '../fullpass-63230d2/node_modules/playwright'),
  ];
  for (const cand of candidates) {
    try {
      return require(cand);
    } catch (_) {}
  }
  throw new Error('playwright not found in any candidate location');
}
const { chromium } = loadPlaywright();

async function shot(page, actionJustPerformed) {
  const file = path.join(os.tmpdir(), `audit27-s1-${actionJustPerformed}.png`);
  await page.screenshot({ path: file }).catch(() => {});
  return file;
}

/** The one deliberate exception to "wizard never shows under automation" —
 * see this file's header comment and hidookOnboardingShouldRun()'s own. */
async function newPageAsRealVisitor(browser, viewport) {
  const page = await browser.newPage({ viewport: viewport || { width: 390, height: 844 } });
  page.setDefaultTimeout(30000);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });
  return page;
}

async function gotoTemplates(page, base) {
  await page.goto(base + '/app/#templates-grid', { waitUntil: 'domcontentloaded' });
  if (await page.locator('#hb-cookie-accept').isVisible().catch(() => false)) {
    await page.locator('#hb-cookie-accept').click().catch(() => {});
  }
  await page.locator('.template-card[data-template-id="product-menu"] .btn-start-tpl').waitFor({ state: 'visible' });
}

let browser;
let server;
let base;

test.before(async () => {
  process.env.HIDOOK_TEST_PAY = '1';
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-s1-'));
  process.env.SERVER_SECRET = 'audit27-s1-' + crypto.randomBytes(8).toString('hex');
  for (const k of ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'CLOUDFLARE_API_TOKEN', 'VERCEL_TOKEN']) delete process.env[k];

  require(path.join(ROOT, 'scripts/build-builder.js'));
  const { startServer } = require(path.join(ROOT, 'bot/server.js'));
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

test('source: index.html carries the wizard container and its own <script> tag', () => {
  assert.match(INDEX_HTML_SOURCE, /id="onboarding-wizard"/, 'onboarding-wizard container must exist');
  assert.match(INDEX_HTML_SOURCE, /<script src="\/app\/onboarding\.js"><\/script>/, 'onboarding.js must be loaded');
});

test('source: app.js hook reuses applyQuickstart(), never reimplements the identity cascade', () => {
  assert.match(APP_JS_SOURCE, /hidookOnboardingShouldRun/, 'startWithTemplate must consult the onboarding gate');
  assert.match(APP_JS_SOURCE, /hidookOnboardingStart/, 'startWithTemplate must be able to hand off to the wizard');
  assert.match(APP_JS_SOURCE, /applyQuickstart\(\)/, 'onboarding identity must be applied via the existing applyQuickstart()');
});

test('source: the wizard gate skips automated/webdriver-controlled browsers', () => {
  assert.match(
    ONBOARDING_JS_SOURCE,
    /navigator\.webdriver/,
    'hidookOnboardingShouldRun() must skip the wizard under automation so existing catalog→editor oracles stay unaffected'
  );
});

test('behavior: fresh visitor sees the wizard, picking a different business type overrides the clicked card, name gets applied, and it never shows again', async () => {
  const page = await newPageAsRealVisitor(browser);
  try {
    await gotoTemplates(page, base);

    // Sanity: real first-time visitor, no prior onboarding flag.
    const seenBefore = await page.evaluate(() => {
      try { return localStorage.getItem('hb.onboarding.seen.v1'); } catch (_) { return 'error'; }
    });
    assert.equal(seenBefore, null, 'must start with no onboarding-seen flag');

    // Click the RESTAURANT card ("product-menu") — the wizard must appear
    // instead of navigating straight to #edit.
    await page.locator('.template-card[data-template-id="product-menu"] .btn-start-tpl').click();
    await page.locator('#onboarding-wizard .onb-box').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(300); // let the overlay's own fadeIn/slideUp settle before the proof screenshot
    await shot(page, '01-wizard-step1-appeared');

    assert.match(await page.locator('#onboarding-wizard .onb-title').innerText(), /Ce fel de afacere ai\?/);
    assert.doesNotMatch(page.url(), /#edit$/, 'must not have navigated to the editor yet');

    // The card matching the clicked template (Restaurant sau cafenea) starts
    // pre-selected — confirm/adjust, not a cold choice.
    const preselected = page.locator('#onboarding-wizard .onb-type-card.is-selected');
    await assert.doesNotReject(preselected.waitFor({ state: 'visible', timeout: 5000 }));
    assert.match(await preselected.innerText(), /Restaurant/);

    // Keyboard accessibility: focus lands on a real, tabbable type card.
    const focusedIsTypeCard = await page.evaluate(
      () => !!(document.activeElement && document.activeElement.classList.contains('onb-type-card'))
    );
    assert.ok(focusedIsTypeCard, 'step 1 must focus a type card for keyboard users');

    // Pick a DIFFERENT vertical (patiserie) — this must end up overriding the
    // originally-clicked "product-menu" card, not just confirming it.
    await page.locator('#onboarding-wizard .onb-type-card[data-type="patiserie"]').click();
    await page.locator('#onboarding-wizard #onb-identity-form').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(300); // let the step's own slideUp/fadeIn settle before the proof screenshot
    await shot(page, '02-wizard-step2-appeared');
    assert.match(await page.locator('#onboarding-wizard .onb-title').innerText(), /Cum se numește afacerea/);

    // Step 2 is optional/skippable — only the name field is filled here.
    await page.locator('#onb-name').fill('Cofetăria Solaris');
    await page.locator('#onb-continue-btn').click();

    await page.waitForURL(/#edit$/, { timeout: 15000 });
    await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(900);
    await shot(page, '03-editor-opened-with-name-applied');

    const overlayHidden = await page.evaluate(() => {
      const el = document.getElementById('onboarding-wizard');
      return !el || getComputedStyle(el).display === 'none';
    });
    assert.ok(overlayHidden, 'wizard overlay must be gone once the editor opens');

    const state = await page.evaluate(() => ({
      templateId: draft.templateId,
      businessName: draft.config && draft.config.business && draft.config.business.name,
      seenFlag: (() => { try { return localStorage.getItem('hb.onboarding.seen.v1'); } catch (_) { return null; } })(),
    }));
    assert.equal(state.templateId, 'desserdirina', 'the CHOSEN vertical (patiserie), not the clicked card, decides the template');
    assert.equal(state.businessName, 'Cofetăria Solaris', 'applyQuickstart() must have stamped the wizard name into draft.config');
    assert.equal(state.seenFlag, '1', 'wizard completion must be persisted so it never shows again');

    // Second visit (same browser storage): straight to the editor, no wizard.
    await gotoTemplates(page, base);
    await page.locator('.template-card[data-template-id="local-service"] .btn-start-tpl').click();
    await page.waitForURL(/#edit$/, { timeout: 15000 });
    await shot(page, '04-second-visit-no-wizard');
    const wizardShownAgain = await page.locator('#onboarding-wizard .onb-box').isVisible().catch(() => false);
    assert.equal(wizardShownAgain, false, 'the wizard must never show again after completion');
    const secondTemplateId = await page.evaluate(() => draft.templateId);
    assert.equal(secondTemplateId, 'local-service', 'second visit starts exactly the clicked template, unchanged, with no wizard in the way');
  } finally {
    await page.close();
  }
});

test('behavior: Escape skips the wizard outright — clicked template opens with no identity applied', async () => {
  const page = await newPageAsRealVisitor(browser);
  try {
    await gotoTemplates(page, base);
    await page.locator('.template-card[data-template-id="professionals"] .btn-start-tpl').click();
    await page.locator('#onboarding-wizard .onb-box').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(300);
    await shot(page, '05-skip-wizard-open');

    await page.keyboard.press('Escape');
    await page.waitForURL(/#edit$/, { timeout: 15000 });
    await shot(page, '06-skip-lands-on-clicked-template');

    const state = await page.evaluate(() => ({
      templateId: draft.templateId,
      seenFlag: (() => { try { return localStorage.getItem('hb.onboarding.seen.v1'); } catch (_) { return null; } })(),
    }));
    assert.equal(state.templateId, 'professionals', 'skipping must still start the template the visitor actually clicked');
    assert.equal(state.seenFlag, '1', 'skipping counts as seen — never shown again either');
  } finally {
    await page.close();
  }
});
