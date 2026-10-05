'use strict';
/**
 * bot/test/audit27-w-1-reactivate-canceled-site.test.js
 *
 * W-1 (VERIFICARE-2026-10-04 C-01; owner decision 2026-10-05): reactivating a
 * canceled site costs the yearly renewal price (29, with the currency symbol),
 * starts NO new trial, and brings the site back online immediately.
 *
 * Driven through the real /app/ dashboard in a browser, both for a site
 * canceled during its trial (never charged) and one canceled after the first
 * charge:
 *   - the canceled card states "Plătești 29€ acum ... până la <date>" BEFORE any click;
 *   - Reactivează -> checkout is kind=renewal at 2900 cents (never 99, never a trial);
 *   - after the test payment: /live/<slug>/ is 200 again, status live, canceledAt
 *     cleared, paidUntil = max(previous paidUntil, now) + 1 year, card says Activ;
 *   - the post-payment message is a reactivation message, never "Trial început".
 *
 * Fails on the pre-W-1 behavior (renewal paid, site left unpublished/404, toast
 * "Trial început"; trial-canceled card offering a fresh trial).
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-w-1-reactivate-canceled-site.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
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

test('W-1: reactivating a canceled site pays 29, no new trial, site live again immediately', async () => {
  process.env.HIDOOK_TEST_PAY = '1';
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-w1-'));
  process.env.SERVER_SECRET = 'audit27-w1-' + crypto.randomBytes(8).toString('hex');
  delete process.env.PUBLIC_URL;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.VERCEL_TOKEN;

  require(path.join(ROOT, 'scripts', 'build-builder.js'));
  const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
  const registry = require(path.join(ROOT, 'bot', 'registry.js'));
  const ledger = require(path.join(ROOT, 'bot', 'ledger.js'));
  const server = startServer({ port: 0 });
  await new Promise((resolve) => { if (server.listening) return resolve(); server.once('listening', resolve); });
  const base = 'http://127.0.0.1:' + server.address().port;

  const browser = await chromium.launch({ headless: true });
  const shotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-w1-shots-'));

  async function shot(page, name) {
    await page.screenshot({ path: path.join(shotDir, name + '.png') }).catch(() => {});
  }

  async function runScenario(label, { charged, viewport }) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    try {
      await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
      await page.locator('#hb-cookie-accept').click({ timeout: 4000 }).catch(() => {});
      await page.locator('.template-card[data-template-id="professionals"] .btn-start-tpl').click();
      await page.waitForURL(/#edit$/, { timeout: 25000 });
      await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 25000 });
      await page.waitForTimeout(600);
      const drawer = page.locator('#details-drawer');
      if (await drawer.isVisible().catch(() => false)) {
        await page.locator('#btn-close-drawer').click({ timeout: 4000 }).catch(async () => {
          await page.locator('#btn-close-drawer').click({ force: true }).catch(() => {});
        });
        await drawer.waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {});
      }

      // ---- publish + pay (test card) ----
      await page.locator('#btn-publish').click();
      await page.locator('#modal-publish').waitFor({ state: 'visible' });
      const slug = 'audit27-w1-' + label + '-' + Date.now().toString(36);
      await page.locator('#input-slug').fill(slug);
      await page.locator('#btn-publish-continue').click();
      await page.locator('#form-auth-email').waitFor({ state: 'visible' });
      await page.locator('#input-email').fill('audit27-w1-' + label + '@example.com');
      await page.locator('#btn-send-magic').click();
      await page.locator('#dev-link').waitFor({ state: 'visible' });
      await page.locator('#dev-link').click();
      await page.locator('#btn-pay-publish').waitFor({ state: 'visible' });
      await page.locator('#btn-pay-publish').click();
      await page.locator('#modal-success-title').filter({ hasText: 'Site-ul tău e live' }).waitFor({ state: 'visible', timeout: 25000 });
      await shot(page, label + '-01-after-first-payment');
      await page.locator('#btn-success-view-sites').click();
      await page.waitForURL(/#dashboard$/, { timeout: 5000 });

      const siteId = await page.evaluate(() => (typeof currentSiteId !== 'undefined' ? currentSiteId : null));
      assert.ok(siteId, label + ': currentSiteId set after checkout');
      const liveBefore = await fetch(base + '/live/' + slug + '/');
      assert.equal(liveBefore.status, 200, label + ': site is live after the first payment');

      if (charged) {
        // The day-14 charge happened: the ledger carries a real paid invoice.
        ledger.append({ event: 'invoice', status: 'paid', siteId, orderId: 'ord_w1_charged', kind: 'publish', invoiceId: 'in_w1', amountCents: 9900, currency: 'eur' });
      }

      // ---- cancel through the dashboard's own modal ----
      await page.reload({ waitUntil: 'networkidle' });
      const needle = slug.replace(/-/g, '‑');
      const card = page.locator('.site-card', { hasText: needle }).first();
      await card.waitFor({ state: 'visible', timeout: 10000 });
      await card.locator('button', { hasText: 'Anulează' }).click();
      await page.locator('#modal-cancel-subscription').waitFor({ state: 'visible' });
      await page.locator('#btn-confirm-cancel-subscription').click();
      await page.waitForURL(/#dashboard$/, { timeout: 15000 });
      await page.locator('.site-card', { hasText: needle }).locator('.status-badge', { hasText: 'Anulat' }).waitFor({ timeout: 15000 });
      const canceled = registry.getSite(siteId);
      assert.equal(canceled.status, 'unpublished', label + ': canceled site is unpublished');
      const prevPaidUntil = canceled.paidUntil;
      assert.ok(prevPaidUntil, label + ': canceled site keeps its paidUntil');
      assert.equal((await fetch(base + '/live/' + slug + '/')).status, 404, label + ': canceled site is offline');

      // ---- before the click: price + resulting date, no trial offer ----
      const ccard = page.locator('.site-card', { hasText: needle }).first();
      const noteText = (await ccard.locator('[data-reactivate-note]').innerText()).replace(/\s+/g, ' ').trim();
      // Stacks only on time actually paid for; a trial-canceled site was never charged.
      const expectedIso = registry.addMonthsIso(canceled.paid === true && Date.parse(prevPaidUntil) > Date.now() ? prevPaidUntil : new Date().toISOString(), 12);
      const expectedDate = await page.evaluate((iso) => new Date(iso).toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' }), expectedIso);
      assert.equal(noteText, 'Plătești 29€ acum. Site-ul revine online imediat și e plătit până la ' + expectedDate + '.', label + ': pre-payment note');
      const slugRe = new RegExp(needle, 'g');
      const cardText = await ccard.innerText();
      assert.ok(!/trial/i.test(cardText.replace(slugRe, '')), label + ': a canceled card never offers a (new) trial: ' + cardText);
      assert.ok(!/Adaugă un card/.test(cardText), label + ': no "Adaugă un card" on a canceled card');
      await shot(page, label + '-02-canceled-card-shows-29-and-date');

      // ---- reactivate: checkout is the 29 renewal, never 99 / trial ----
      const checkoutResp = page.waitForResponse((r) => /\/api\/sites\/[^/]+\/checkout$/.test(r.url()) && r.request().method() === 'POST');
      await ccard.locator('button', { hasText: 'Reactivează site-ul' }).click();
      const co = await (await checkoutResp).json();
      assert.equal(co.kind, 'renewal', label + ': reactivation checkout kind');
      assert.equal(co.amountCents, 2900, label + ': reactivation checkout charges the 29 renewal price');
      assert.equal(co.reactivation, true);
      assert.equal(String(co.newPaidUntil).slice(0, 10), expectedIso.slice(0, 10), label + ': checkout previews the same paidUntil the card showed');

      // test-pay returns to #test-checkout=..., completes, and lands on the dashboard
      const toast = page.locator('#toast');
      await toast.filter({ hasText: 'din nou online' }).waitFor({ state: 'visible', timeout: 20000 });
      const toastText = (await toast.innerText()).replace(/\s+/g, ' ');
      assert.ok(!/Trial început/i.test(toastText), label + ': never "Trial început" after a reactivation: ' + toastText);
      assert.ok(toastText.includes(expectedDate), label + ': toast names the paid-until date: ' + toastText);
      await shot(page, label + '-03-after-reactivation-toast');

      // ---- site really is back, live, paid for one more year ----
      const live = await fetch(base + '/live/' + slug + '/');
      assert.equal(live.status, 200, label + ': /live/<slug>/ is 200 again right after payment');
      assert.ok((await live.text()).length > 2000, label + ': the republished site has real content');
      const after = registry.getSite(siteId);
      assert.equal(after.status, 'live', label + ': status live');
      assert.equal(after.paid, true, label + ': paid');
      assert.ok(!after.canceledAt, label + ': canceledAt cleared');
      assert.equal(String(after.paidUntil).slice(0, 10), expectedIso.slice(0, 10), label + ': paidUntil = (paid ? max(previous paidUntil, now) : now) + 1 year');

      await page.waitForURL(/#dashboard$/, { timeout: 10000 });
      const activeCard = page.locator('.site-card', { hasText: needle }).first();
      await activeCard.locator('.status-badge', { hasText: 'Activ' }).waitFor({ timeout: 15000 });
      const activeText = await activeCard.innerText();
      assert.ok(/Hosting până pe/.test(activeText), label + ': card shows Hosting până pe <date>, not a trial line: ' + activeText);
      assert.ok(!/Trial de 14 zile/.test(activeText), label + ': no trial line after reactivation');
      assert.equal(await activeCard.locator('button', { hasText: 'Reactivează' }).count(), 0, label + ': no Reactivează button once live');
      await shot(page, label + '-04-dashboard-live-again');

      const renewalInvoice = (ledger.read() || []).filter((r) => r.siteId === siteId && r.event === 'invoice' && r.kind === 'renewal');
      assert.equal(renewalInvoice.length, 1, label + ': exactly one renewal invoice recorded');
      assert.equal(renewalInvoice[0].amountCents, 2900, label + ': renewal invoice is 29');
    } finally {
      await context.close();
    }
  }

  try {
    await runScenario('early', { charged: false, viewport: { width: 1280, height: 900 } });
    await runScenario('charged', { charged: true, viewport: { width: 390, height: 844 } });
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  }
});
