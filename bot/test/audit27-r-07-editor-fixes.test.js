'use strict';
/**
 * bot/test/audit27-r-07-editor-fixes.test.js
 *
 * Audit 2026-09-27, task R-07 ("Corecții editor (app.js)") — one owned file,
 * six findings. Two halves:
 *
 *  1. A real-browser Playwright reproduction of editor-text-images#1, the
 *     hardest of the six to fake: editing business.name debounce-commits
 *     via a SYNCHRONOUS full re-render (scheduleRerender(true) →
 *     fullRerender()), which used to destroy the whole preview iframe's DOM
 *     — including whatever OTHER field the owner was mid-keystroke on in
 *     that same ~300ms window, before ITS OWN debounced commit could land.
 *     Repro exactly the audit's timing: edit business.name, then within the
 *     debounce window edit business.tagline too, and confirm BOTH survive
 *     the settle instead of the tagline silently reverting to demo text.
 *
 *  2. Fast source-level checks (no browser) for the other five findings —
 *     each greps for the specific fix, not just "the word appears somewhere",
 *     so each one fails against the pre-fix app.js and passes against this
 *     wave's:
 *       - whatsapp-contact#1: a local-format number (leading 0, no country
 *         code) normalizes to a resolvable wa.me link.
 *       - journey-stranger#4: a same-tab magic-link reload (which cannot
 *         keep any in-memory publish continuation alive) has a persisted,
 *         cross-reload flag and a banner shown on the next boot.
 *       - theme-typography#2: picking a dark "Fundal pagină" warns the owner
 *         that the template will flip body text to white ink.
 *       - owner-dashboard#4: a canceled-but-still-hosted site
 *         (status==='unpublished') gets its own "Reactivează site-ul" button
 *         posting to the same /checkout route as "Adaugă un card".
 *       - calendar-native#1 (builder half): the Detalii drawer now covers
 *         appointment.timezone/slotIntervalMinutes instead of leaving two
 *         required schema fields with no editable surface anywhere.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-r-07-editor-fixes.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const APP_JS_PATH = path.join(ROOT, 'builder', 'app.js');
const COPY_RO_PATH = path.join(ROOT, 'builder', 'copy-ro.js');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));

process.env.NODE_ENV = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.HIDOOK_TEST_PAY = '1';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-r07-'));
process.env.SERVER_SECRET = 'audit27-r07-' + crypto.randomBytes(8).toString('hex');
for (const k of ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'VERCEL_TOKEN', 'CLOUDFLARE_API_TOKEN']) {
  delete process.env[k];
}

// -----------------------------------------------------------------------
// Part 1: editor-text-images#1 — real browser, real timing.
// -----------------------------------------------------------------------
test('editor-text-images#1: editing business.name does not wipe a concurrent edit on another field', async () => {
  require(path.join(ROOT, 'scripts', 'build-builder.js'));
  const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
  const { onStripeEvent } = require(path.join(ROOT, 'bot', 'web.js'));
  const server = startServer({ port: 0, onStripeEvent });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const base = 'http://127.0.0.1:' + server.address().port;

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(30000);

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

    const frame = () => page.frameLocator('#preview-iframe');
    const nameField = () => frame().locator('[data-hb-edit="business.name"]').first();
    const taglineField = () => frame().locator('[data-hb-edit="business.tagline"]').first();

    const originalTagline = (await taglineField().innerText()).trim();
    assert.ok(originalTagline.length > 0, 'business.tagline must have preset demo text to begin with');

    // Edit business.name first...
    await nameField().click({ clickCount: 3 });
    await page.keyboard.type('Renovari Casa Nord', { delay: 0 });
    // ...then, WITHOUT waiting out its ~300ms debounce, edit another field.
    // This is the exact race the audit measured (0/100/250ms loses it,
    // 400/600ms keeps it) — no explicit wait here is the point.
    await taglineField().click({ clickCount: 3 });
    await page.keyboard.type('Editie noua de toamna', { delay: 0 });

    // Let every debounce (edit-overlay.js's 300ms mirror, app.js's own
    // scheduleRerender) and the resulting full re-render settle.
    await page.waitForTimeout(1500);

    const finalName = (await nameField().innerText()).trim();
    const finalTagline = (await taglineField().innerText()).trim();

    assert.equal(finalName, 'Renovari Casa Nord', 'the business.name edit itself must persist');
    assert.equal(
      finalTagline,
      'Editie noua de toamna',
      'editor-text-images#1: a concurrent edit on ANOTHER field must survive business.name\'s destructive re-render, not silently revert to demo text ("' + originalTagline + '")'
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
});

// -----------------------------------------------------------------------
// Part 2: the other five findings — deterministic source checks.
// -----------------------------------------------------------------------
test('whatsapp-contact#1: a local-format WhatsApp number normalizes to a resolvable wa.me link', () => {
  const app = fs.readFileSync(APP_JS_PATH, 'utf8');
  const normFn = app.match(/function normalizeWhatsAppDigits\(raw\) \{[\s\S]*?\n\}/);
  assert.ok(normFn, 'normalizeWhatsAppDigits must exist');
  const deriveFn = app.match(/function deriveWaHref\(config\) \{[\s\S]*?\n\}/);
  assert.ok(deriveFn, 'deriveWaHref must exist');
  assert.match(deriveFn[0], /normalizeWhatsAppDigits/, 'deriveWaHref must route the raw number through normalizeWhatsAppDigits');

  const fnSrc = 'const WA_DEFAULT_MSG = "x";\n' + normFn[0] + '\n' + deriveFn[0] + '\nreturn deriveWaHref;';
  // eslint-disable-next-line no-new-func
  const derive = new Function(fnSrc)();

  const local = { contact: { whatsapp: '0721234567', waMessage: 'salut' } };
  derive(local);
  assert.equal(local.contact.waHref, 'https://wa.me/40721234567?text=salut', 'the audit repro shape ("0721234567") must resolve to a valid wa.me link with the RO country code');

  // Already-international input (the field's own documented format) must
  // NOT be double-prefixed by a naive reuse of the Quickstart phone helper.
  const intl = { contact: { whatsapp: '40721234567', waMessage: 'salut' } };
  derive(intl);
  assert.equal(intl.contact.waHref, 'https://wa.me/40721234567?text=salut', 'an already-international number must not gain a duplicated country code');
});

test('journey-stranger#4: a same-tab magic-link reload leaves a persisted, resumable publish banner', () => {
  const app = fs.readFileSync(APP_JS_PATH, 'utf8');
  assert.match(app, /PENDING_PUBLISH_INTENT_KEY/, 'a persisted (survives full reload) pending-publish marker must exist');
  assert.match(app, /function markPendingPublishIntent/, 'markPendingPublishIntent must exist');
  assert.match(app, /function hasFreshPendingPublishIntent/, 'hasFreshPendingPublishIntent must exist');
  assert.match(app, /function showResumePublishBanner/, 'showResumePublishBanner must exist');

  // Marked right where doActualPublish discovers it needs sign-in first —
  // the exact moment the audit's same-tab reload would otherwise lose.
  const doActualPublish = app.match(/async function doActualPublish\(chosenSlug\) \{[\s\S]*?\n\}\n\nasync function execPublish/);
  assert.ok(doActualPublish, 'locate doActualPublish');
  assert.match(doActualPublish[0], /markPendingPublishIntent\(\)/, 'doActualPublish must mark pending intent before showing the auth step');

  // Checked on boot, after handleRoute() has restored any local draft.
  const boot = app.match(/async function boot\(\) \{[\s\S]*?\n\}/);
  assert.ok(boot, 'locate boot()');
  assert.match(boot[0], /hasFreshPendingPublishIntent\(\)/, 'boot() must check the persisted flag');
  assert.match(boot[0], /showResumePublishBanner\(\)/, 'boot() must show the resume banner when the flag is fresh');

  // A successful publish must clear it, so the banner never lingers.
  const execPublish = app.match(/async function execPublish\(slug\) \{[\s\S]*?\n\}/);
  assert.ok(execPublish, 'locate execPublish');
  assert.match(execPublish[0], /clearPendingPublishIntent\(\)/, 'a successful publish must clear the pending-intent flag');
});

test('theme-typography#2: a dark "Fundal pagină" warns that body text flips to white ink', () => {
  const app = fs.readFileSync(APP_JS_PATH, 'utf8');
  const applyBg = app.match(/function applyThemeBackground\(hex\) \{[\s\S]*?\n\}/);
  assert.ok(applyBg, 'locate applyThemeBackground');
  assert.match(applyBg[0], /warnIfBackgroundFlipsInk/, 'applyThemeBackground must call the contrast-warning helper');

  const warnFn = app.match(/function warnIfBackgroundFlipsInk\(hex\) \{[\s\S]*?\n\}/);
  assert.ok(warnFn, 'warnIfBackgroundFlipsInk must exist');
  const relLumFn = app.match(/function relLuminance\(hex\) \{[\s\S]*?\n\}/);
  const contrastFn = app.match(/function contrastRatio\(l1, l2\) \{[\s\S]*?\n\}/);
  assert.ok(relLumFn && contrastFn, 'contrast helpers must exist');

  // PLAN-UX-2026-09-27 §5.8 (T-3): warnIfBackgroundFlipsInk now reads its
  // Romanian text from the RO catalog (builder/copy-ro.js) — load it into
  // this Function scope too, same as the real page's <script> order.
  // Stripped of its own 'use strict' — concatenated into one Function body
  // it would make the whole thing strict, and this app.js code has
  // unrelated, pre-existing implicit-global assignments elsewhere that rely
  // on staying non-strict in this isolated-extraction fixture.
  const copyRoSrc = fs.readFileSync(COPY_RO_PATH, 'utf8').replace(/^'use strict';\s*\n?/, '');
  const fnSrc =
    copyRoSrc + '\n' +
    'let bgNeedsWhiteInkWarned = false;\n' +
    relLumFn[0] + '\n' + contrastFn[0] + '\n' +
    'const BG_INK_VOID_L = 0.003035269835488375;\nconst BG_INK_SNOW_L = 0.9405136905533645;\n' +
    warnFn[0] + '\nreturn warnIfBackgroundFlipsInk;';
  // eslint-disable-next-line no-new-func
  const calls = [];
  const warn = new Function('showToast', fnSrc)((msg) => calls.push(msg));
  warn('#0a1a3a'); // a genuinely dark navy background
  assert.equal(calls.length, 1, 'a dark background must trigger exactly one warning toast');
  warn('#FBF7EE'); // light background — no warning, and clears the flag
  assert.equal(calls.length, 1, 'a light background must not warn');
});

test("owner-dashboard#4: a canceled site with valid hosting gets a 'Reactivează site-ul' button", () => {
  const app = fs.readFileSync(APP_JS_PATH, 'utf8');
  const buildSiteCard = app.match(/function buildSiteCard\(site\) \{[\s\S]*?\n\}\n\n\/\*\*/);
  assert.ok(buildSiteCard, 'locate buildSiteCard');
  const src = buildSiteCard[0];

  // buildSiteCard has TWO `site.status === 'unpublished'` checks — one in
  // the badge/label section, one in the actions section (the one this task
  // added) — so anchor on the unique new button identifier instead of a
  // branch-boundary regex that could latch onto the wrong one.
  const reactivateSite = src.match(/else if \(site\.status === 'unpublished'\) \{[\s\S]{0,700}reactivateBtn[\s\S]{0,700}\n  \}/);
  assert.ok(reactivateSite, "locate the status==='unpublished' branch that declares reactivateBtn");
  assert.match(reactivateSite[0], /Reactivează site-ul/, "the unpublished branch must offer 'Reactivează site-ul'");
  assert.match(reactivateSite[0], /\/checkout/, 'reactivation must POST to the same .../checkout route as "Adaugă un card"');
});

