'use strict';
/**
 * bot/test/audit27-r-16-appjs-consistency-fixes.test.js
 *
 * AUDIT 2026-09-27 - R-16 + R-23 (builder/app.js consistency + small editor
 * fixes; PLAN-AUDIT-2026-09-27.md section 4, round 3).
 *
 * Owner decision 2026-09-27: the currency symbol comes back everywhere a
 * price shows (landing, publish/success modals, dashboard card, Facturi) -
 * ONE formatter, not five independent ones drifting apart
 * (gap-pricing-display-consistency-live#1/#2). Alongside that, this covers
 * the small app.js fixes bundled into the same task:
 *   - copy-i18n#1 (app.js part): "Proiectele mele" -> "Site-urile mele" and
 *     its sibling strings ("proiect neterminat" -> "site neterminat", etc).
 *   - copy-i18n#4: one Romanian date formatter for Facturi and the site
 *     card (both used to disagree on month:'long' vs month:'short').
 *   - a11y#2: Escape on the "Detalii" drawer returns focus to
 *     #btn-open-drawer, the ARIA APG dialog pattern openModal()/closeModal()
 *     already use elsewhere.
 *   - builder-mobile#2: the pre-filled slug field auto-selects on focus, so
 *     typing immediately replaces the suggestion instead of appending to it.
 *   - edge-errors#4: a failed /api/slug-check shows a distinct "could not
 *     check" state, never the same checkmark as a confirmed-free address.
 *   - images-media#3/#4: uploading a GIF/SVG logo used to silently
 *     rasterize it to a flat JPEG/PNG with zero warning. Reviewer
 *     correction 2026-09-27: an earlier version of this fix instead KEPT
 *     the original GIF/SVG bytes — that broke publishing outright, because
 *     POST /api/publish's server-side image allowlist (bot/server.js
 *     handlePublish, main commit 0a694b7, api-security#1) only accepts
 *     image/jpeg|png|webp and this task does not own bot/server.js to
 *     widen it. Both formats still rasterize like before; the actual fix
 *     is only the warning, shown unconditionally now (not just above a
 *     size ceiling), plus a real end-to-end publish proving a GIF/SVG
 *     logo still reaches a live site.
 *   - images-media#5 (flagged mid-task by the coordinator, added to this
 *     task's scope): a HEIC photo (iPhone's camera default) used to fail
 *     with a half-Romanian, half-English message ("Nu am putut procesa
 *     fotografia: Error reading the image") because canvas/FileReader can't
 *     decode HEIC and the raw DOM error's English text got glued onto a
 *     Romanian prefix. Detected up front now, one full Romanian sentence,
 *     no attempted client-side conversion (no HEIC decoder dependency in
 *     this zero-dep renderer).
 *   - instafidget-social#3/#4: the terms-agreed status line clears once
 *     ticked, and status text always lands on whichever Instagram-modal
 *     panel is actually visible.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-r-16-appjs-consistency-fixes.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));

process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hidook-r16-appjs-'));
process.env.SERVER_SECRET = 'r16-appjs-' + crypto.randomBytes(8).toString('hex');
process.env.HIDOOK_TEST_PAY = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
delete process.env.PUBLIC_URL;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.CLOUDFLARE_API_TOKEN;
delete process.env.VERCEL_TOKEN;

require(path.join(ROOT, 'scripts', 'build-builder.js'));
const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
const { onStripeEvent } = require(path.join(ROOT, 'bot', 'web.js'));
const APP_JS_PATH = path.join(ROOT, 'builder', 'app.js');
let server;
let base;

test.before(async () => {
  server = startServer({ port: 0, onStripeEvent });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  base = 'http://127.0.0.1:' + server.address().port;
});

test.after(() => {
  if (server) server.close();
});

// A tiny, real, decodable 1x1 GIF (not a fake extension on other bytes) —
// the point is that resizeImageToDataUrl() must ship these exact bytes
// back out under image/gif, not re-encode them.
const TINY_GIF_BASE64 = 'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const TINY_GIF_BUFFER = Buffer.from(TINY_GIF_BASE64, 'base64');

const TINY_SVG_TEXT = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10"><rect width="10" height="10" fill="#5B5BD6"/></svg>';
const TINY_SVG_BUFFER = Buffer.from(TINY_SVG_TEXT, 'utf8');

async function gotoEditorWithTemplate(page, templateId) {
  await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
  if (await page.locator('#hb-cookie-accept').isVisible().catch(() => false)) {
    await page.locator('#hb-cookie-accept').click().catch(() => {});
  }
  await page.locator('.template-card[data-template-id="' + templateId + '"] .btn-start-tpl').click();
  await page.waitForURL(/#edit$/, { timeout: 30000 }).catch(() => {});
  await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(600);
}

async function closeDrawerIfOpen(page) {
  const drawer = page.locator('#details-drawer');
  if (await drawer.isVisible().catch(() => false)) {
    await page.locator('#btn-close-drawer').click().catch(() => {});
    await page.waitForTimeout(300);
  }
}

// ---------------------------------------------------------------------------
// Part 1: real-browser behaviour — the findings that depend on live DOM
// state (focus, network failure, file bytes) rather than pure source logic.
// ---------------------------------------------------------------------------

test('a11y#2: Escape on the Detalii drawer returns focus to #btn-open-drawer', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    page.setDefaultTimeout(20000);
    await gotoEditorWithTemplate(page, 'local-service');
    await closeDrawerIfOpen(page);

    await page.locator('#btn-open-drawer').click();
    await page.locator('#details-drawer').waitFor({ state: 'visible' });
    // Move focus off the opener first (into the drawer itself), so a pass
    // here cannot be a false positive from focus never having left it.
    await page.keyboard.press('Tab');
    const focusedInsideDrawer = await page.evaluate(() => {
      const d = document.getElementById('details-drawer');
      return !!(d && d.contains(document.activeElement));
    });
    assert.ok(focusedInsideDrawer, 'focus-trap precondition: focus must be inside the drawer before Escape');

    await page.keyboard.press('Escape');
    await page.waitForFunction(() => {
      const d = document.getElementById('details-drawer');
      return !d || d.style.display === 'none' || getComputedStyle(d).display === 'none';
    }, { timeout: 5000 });

    const activeId = await page.evaluate(() => document.activeElement && document.activeElement.id);
    assert.equal(activeId, 'btn-open-drawer', 'a11y#2: focus must land on #btn-open-drawer after Escape, not be lost (got "' + activeId + '")');
  } finally {
    await browser.close();
  }
});

test('builder-mobile#2 + edge-errors#4: slug field auto-selects on focus, and a failed slug-check shows a distinct state', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(20000);
    await gotoEditorWithTemplate(page, 'local-service');
    await closeDrawerIfOpen(page);

    await page.locator('#btn-publish').click();
    await page.locator('#modal-publish').waitFor({ state: 'visible' });

    const slugInput = page.locator('#input-slug');
    await slugInput.waitFor({ state: 'visible' });
    const prefilled = await slugInput.inputValue();
    assert.ok(prefilled.length > 0, 'the slug field must open pre-filled with a suggested slug for this repro to be meaningful');

    // builder-mobile#2: focusing the pre-filled field must select all of it,
    // so an immediate keystroke REPLACES the suggestion instead of being
    // inserted at a caret position, which would concatenate the two.
    await slugInput.click();
    const selectionOnFocus = await slugInput.evaluate((el) => el.selectionEnd - el.selectionStart);
    assert.equal(selectionOnFocus, prefilled.length, 'builder-mobile#2: the whole pre-filled value must be selected on focus, not just placed a caret');

    await page.keyboard.type('cafeneaua-mea', { delay: 0 });
    const afterType = await slugInput.inputValue();
    assert.equal(afterType, 'cafeneaua-mea', 'typing right after focus must REPLACE the suggestion, not append to it (would read "' + prefilled + 'cafeneaua-mea" otherwise)');

    // edge-errors#4: fail every /api/slug-check request for the rest of
    // this page's life and confirm the icon/error state is never "valid".
    await page.route('**/api/slug-check*', (route) => route.abort('failed'));

    await slugInput.fill('');
    await slugInput.type('adresa-noua-test', { delay: 30 });
    // scheduleSlugCheck() debounces 550ms before firing the (now-failing) check.
    await page.waitForTimeout(1200);

    const iconText = (await page.locator('#slug-status-icon').innerText()).trim();
    assert.notEqual(iconText, '✓', 'edge-errors#4: a network-failed slug check must never show the same checkmark as a confirmed-free address');
    assert.equal(iconText, '?', 'edge-errors#4: a network-failed slug check must show the distinct "could not check" icon');

    const previewClass = await page.locator('#slug-preview').getAttribute('class');
    assert.ok(!/\bvalid\b/.test(previewClass || ''), 'edge-errors#4: the preview element must not carry the "valid" class on a check failure');

    const errorVisible = await page.locator('#slug-error').isVisible();
    assert.ok(errorVisible, 'edge-errors#4: a visible message must explain the check could not run');
    const errorText = (await page.locator('#slug-error').innerText()).trim();
    assert.match(errorText, /nu am putut verifica/i, 'edge-errors#4: the message must say the check itself failed, in Romanian');
  } finally {
    await browser.close();
  }
});

