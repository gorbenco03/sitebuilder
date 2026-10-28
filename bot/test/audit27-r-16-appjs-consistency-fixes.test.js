'use strict';
/**
 * bot/test/audit27-r-16-appjs-consistency-fixes.test.js
 *
 * AUDIT 2026-09-27 - R-16 + R-23 (builder/app.js consistency fixes;
 * PLAN-AUDIT-2026-09-27.md section 4, round 3).
 *
 * Owner decision 2026-09-27: the currency symbol comes back everywhere a
 * price shows (landing, dashboard card, Facturi; the success modal's pay button went with the form editor) - ONE
 * formatter, not several drifting apart (gap-pricing-display-consistency-live#1/#2).
 * Also kept: one Romanian date formatter for Facturi and the site card
 * (copy-i18n#4) and "Proiectele mele" -> "Site-urile mele" (copy-i18n#1).
 *
 * Form editor removed 2026-10-28: the browser repros (Detalii drawer Escape
 * focus, slug field select-on-focus / slug-check failure state, GIF/SVG/HEIC
 * logo upload and publish) and the Instagram modal / HEIC helper source checks
 * lived only in the deleted editor and were dropped. The price and date
 * formatters and the RO copy catalog still live in builder/app.js and
 * builder/copy-ro.js.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-r-16-appjs-consistency-fixes.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const APP_JS_PATH = path.join(ROOT, 'builder', 'app.js');

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

  // The offending strings the audit found must stay gone.
  const mustNotContain = [
    'Autentifică-te ca să vezi proiectele',
    'Autentifică-te ca să-ți vezi proiectele',
  ];
  for (const s of mustNotContain) {
    assert.ok(!app.includes(s), 'stale "proiect" copy must be gone: "' + s + '"');
  }

  // The renamed copy lives in the RO catalog (builder/copy-ro.js); app.js
  // references it by key. Only keys the surviving surfaces use (sign-in modal
  // title, dashboard auth-required state) are checked; the rest went with the
  // form editor.
  const mustContain = [
    'RO.DASHBOARD_AUTH_REQUIRED_TITLE', // 'Autentifică-te ca să vezi site-urile'
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
    AUTH_TITLE_VIEW_SITES: 'Autentifică-te ca să-ți vezi site-urile',
  };
  for (const [key, expectedStartsWith] of Object.entries(mustContainText)) {
    assert.ok(!/roiect/.test(roSandbox.RO[key]), 'RO.' + key + ' must not say "proiect": "' + roSandbox.RO[key] + '"');
    assert.ok(roSandbox.RO[key].includes(expectedStartsWith), 'RO.' + key + ' lost its renamed "site" copy: "' + roSandbox.RO[key] + '"');
  }

  // No customer-facing "proiect" wording is left in app.js at all.
  const proiectMatches = [...app.matchAll(/proiect/gi)].map((m) => app.slice(Math.max(0, m.index - 60), m.index + 20));
  assert.deepEqual(proiectMatches, [], 'unexpected leftover "proiect" in app.js');
});
