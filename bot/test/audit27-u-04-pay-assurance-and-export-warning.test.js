'use strict';
/**
 * bot/test/audit27-u-04-pay-assurance-and-export-warning.test.js
 *
 * U-04 (PLAN-UX-2026-09-27.md §4, rows "Text de asigurare lângă butonul de
 * plată" and "Avertisment înainte de export cu programare online activă").
 *
 * Two independent defects, one oracle:
 *
 * 1. Nothing next to "Adaugă un card" told the customer, at the decision
 *    moment, that nothing is charged today and that they can cancel anytime
 *    from "Site-urile mele" — that trust text only lived in Termeni. Fails
 *    on the old markup (#pay-assurance does not exist / stays hidden next to
 *    #btn-pay-publish); passes once it shows with the real price/renewal
 *    from /api/config (formatMoneyLabel), never the literal "—" placeholder.
 *
 * 2. Clicking "Descarcă HTML"/"Descarcă ZIP" while appointment.nativeBooking
 *    is on used to go straight into the download with no warning, even
 *    though bot/site-export.js#buildStaticSiteTree (since 28f2832) silently
 *    turns native booking off in every offline export and falls back to the
 *    local request-form. Fails on the old handler (clicking the button while
 *    signed out shows the "Intră în cont" toast immediately, no modal ever
 *    appears); passes once a product modal (#modal-export-booking, not
 *    window.confirm) explains it first and only proceeds to the real
 *    download on "Continuă descărcarea" — "Renunță" must leave with no
 *    download attempted at all.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-u-04-pay-assurance-and-export-warning.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const PW_CANDIDATES = [
  path.join(ROOT, 'node_modules', 'playwright'),
  '/Users/Work/Desktop/sitebuilder/node_modules/playwright',
  '/Users/Work/.hermes/hermes-agent/node_modules/playwright',
];
let chromium;
for (const cand of PW_CANDIDATES) {
  try { ({ chromium } = require(cand)); break; } catch (_) {}
}
if (!chromium) throw new Error('playwright not found; install or link node_modules/playwright');

// PLAN-UX §5.4 (S-4): at this file's 390px touch viewport, #btn-download-html
// moves behind "Mai mult" (builder/app.css, body.mobile-coarse-toolbar) — the
// button still exists and still owns its click handler (MOBILE_MORE_MENU_ITEMS
// in app.js), so reach it the way a real phone now does.
async function clickDownloadHtmlViaMoreMenu(page) {
  await page.locator('#btn-topbar-more').click();
  await page.locator('#topbar-more-menu').waitFor({ state: 'visible' });
  await page.getByRole('menuitem', { name: 'Descarcă HTML' }).click();
}

async function bootServer(tag) {
  process.env.HIDOOK_TEST_PAY = '1';
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-u04-' + tag + '-'));
  process.env.SERVER_SECRET = 'audit27-u04-' + tag + '-' + crypto.randomBytes(8).toString('hex');
  delete process.env.PUBLIC_URL;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.VERCEL_TOKEN;

  delete require.cache[require.resolve(path.join(ROOT, 'bot', 'server.js'))];
  const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
  const server = startServer({ port: 0 });
  await new Promise((resolve) => { if (server.listening) return resolve(); server.once('listening', resolve); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const dataDir = process.env.DATA_DIR;
  return { server, base, dataDir };
}

test('audit27-U-04: pay CTA shows a real nothing-charged-today reassurance line', async (t) => {
  require(path.join(ROOT, 'scripts', 'build-builder.js'));
  const { server, base, dataDir } = await bootServer('pay');
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
  await page.locator('#hb-cookie-accept').click({ timeout: 4000 }).catch(() => {});

  await page.locator('.template-card[data-template-id="professionals"] .btn-start-tpl').click();
  await page.waitForURL(/#edit$/, { timeout: 25000 });
  await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 25000 });
  await page.waitForTimeout(600);
  const drawer = page.locator('#details-drawer');
  if (await drawer.isVisible().catch(() => false)) {
    await page.locator('#btn-close-drawer').click({ timeout: 4000 }).catch(() => {});
  }

  // Drive the real publish -> auth -> pay flow so #btn-pay-publish (and its
  // assurance line) shows exactly as a real customer sees it.
  await page.locator('#btn-publish').click();
  await page.locator('#modal-publish').waitFor({ state: 'visible' });
  const slug = 'audit27-u04-pay-' + Date.now().toString(36);
  await page.locator('#input-slug').fill(slug);
  await page.locator('#btn-publish-continue').click();
  await page.locator('#form-auth-email').waitFor({ state: 'visible' });
  await page.locator('#input-email').fill('audit27-u04-pay@example.com');
  await page.locator('#btn-send-magic').click();
  await page.locator('#dev-link').waitFor({ state: 'visible' });
  await page.locator('#dev-link').click();

  const payBtn = page.locator('#btn-pay-publish');
  await payBtn.waitFor({ state: 'visible' });

  const assurance = page.locator('#pay-assurance');
  await assurance.waitFor({ state: 'visible', timeout: 10000 });

  const [priceText, renewalText, successPriceText] = await Promise.all([
    page.locator('#pay-assurance-price').textContent(),
    page.locator('#pay-assurance-renewal').textContent(),
    page.locator('#success-price').textContent(),
  ]);

  assert.notEqual((priceText || '').trim(), '—', 'assurance price never filled from /api/config');
  assert.notEqual((renewalText || '').trim(), '—', 'assurance renewal never filled from /api/config');
  // Same money formatter as the pay button itself (formatMoneyLabel) — the
  // two must show the exact same price, never a second, drifted formatting.
  assert.equal((priceText || '').trim(), (successPriceText || '').trim(),
    'assurance price does not match the pay button price — not reusing formatMoneyLabel/formatPriceLabel');
  assert.match(priceText || '', /[€$£]/, 'assurance price has no currency symbol');

  const fullText = (await assurance.textContent()) || '';
  assert.match(fullText, /[Nn]imic taxat azi/, 'assurance line does not say nothing is charged today');
  assert.match(fullText, /Site-urile mele/, 'assurance line does not mention cancelling from Site-urile mele');
});

test('audit27-U-04: export with native booking on warns in a product modal before downloading', async (t) => {
  require(path.join(ROOT, 'scripts', 'build-builder.js'));
  const { server, base, dataDir } = await bootServer('export');
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
  await page.locator('#hb-cookie-accept').click({ timeout: 4000 }).catch(() => {});

  await page.locator('.template-card[data-template-id="professionals"] .btn-start-tpl').click();
  await page.waitForURL(/#edit$/, { timeout: 25000 });
  await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 25000 });
  await page.waitForTimeout(600);
  const drawer = page.locator('#details-drawer');
  if (await drawer.isVisible().catch(() => false)) {
    await page.locator('#btn-close-drawer').click({ timeout: 4000 }).catch(() => {});
  }

  // --- Baseline: nativeBooking still OFF (fresh professionals preset) ---
  // Signed out, no warning expected: the old (and still correct, off) path
  // goes straight into downloadDraftHtml(), which shows the "Intră în cont"
  // toast because there is no session yet. This proves the modal is really
  // gated on nativeBooking, not shown unconditionally.
  await clickDownloadHtmlViaMoreMenu(page);
  await page.locator('#toast').waitFor({ state: 'visible', timeout: 5000 });
  const offToast = (await page.locator('#toast').textContent()) || '';
  assert.match(offToast, /cont/i, 'expected the sign-in toast when nativeBooking is off');
  const offModalVisible = await page.locator('#modal-export-booking').isVisible().catch(() => false);
  assert.equal(offModalVisible, false, 'export-booking modal must not appear when nativeBooking is off');

  // --- Turn native booking on via the real Detalii panel ---
  await page.locator('#btn-open-drawer').click();
  await drawer.waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Activează calendarul nativ de programări Hidook' }).click();
  await page.locator('#btn-close-drawer').click({ timeout: 4000 }).catch(() => {});
  await drawer.waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {});

  // --- Click "Descarcă HTML" again: this time the product modal must show
  // FIRST, and the sign-in toast must NOT appear yet (that is the old,
  // unwarned behaviour this oracle fails on). ---
  await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.style.display = 'none'; });
  await clickDownloadHtmlViaMoreMenu(page);
  await page.locator('#modal-export-booking').waitFor({ state: 'visible', timeout: 5000 });
  const modalText = (await page.locator('#modal-export-booking').textContent()) || '';
  assert.match(modalText, /calendarul (nativ )?live e dezactivat automat|calendar.*dezactivat/i,
    'modal does not explain that the live calendar turns off in the export');
  assert.match(modalText, /formularul clasic de cerere/i,
    'modal does not name the local request-form fallback the export actually gets');

  const toastVisibleTooEarly = await page.locator('#toast').isVisible().catch(() => false);
  assert.equal(toastVisibleTooEarly, false, 'the download must not start before the warning is answered');

  // --- "Renunță" must cancel with zero download attempt. ---
  await page.locator('#btn-export-booking-cancel').click();
  await page.locator('#modal-export-booking').waitFor({ state: 'hidden', timeout: 5000 });
  await page.waitForTimeout(400);
  const toastAfterCancel = await page.locator('#toast').isVisible().catch(() => false);
  assert.equal(toastAfterCancel, false, '"Renunță" must not trigger the real download (no sign-in toast should follow)');

  // --- "Continuă descărcarea" must actually call through to the real
  // download path (proven here by the same sign-in toast finally firing,
  // now that the warning was answered). ---
  await clickDownloadHtmlViaMoreMenu(page);
  await page.locator('#modal-export-booking').waitFor({ state: 'visible', timeout: 5000 });
  await page.locator('#btn-export-booking-continue').click();
  await page.locator('#modal-export-booking').waitFor({ state: 'hidden', timeout: 5000 });
  await page.locator('#toast').waitFor({ state: 'visible', timeout: 5000 });
  const continueToast = (await page.locator('#toast').textContent()) || '';
  assert.match(continueToast, /cont/i, '"Continuă descărcarea" did not fall through to the real downloadDraftHtml()');
});