/** Uploads `buffer` as the Logo through the real gallery UI and returns the
 * resulting draft.config.logo data URL. Shared by the GIF/SVG cases below. */
async function uploadLogoAndGetStoredSrc(page, fileName, mimeType, buffer) {
  await page.locator('#btn-open-gallery').click();
  const modal = page.locator('#modal-gallery');
  await modal.waitFor({ state: 'visible', timeout: 10000 });
  const logoSection = modal.locator('.gallery-path-section').filter({
    has: page.locator('.field-label', { hasText: 'Logo' }),
  });
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    logoSection.getByRole('button', { name: /Alege o poz|Înlocuiește/ }).click(),
  ]);
  await fileChooser.setFiles({ name: fileName, mimeType, buffer });
  await page.waitForFunction(() => !!(draft && draft.config && draft.config.logo), { timeout: 10000 });
  return page.evaluate(() => draft.config.logo);
}

test('images-media#3: an animated GIF logo upload is flattened to a publish-safe JPEG/PNG, with an explicit Romanian warning', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    page.setDefaultTimeout(20000);
    await gotoEditorWithTemplate(page, 'product-menu');
    await closeDrawerIfOpen(page);

    const storedSrc = await uploadLogoAndGetStoredSrc(page, 'anim.gif', 'image/gif', TINY_GIF_BUFFER);

    // images-media#3 (reviewer correction): the server's image allowlist
    // (bot/server.js handlePublish) only accepts jpeg/png/webp, so the
    // stored value must be one of those, never the original image/gif —
    // that's what made publishing fail outright before this fix.
    assert.match(storedSrc, /^data:image\/(jpeg|png);base64,/, 'images-media#3: a GIF upload must be flattened to a publish-compatible jpeg/png, got: ' + storedSrc.slice(0, 24));
    assert.notEqual(storedSrc.slice(0, 24).indexOf('image/gif'), 0, 'must not still be image/gif');

    // The warning must be unconditional (any GIF, not just an oversized
    // one) and say plainly, in Romanian, that the animation is lost.
    const toastText = (await page.locator('#toast').textContent() || '').trim();
    assert.match(toastText, /animați/i, 'images-media#3: a GIF upload must warn about losing its animation, got toast: "' + toastText + '"');
  } finally {
    await browser.close();
  }
});

