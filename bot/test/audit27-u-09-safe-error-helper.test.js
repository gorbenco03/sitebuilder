'use strict';
/**
 * Oracle for PLAN-AUDIT-2026-09-27.md task U-09
 * (PLAN-UX-2026-09-27.md §5.8 / §4 row "Un helper comun mesaj de eroare
 * sigur de afișat").
 *
 * builder/app.js used to scatter `showToast('…: ' + e.message)` /
 * `err.message || fallback` at each apiGet/apiPost/apiDelete call site. A
 * raw browser fetch failure (offline, DNS, a dropped connection — always an
 * English `TypeError: Failed to fetch`) or a 5xx body with no safe text
 * could reach the customer verbatim, in English, in a 100% Romanian
 * product. safeServerMessage(e, fallbackRo) is now the one place that
 * decides what is safe to show: a 4xx the server marked `fromServer` is
 * shown as written (a deliberate refusal); a 5xx, a raw network/timeout
 * failure, or anything without a server-authored message falls back to the
 * caller's Romanian text instead.
 *
 * This oracle drives a real, isolated server + Chromium, intercepts the
 * network layer itself (Playwright route interception — not a stub), and
 * checks the three surfaces the task names: autosave (save), publish, and
 * export. For each it fails a request two ways — an aborted request
 * (fetch()'s own network failure, no server involved) and a real 500
 * response with an empty body (server responded, no usable message) — and
 * asserts the UI shows only the fixed Romanian fallback, never the raw
 * browser/English text.
 *
 * It fails on the pre-fix code (raw `e.message` reaching the toast/save
 * indicator) and passes once every checked call site routes through
 * safeServerMessage().
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-u-09-safe-error-helper.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-u09-data-'));
process.env.SERVER_SECRET = 'audit27-u09-' + crypto.randomBytes(8).toString('hex');
process.env.HIDOOK_TEST_PAY = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.NODE_ENV = process.env.NODE_ENV === 'production' ? 'test' : (process.env.NODE_ENV || 'test');
delete process.env.PUBLIC_URL;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.CLOUDFLARE_API_TOKEN;
delete process.env.VERCEL_TOKEN;
delete process.env.HIDOOK_FAKE_DEPLOY;

const SHOT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-u09-shots-'));

function loadPlaywright() {
  const candidates = [
    path.join(ROOT, 'node_modules/playwright'),
    '/Users/Work/.hermes/hermes-agent/node_modules/playwright',
  ];
  for (const cand of candidates) {
    try { return require(cand); } catch (_) {}
  }
  throw new Error('playwright not found');
}

// Any bare English technical string a raw browser/network failure could
// leak (fetch's own TypeError text, a bare JS exception, an HTML/AWS error
// page fragment) -- none of this may ever appear in a shown message.
const ENGLISH_LEAK_RE = /Failed to fetch|NetworkError|Load failed|net::ERR_|Unexpected token|TypeError|is not defined|\[object Object\]|Internal Server Error|Bad Gateway/i;

require(path.join(ROOT, 'scripts', 'build-builder.js'));
const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
const { onStripeEvent } = require(path.join(ROOT, 'bot', 'web.js'));

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

async function closeDrawerIfOpen(page) {
  const drawer = page.locator('#details-drawer');
  if (await drawer.isVisible().catch(() => false)) {
    await page.locator('#btn-close-drawer').click().catch(() => {});
    await page.waitForTimeout(300);
  }
}

/** New signed-in editor session with a real bound draft (siteId assigned via
 * a genuine, unintercepted POST /api/draft) so autosave/publish/export all
 * have something to act on before any route interception starts. */