test('calendar-native#1 (builder half): Detalii covers appointment.timezone / slotIntervalMinutes', () => {
  const app = fs.readFileSync(APP_JS_PATH, 'utf8');
  const drawerKeysLine = app.match(/const DRAWER_KEYS_PARTIAL = \[[\s\S]*?\];/);
  assert.ok(drawerKeysLine, 'locate DRAWER_KEYS_PARTIAL');
  assert.match(drawerKeysLine[0], /'appointment\.timezone'/, 'appointment.timezone must be routed into Detalii');
  assert.match(drawerKeysLine[0], /'appointment\.slotIntervalMinutes'/, 'appointment.slotIntervalMinutes must be routed into Detalii');

  // Prove the schema field is now actually reachable via isDrawerField(),
  // not just present in the list (a typo'd key would pass the grep above
  // but still leave the field unreachable).
  const isDrawerFieldFn = app.match(/function isDrawerField\(field\) \{[\s\S]*?\n\}/);
  const isHiddenFn = app.match(/function isHiddenDrawerField\(field\) \{[\s\S]*?\n\}/);
  const hiddenKeysConst = app.match(/const HIDDEN_DRAWER_KEYS = \[[\s\S]*?\];/);
  const drawerTypesConst = app.match(/const DRAWER_TYPES = new Set\([\s\S]*?\);/);
  assert.ok(isDrawerFieldFn && isHiddenFn && hiddenKeysConst && drawerTypesConst, 'locate isDrawerField + its dependencies');
  const fnSrc =
    drawerTypesConst[0] + '\n' + drawerKeysLine[0] + '\n' + hiddenKeysConst[0] + '\n' +
    isHiddenFn[0] + '\n' + isDrawerFieldFn[0] + '\nreturn isDrawerField;';
  // eslint-disable-next-line no-new-func
  const isDrawerField = new Function(fnSrc)();
  assert.equal(isDrawerField({ key: 'appointment.timezone', type: 'text' }), true, 'appointment.timezone must resolve as a drawer field');
  assert.equal(isDrawerField({ key: 'appointment.slotIntervalMinutes', type: 'text' }), true, 'appointment.slotIntervalMinutes must resolve as a drawer field');
});