test('images-media#4: an SVG logo upload is rasterized to a publish-safe JPEG/PNG, with an explicit Romanian warning', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    page.setDefaultTimeout(20000);
    await gotoEditorWithTemplate(page, 'product-menu');
    await closeDrawerIfOpen(page);

    const storedSrc = await uploadLogoAndGetStoredSrc(page, 'logo.svg', 'image/svg+xml', TINY_SVG_BUFFER);

    assert.match(storedSrc, /^data:image\/(jpeg|png);base64,/, 'images-media#4: an SVG upload must be rasterized to a publish-compatible jpeg/png, got: ' + storedSrc.slice(0, 30));
    assert.notEqual(storedSrc.slice(0, 24).indexOf('image/svg'), 0, 'must not still be image/svg+xml');

    const toastText = (await page.locator('#toast').textContent() || '').trim();
    assert.match(toastText, /vectorial/i, 'images-media#4: an SVG upload must warn about losing its vector quality, got toast: "' + toastText + '"');
  } finally {
    await browser.close();
  }
});

test('images-media#3/#4: a site with an uploaded GIF logo still publishes end-to-end (server allowlist compatibility)', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    page.setDefaultTimeout(30000);
    await gotoEditorWithTemplate(page, 'product-menu');
    await closeDrawerIfOpen(page);

    await uploadLogoAndGetStoredSrc(page, 'anim.gif', 'image/gif', TINY_GIF_BUFFER);
    await page.locator('#btn-close-gallery').click();
    await page.locator('#modal-gallery').waitFor({ state: 'hidden', timeout: 5000 });

    // Sign in (POST /api/publish requires auth) through the same dev
    // magic-link flow the other suites use.
    await page.locator('#btn-account-menu').click();
    await page.locator('#account-menu-projects').click();
    await page.waitForURL(/#dashboard$/);
    await page.locator('#btn-dashboard-auth').click();
    await page.locator('#form-auth-email').waitFor({ state: 'visible' });
    await page.locator('#input-email').fill('r16-gif-publish@example.com');
    await page.locator('#btn-send-magic').click();
    await page.locator('#dev-link').waitFor({ state: 'visible' });
    await page.locator('#dev-link').click();
    await page.waitForURL(/#edit$/);
    await page.locator('#preview-iframe').waitFor({ state: 'visible' });
    await page.waitForTimeout(600);
    await closeDrawerIfOpen(page);
    // The logo survives sign-in (same draft, now attached to the account).
    await page.waitForFunction(() => !!(draft && draft.config && draft.config.logo), { timeout: 10000 });

    await page.locator('#btn-publish').click();
    await page.locator('#modal-publish').waitFor({ state: 'visible' });
    const slug = 'r16-gif-pub-' + crypto.randomBytes(4).toString('hex');
    await page.locator('#input-slug').fill(slug);

    // Capture the actual POST /api/publish response instead of only
    // inferring success from the modal — a 422 here is exactly the
    // reviewer-reproduced regression, and asserting on the real response
    // makes that failure mode unambiguous instead of just "modal timed out".
    const publishResponsePromise = page.waitForResponse((res) => res.url().includes('/api/publish') && res.request().method() === 'POST');
    await page.locator('#btn-publish-continue').click();
    const publishResponse = await publishResponsePromise;
    let publishBody = null;
    try { publishBody = await publishResponse.json(); } catch (_) { /* ignore */ }
    assert.ok(
      publishResponse.status() >= 200 && publishResponse.status() < 300,
      'images-media#3/#4: POST /api/publish with an uploaded GIF logo must succeed, got ' + publishResponse.status() + ' ' + JSON.stringify(publishBody)
    );

    await page.locator('#modal-success').waitFor({ state: 'visible', timeout: 15000 });
  } finally {
    await browser.close();
  }
});