async function newSignedInEditorPage(browser, emailLocal) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.setDefaultTimeout(20000);
  await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
  if (await page.locator('#hb-cookie-accept').isVisible().catch(() => false)) {
    await page.locator('#hb-cookie-accept').click().catch(() => {});
  }
  await page.locator('.template-card[data-template-id="product-menu"] .btn-start-tpl').click();
  await page.waitForURL(/#edit$/, { timeout: 30000 }).catch(() => {});
  await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(400);
  await closeDrawerIfOpen(page);

  await page.locator('#btn-account-menu').click();
  await page.locator('#account-menu-projects').click();
  await page.waitForURL(/#dashboard$/);
  await page.locator('#btn-dashboard-auth').click();
  await page.locator('#form-auth-email').waitFor({ state: 'visible' });
  await page.locator('#input-email').fill(emailLocal + '@example.test');
  await page.locator('#btn-send-magic').click();
  await page.locator('#dev-link').waitFor({ state: 'visible' });
  await page.locator('#dev-link').click();
  await page.waitForURL(/#edit$/);
  await page.locator('#preview-iframe').waitFor({ state: 'visible' });
  await page.waitForTimeout(400);
  await closeDrawerIfOpen(page);

  // Bind a real siteId with an unintercepted save, so the failures tested
  // below are the SECOND request against each endpoint, not the first. A
  // unique business name keeps each test's auto-derived slug from
  // colliding with another test's site in this same shared DATA_DIR, and
  // the returned id/slug are stored exactly where runServerAutosave()
  // itself would store them, so ensureDraftSiteForInstagram() (used by the
  // Instagram flow below) finds this site already bound instead of trying
  // to publish a second, colliding one.
  await page.evaluate(async (uniqueName) => {
    draft.config.business = draft.config.business || {};
    draft.config.business.name = uniqueName;
    const saved = await apiPost('/api/draft', { templateId: draft.templateId, config: draft.config });
    currentSiteId = saved.site.id;
    publishedSiteId = saved.site.id;
    currentSitePaid = !!saved.site.paid;
    if (saved.site.slug) currentSiteSlug = saved.site.slug;
    saveDraft();
  }, emailLocal + '-' + Date.now());
  return page;
}

test('U-09: autosave shows the Romanian fallback (never raw text) on a network failure and on a bodyless 500', async () => {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await newSignedInEditorPage(browser, 'u09-autosave');

    // --- network failure: fetch() itself never reaches the server ---
    await page.route('**/api/draft', (route) => route.abort('failed'));
    await page.evaluate(() => {
      draft.config.business = draft.config.business || {};
      draft.config.business.name = 'U09 Autosave Network ' + Date.now();
      runServerAutosave();
    });
    await page.waitForFunction(() => {
      const el = document.getElementById('save-status');
      return el && el.dataset.state === 'error';
    }, { timeout: 10000 });
    await page.screenshot({ path: path.join(SHOT_DIR, '01-autosave-network-failure-error-state.png') }).catch(() => {});
    let title = await page.locator('#save-status').getAttribute('title');
    assert.ok(title && title.length > 0, 'autosave error state must carry an explanatory message');
    assert.doesNotMatch(title, ENGLISH_LEAK_RE, 'autosave network failure must not leak raw browser/English text: "' + title + '"');
    assert.match(title, /verifică conexiunea/i, 'a genuine network failure fallback must include the connectivity next step: "' + title + '"');
    await page.unroute('**/api/draft');

    // --- server responded, but a 5xx with an empty body ---
    await page.route('**/api/draft', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '' }));
    await page.evaluate(() => {
      draft.config.business.name = 'U09 Autosave 500 ' + Date.now();
      runServerAutosave();
    });
    await page.waitForFunction(() => {
      const el = document.getElementById('save-status');
      return el && el.dataset.state === 'error';
    }, { timeout: 10000 });
    await page.screenshot({ path: path.join(SHOT_DIR, '02-autosave-500-nobody-error-state.png') }).catch(() => {});
    title = await page.locator('#save-status').getAttribute('title');
    assert.ok(title && title.length > 0, 'autosave 500 error state must carry an explanatory message');
    assert.doesNotMatch(title, ENGLISH_LEAK_RE, 'autosave bodyless 500 must not leak raw browser/English text: "' + title + '"');
    await page.unroute('**/api/draft');
  } finally {
    await browser.close();
  }
});

test('U-09: publish shows the Romanian fallback (never raw text) on a network failure and on a bodyless 500', async () => {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await newSignedInEditorPage(browser, 'u09-publish');

    // --- network failure ---
    await closeDrawerIfOpen(page);
    await page.route('**/api/publish', (route) => route.abort('failed'));
    await page.locator('#btn-publish').click();
    await page.locator('#modal-publish').waitFor({ state: 'visible' });
    await page.locator('#input-slug').fill('u09-publish-net-' + crypto.randomBytes(3).toString('hex'));
    await page.locator('#btn-publish-continue').click();
    await page.locator('#toast').waitFor({ state: 'visible', timeout: 10000 });
    await page.screenshot({ path: path.join(SHOT_DIR, '03-publish-network-failure-toast.png') }).catch(() => {});
    let toastText = (await page.locator('#toast').textContent() || '').trim();
    assert.ok(toastText.length > 0, 'publish network failure must show a toast');
    assert.doesNotMatch(toastText, ENGLISH_LEAK_RE, 'publish network failure must not leak raw browser/English text: "' + toastText + '"');
    assert.match(toastText, /publicarea a eșuat/i, 'publish network failure must keep the fixed Romanian fallback: "' + toastText + '"');
    await page.unroute('**/api/publish');

    // --- server responded, but a 5xx with an empty body ---
    await page.route('**/api/publish', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '' }));
    await page.locator('#btn-publish-continue').click();
    await page.waitForTimeout(500);
    await page.locator('#toast').waitFor({ state: 'visible', timeout: 10000 });
    await page.screenshot({ path: path.join(SHOT_DIR, '04-publish-500-nobody-toast.png') }).catch(() => {});
    toastText = (await page.locator('#toast').textContent() || '').trim();
    assert.ok(toastText.length > 0, 'publish bodyless 500 must show a toast');
    assert.doesNotMatch(toastText, ENGLISH_LEAK_RE, 'publish bodyless 500 must not leak raw browser/English text: "' + toastText + '"');
    assert.match(toastText, /publicarea a eșuat/i, 'publish bodyless 500 must keep the fixed Romanian fallback: "' + toastText + '"');
    await page.unroute('**/api/publish');
  } finally {
    await browser.close();
  }
});