test('images-media#5: a HEIC upload gets one clear Romanian message, not a half-English decode error', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
    page.setDefaultTimeout(20000);
    await gotoEditorWithTemplate(page, 'product-menu');
    await closeDrawerIfOpen(page);

    await page.locator('#btn-open-gallery').click();
    const modal = page.locator('#modal-gallery');
    await modal.waitFor({ state: 'visible', timeout: 10000 });
    const logoSection = modal.locator('.gallery-path-section').filter({
      has: page.locator('.field-label', { hasText: 'Logo' }),
    });
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      logoSection.getByRole('button', { name: /Alege o poz|Înlocuiește/ }).click(),
    ]);
    // Content doesn't matter — resizeImageToDataUrl() must reject on the
    // file's HEIC type/extension before ever trying to decode it, so this
    // never reaches (and can't accidentally pass because of) real pixels.
    await fileChooser.setFiles({ name: 'iphone-photo.heic', mimeType: 'image/heic', buffer: Buffer.from('not a real heic decoder input', 'utf8') });

    await page.locator('#toast').filter({ hasText: /HEIC/i }).waitFor({ state: 'visible', timeout: 8000 });
    const toastText = (await page.locator('#toast').textContent() || '').trim();
    assert.equal(
      toastText,
      'Fotografiile HEIC de pe iPhone nu sunt acceptate încă. Salvează poza ca JPEG sau PNG și încearcă din nou.',
      'images-media#5: the HEIC message must be one complete, correct Romanian sentence — not glued to a generic prefix or an English decode error'
    );
    assert.doesNotMatch(toastText, /[A-Za-z]+ (reading|the) (image|photo)/i, 'no raw English decode-error fragment may leak into the toast');

    // And the upload must not have silently "succeeded" with garbage data.
    const logoAfter = await page.evaluate(() => (draft && draft.config && draft.config.logo) || null);
    assert.ok(!logoAfter, 'a rejected HEIC upload must not land in draft.config.logo');
  } finally {
    await browser.close();
  }
});

// ---------------------------------------------------------------------------
// Part 2: deterministic source-level checks for the remaining findings.
// ---------------------------------------------------------------------------

test('gap-pricing-display-consistency-live#1: one money formatter, used by every price surface', () => {
  const app = fs.readFileSync(APP_JS_PATH, 'utf8');

  const formatMoneyFn = app.match(/function formatMoneyLabel\(amount, currency\) \{[\s\S]*?\n\}/);
  assert.ok(formatMoneyFn, 'formatMoneyLabel must exist as a single shared formatter');

  // eslint-disable-next-line no-new-func
  const formatMoney = new Function(formatMoneyFn[0] + '\nreturn formatMoneyLabel;')();
  assert.equal(formatMoney(99, 'eur'), '99€', 'EUR must render with the trailing € symbol');
  assert.equal(formatMoney(99, 'gbp'), '£99', 'GBP must render with the leading £ symbol');
  assert.equal(formatMoney(99, 'usd'), '$99', 'USD must render with the leading $ symbol');
  assert.equal(formatMoney(null, 'eur'), '—', 'a missing amount must render as the placeholder, not throw');

  const priceFn = app.match(/function formatPriceLabel\(cfg\) \{[\s\S]*?\n\}/);
  const renewalFn = app.match(/function formatRenewalLabel\(cfg\) \{[\s\S]*?\n\}/);
  assert.ok(priceFn, 'locate formatPriceLabel');
  assert.ok(renewalFn, 'locate formatRenewalLabel');
  assert.match(priceFn[0], /formatMoneyLabel/, 'formatPriceLabel (landing/publish/success/dashboard) must delegate to formatMoneyLabel');
  assert.match(renewalFn[0], /formatMoneyLabel/, 'formatRenewalLabel (renewal CTA) must delegate to formatMoneyLabel');

  // Every price-surface call site named in the finding must exist and go
  // through one of the two formatters above.
  const requiredCallSites = [
    /heroPrice\.textContent\s*=\s*priceLabel/,
    /successPrice\.textContent\s*=\s*formatPriceLabel\(appConfig\)/,
    /const price = formatPriceLabel\(appConfig\)/, // dashboard trial line
    /formatRenewalLabel\(appConfig\)/, // "Reînnoiește hosting" button
  ];
  for (const re of requiredCallSites) {
    assert.match(app, re, 'missing expected price call-site: ' + re);
  }
});

test('gap-pricing-display-consistency-live#2: Facturi renders amounts through the same formatMoneyLabel, not a fifth Intl format', () => {
  const app = fs.readFileSync(APP_JS_PATH, 'utf8');
  const invoiceAmountFn = app.match(/function formatInvoiceAmount\(amountCents, currency\) \{[\s\S]*?\n\}/);
  assert.ok(invoiceAmountFn, 'locate formatInvoiceAmount');
  assert.match(invoiceAmountFn[0], /formatMoneyLabel/, 'formatInvoiceAmount must delegate to formatMoneyLabel');
  assert.doesNotMatch(invoiceAmountFn[0], /Intl\.NumberFormat/, 'the old independent Intl.NumberFormat(\'ro-RO\', {style:\'currency\'...}) implementation must be gone');
});