test('U-09: export (Descarcă HTML) shows the Romanian fallback (never raw text) on a network failure and on a bodyless 500', async () => {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await newSignedInEditorPage(browser, 'u09-export');

    // --- network failure on the export endpoint itself ---
    await closeDrawerIfOpen(page);
    await page.route('**/api/export-html*', (route) => route.abort('failed'));
    await page.locator('#btn-download-html').click();
    await page.locator('#toast').waitFor({ state: 'visible', timeout: 10000 });
    await page.screenshot({ path: path.join(SHOT_DIR, '05-export-network-failure-toast.png') }).catch(() => {});
    let toastText = (await page.locator('#toast').textContent() || '').trim();
    assert.ok(toastText.length > 0, 'export network failure must show a toast');
    assert.doesNotMatch(toastText, ENGLISH_LEAK_RE, 'export network failure must not leak raw browser/English text: "' + toastText + '"');
    await page.unroute('**/api/export-html*');

    // --- server responded, but a 5xx with an empty body ---
    await page.route('**/api/export-html*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '' }));
    await page.waitForTimeout(300);
    await page.locator('#btn-download-html').click();
    await page.waitForTimeout(500);
    await page.locator('#toast').waitFor({ state: 'visible', timeout: 10000 });
    await page.screenshot({ path: path.join(SHOT_DIR, '06-export-500-nobody-toast.png') }).catch(() => {});
    toastText = (await page.locator('#toast').textContent() || '').trim();
    assert.ok(toastText.length > 0, 'export bodyless 500 must show a toast');
    assert.doesNotMatch(toastText, ENGLISH_LEAK_RE, 'export bodyless 500 must not leak raw browser/English text: "' + toastText + '"');
    await page.unroute('**/api/export-html*');
  } finally {
    await browser.close();
  }
});

// This one is the causal RED/GREEN: connectInstagram()'s old catch was
// `setIgStatus(e.message || '…', true)` with NO fromServer/status gate at
// all — a raw fetch() network failure throws a TypeError whose .message
// ("Failed to fetch" in Chromium) is truthy, so the pre-fix code showed
// that exact English browser string to the customer. The other three
// oracles above cover call sites (doActualPublish, the export fallbacks)
// that already had a correct inline gate before this task and so pass on
// both old and new code; this one demonstrably fails on the pre-fix source
// and passes once connectInstagram() routes through safeServerMessage().
test('U-09: Instagram connect shows the Romanian fallback, never the raw "Failed to fetch" browser text, on a network failure', async () => {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await newSignedInEditorPage(browser, 'u09-instagram');
    await closeDrawerIfOpen(page);

    await page.route('**/social-feed/grant*', (route) => route.abort('failed'));

    await page.locator('#btn-add-instagram').click();
    await page.locator('#modal-instagram').waitFor({ state: 'visible' });
    await page.locator('#ig-terms-check').check();
    await page.locator('#btn-ig-connect').click();

    await page.waitForFunction(() => {
      const el = document.getElementById('ig-status');
      return el && el.textContent && el.textContent.trim().length > 0;
    }, { timeout: 10000 });
    await page.screenshot({ path: path.join(SHOT_DIR, '07-instagram-connect-network-failure.png') }).catch(() => {});
    const statusText = (await page.locator('#ig-status').textContent() || '').trim();
    assert.ok(statusText.length > 0, 'Instagram connect network failure must show a status message');
    assert.doesNotMatch(statusText, ENGLISH_LEAK_RE, 'Instagram connect network failure must not leak raw browser/English text (the historical "Failed to fetch" leak): "' + statusText + '"');
    assert.match(statusText, /nu am putut conecta instagram/i, 'Instagram connect network failure must keep the fixed Romanian fallback: "' + statusText + '"');
    await page.unroute('**/social-feed/grant*');
  } finally {
    await browser.close();
  }
});