test('copy-i18n#4: Facturi and the site card share one Romanian date formatter', () => {
  const app = fs.readFileSync(APP_JS_PATH, 'utf8');
  const invoiceDateFn = app.match(/function formatInvoiceDate\(iso\) \{[\s\S]*?\n\}/);
  assert.ok(invoiceDateFn, 'locate formatInvoiceDate');
  assert.match(invoiceDateFn[0], /formatHostingUntilDate/, 'formatInvoiceDate must delegate to the same formatter the site card uses (formatHostingUntilDate)');

  const hostingUntilFn = app.match(/function formatHostingUntilDate\(iso\) \{[\s\S]*?\n\}/);
  assert.ok(hostingUntilFn, 'locate formatHostingUntilDate');
  assert.match(hostingUntilFn[0], /month:\s*['"]long['"]/, 'the shared formatter must use the full month name, not an abbreviation');
});

test('copy-i18n#1 (app.js part): "proiect" no longer names the core site/draft concept in customer-facing app.js strings', () => {
  const app = fs.readFileSync(APP_JS_PATH, 'utf8');

  // The exact offending strings the audit found must be gone.
  const mustNotContain = [
    'Autentifică-te ca să vezi proiectele',
    'Ai un proiect neterminat',
    'un proiect neterminat',
    'proiect neterminat',
    'Acest proiect e deschis',
    'Proiectul a fost înlocuit',
    'Proiectul pe designul',
    'Autentifică-te ca să-ți vezi proiectele',
  ];
  for (const s of mustNotContain) {
    assert.ok(!app.includes(s), 'stale "proiect" copy must be gone: "' + s + '"');
  }

  // And their renamed replacements must be present. PLAN-UX-2026-09-27 §5.8
  // (T-3) moved these literals into the RO catalog (builder/copy-ro.js) —
  // app.js now references them by key instead of repeating the text, so
  // this checks the RO reference is wired up and the catalog still holds
  // the renamed (site, not proiect) Romanian text.
  const mustContain = [
    'RO.DASHBOARD_AUTH_REQUIRED_TITLE', // 'Autentifică-te ca să vezi site-urile'
    "t('UNFINISHED_SITE'", // 'Ai un site neterminat{template}. ...'
    "t('TAB_CONFLICT_WITH_SECTIONS'", // 'Acest site e deschis ...'
    'RO.TAB_CONFLICT_GENERIC', // 'Acest site e deschis ...'
    "t('SITE_SWITCHED_NAMED'", // 'Site-ul pe designul „{name}” ...'
    'RO.AUTH_TITLE_VIEW_SITES', // 'Autentifică-te ca să-ți vezi site-urile'
  ];
  for (const s of mustContain) {
    assert.ok(app.includes(s), 'renamed RO copy missing: "' + s + '"');
  }

  const copyRoSrc = fs.readFileSync(path.join(path.dirname(APP_JS_PATH), 'copy-ro.js'), 'utf8');
  const roSandbox = {};
  vm.runInNewContext(copyRoSrc + '\nthis.RO = RO;', roSandbox);
  const mustContainText = {
    DASHBOARD_AUTH_REQUIRED_TITLE: 'Autentifică-te ca să vezi site-urile',
    UNFINISHED_SITE: 'Ai un site neterminat{template}. Continui de unde ai rămas?',
    TAB_CONFLICT_WITH_SECTIONS: 'Acest site e deschis',
    TAB_CONFLICT_GENERIC: 'Acest site e deschis',
    SITE_SWITCHED_NAMED: 'Site-ul pe designul',
    AUTH_TITLE_VIEW_SITES: 'Autentifică-te ca să-ți vezi site-urile',
  };
  for (const [key, expectedStartsWith] of Object.entries(mustContainText)) {
    assert.ok(!/roiect/.test(roSandbox.RO[key]), 'RO.' + key + ' must not say "proiect": "' + roSandbox.RO[key] + '"');
    assert.ok(roSandbox.RO[key].includes(expectedStartsWith), 'RO.' + key + ' lost its renamed "site" copy: "' + roSandbox.RO[key] + '"');
  }

  // The only remaining "Proiect" in app.js is the account-menu doc-comment
  // for openAccountMenu/closeAccountMenu — that markup is a DIFFERENT
  // task's scope (GDPR items land in the same menu) and must stay untouched
  // here. Anything else would mean this task reached into that code.
  const proiectMatches = [...app.matchAll(/proiect/gi)].map((m) => {
    const start = Math.max(0, m.index - 60);
    return app.slice(start, m.index + 20);
  });
  for (const ctx of proiectMatches) {
    assert.match(ctx, /Editor-topbar account menu/, 'unexpected leftover "proiect" outside the account-menu comment: ...' + ctx);
  }
});

test('instafidget-social#3: the terms-agreed status message clears once the checkbox is ticked', () => {
  const app = fs.readFileSync(APP_JS_PATH, 'utf8');
  const wireStatic = app.match(/function wireStaticButtons\(\) \{[\s\S]*?\n\}\n/);
  assert.ok(wireStatic, 'locate wireStaticButtons');
  const igCheckBlock = wireStatic[0].match(/igCheck\.addEventListener\('change', \(\) => \{[\s\S]*?\n    \}\);/);
  assert.ok(igCheckBlock, 'locate the ig-terms-check change handler');
  assert.match(igCheckBlock[0], /igGo\.disabled = !igCheck\.checked/, 'the connect button must still be enabled/disabled by the checkbox');
  assert.match(igCheckBlock[0], /if \(igCheck\.checked\) setIgStatus\(''\)/, 'instafidget-social#3: ticking the box must clear the stale "please tick it" status text');
});

test('instafidget-social#4: status text always writes into the Instagram-modal panel that is actually visible', () => {
  const app = fs.readFileSync(APP_JS_PATH, 'utf8');
  const setIgStatusFn = app.match(/function setIgStatus\(msg, isError\) \{[\s\S]*?\n\}/);
  assert.ok(setIgStatusFn, 'locate setIgStatus');
  assert.match(
    setIgStatusFn[0],
    /connectedInstagramEmbedUrl\(\)\s*\?\s*\$\('ig-editor-status'\)\s*:\s*\$\('ig-status'\)/,
    'instafidget-social#4: setIgStatus must pick #ig-editor-status when the connected panel is showing, #ig-status otherwise — never hardcode the connect-panel element'
  );
});

test('images-media#5: isHeicFile() detects HEIC by MIME type and by extension, and never flags an ordinary photo', () => {
  const app = fs.readFileSync(APP_JS_PATH, 'utf8');
  const isHeicFn = app.match(/function isHeicFile\(file\) \{[\s\S]*?\n\}/);
  assert.ok(isHeicFn, 'locate isHeicFile');
  assert.match(app, /const HEIC_UNSUPPORTED_MESSAGE = '[^']*HEIC[^']*iPhone[^']*';/, 'the HEIC message constant must exist and mention iPhone (the repro device)');

  const resizeFn = app.match(/function resizeImageToDataUrl\(file, maxPx, quality\) \{[\s\S]*?\n\}\n\n\/\/ ---/);
  assert.ok(resizeFn, 'locate resizeImageToDataUrl');
  assert.match(resizeFn[0], /isHeicFile\(file\)/, 'resizeImageToDataUrl must reject HEIC files before attempting to decode them');

  // eslint-disable-next-line no-new-func
  const isHeicFile = new Function(isHeicFn[0] + '\nreturn isHeicFile;')();
  assert.equal(isHeicFile({ type: 'image/heic', name: 'IMG_0001.HEIC' }), true, 'the standard iOS MIME type must be detected');
  assert.equal(isHeicFile({ type: 'image/heif', name: 'photo.heif' }), true, 'the HEIF sibling format must be detected too');
  assert.equal(isHeicFile({ type: '', name: 'IMG_0002.heic' }), true, 'a blank/generic MIME type must fall back to the file extension');
  assert.equal(isHeicFile({ type: 'image/jpeg', name: 'photo.jpg' }), false, 'an ordinary JPEG must never be flagged as HEIC');
  assert.equal(isHeicFile({ type: 'image/png', name: 'logo.png' }), false, 'an ordinary PNG must never be flagged as HEIC');
  assert.equal(isHeicFile(null), false, 'a missing file must not throw');
});
