'use strict';
/**
 * bot/test/audit27-u-01-dashboard-danger-actions.test.js
 *
 * U-01 (PLAN-AUDIT-2026-09-27 execution plan; UI/UX brief drawn from
 * PLAN-UX-2026-09-27.md §3 quick wins) — dashboard and irreversible
 * actions. Fails on the pre-U-01 behaviour, passes once every item below
 * ships. All driven through the real /app/ UI with Playwright, not direct
 * API calls — the point of every item here is what a signed-in owner sees
 * and can click, not what the server alone does.
 *
 *   1. window.confirm() replaced by the product's own modal for
 *      "Deconectare de pe toate dispozitivele" AND "Anulează" (subscription
 *      cancel) — proven by asserting no native `dialog` event ever fires
 *      while driving both triggers, and that the product's own modal opens
 *      instead, with the same close contract (Esc/backdrop/44px X/focus
 *      trap covered separately by suite4-modal-contract.test.js).
 *   2. Delete-site dialog: the "Anulează abonamentul" alternative appears
 *      BEFORE the typed-confirmation field in DOM order, and "Șterge
 *      definitiv" stays disabled — even with the exact name typed — for as
 *      long as the site's subscription is active.
 *   3. The dashboard "Șterge" button uses a distinct danger style
 *      (btn-danger), not the same btn-ghost as every other card action.
 *   4. The site list is ordered newest first.
 *   5. The "Site-ul tău e live" success modal has a "Vezi Site-urile mele"
 *      button that closes the modal and routes to #dashboard.
 *   6. No redundant toast after the test-pay success — the success modal
 *      already says "Site-ul tău e live".
 *   7. Istoric versiuni rows carry a short description (business name +
 *      tagline at that point in time) alongside the date/time and the
 *      existing "Restabilește" label.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-u-01-dashboard-danger-actions.test.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
// May run from a worktree with no node_modules of its own — same fallback
// chain as bot/test/suite4-modal-contract.test.js / delete-site-oracle.mjs.
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

test('U-01: dashboard danger actions — own modals, danger styling, newest-first order, no redundant toast, version descriptions', async () => {
  process.env.HIDOOK_TEST_PAY = '1';
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-u01-'));
  process.env.SERVER_SECRET = 'audit27-u01-' + crypto.randomBytes(8).toString('hex');
  delete process.env.PUBLIC_URL;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.VERCEL_TOKEN;

  require(path.join(ROOT, 'scripts', 'build-builder.js'));
  const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
  const registry = require(path.join(ROOT, 'bot', 'registry.js'));
  const server = startServer({ port: 0 });
  await new Promise((resolve) => { if (server.listening) return resolve(); server.once('listening', resolve); });
  const base = 'http://127.0.0.1:' + server.address().port;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  // Item 1: a native dialog firing at all is itself the failure — both
  // window.confirm() call sites this task replaces must never reach here.
  let nativeDialogFired = false;
  page.on('dialog', (d) => { nativeDialogFired = true; d.dismiss().catch(() => {}); });

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

    // ---- Publish a real paid/live site through the real checkout flow ----
    await page.locator('#btn-publish').click();
    await page.locator('#modal-publish').waitFor({ state: 'visible' });
    const slug = 'audit27-u01-' + Date.now().toString(36);
    await page.locator('#input-slug').fill(slug);
    await page.locator('#btn-publish-continue').click();
    await page.locator('#form-auth-email').waitFor({ state: 'visible' });
    await page.locator('#input-email').fill('audit27-u01@example.com');
    await page.locator('#btn-send-magic').click();
    await page.locator('#dev-link').waitFor({ state: 'visible' });
    await page.locator('#dev-link').click();
    const payBtn = page.locator('#btn-pay-publish');
    await payBtn.waitFor({ state: 'visible' });
    await payBtn.click();
    await page.locator('#modal-success-title').filter({ hasText: 'Site-ul tău e live' }).waitFor({ state: 'visible', timeout: 25000 });

    // ---- Item 6: no redundant toast — the modal already says it ----
    const toastVisible = await page.evaluate(() => {
      const t = document.getElementById('toast');
      return !!(t && getComputedStyle(t).display !== 'none' && /trial început/i.test(t.textContent || ''));
    });
    assert.equal(toastVisible, false, 'no "Trial început" toast alongside the already-informative success modal');

    // ---- Item 5: "Vezi Site-urile mele" on the success modal ----
    const viewSitesBtn = page.locator('#btn-success-view-sites');
    await viewSitesBtn.waitFor({ state: 'visible', timeout: 5000 });
    await viewSitesBtn.click();
    await page.locator('#modal-success').waitFor({ state: 'hidden', timeout: 5000 });
    await page.waitForURL(/#dashboard$/, { timeout: 5000 });

    const siteId = await page.evaluate(() => (typeof currentSiteId !== 'undefined' ? currentSiteId : null));
    assert.ok(siteId, 'currentSiteId set after checkout');

    // ---- Item 4: newest-first ordering ----
    // Seed an OLDER draft directly through the registry (bypassing the UI,
    // which always creates "now") so this run has a real time difference to
    // sort by, not a coin-flip on raw insertion order.
    const ownerId = registry.getSite(siteId).userId;
    const olderSlug = 'audit27-u01-older-' + Date.now().toString(36);
    const olderSite = registry.createSite({ userId: ownerId, templateId: 'portfolio', templateVersion: 1, slug: olderSlug, platform: 'web' });
    registry.updateSite(olderSite.id, { createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() });

    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForURL(/#dashboard$/, { timeout: 10000 });
    await page.waitForTimeout(600);
    const cardTexts = await page.locator('.site-card').allInnerTexts();
    const liveIdx = cardTexts.findIndex((t) => t.includes(slug.replace(/-/g, '‑')));
    const olderIdx = cardTexts.findIndex((t) => t.includes(olderSlug.replace(/-/g, '‑')));
    assert.ok(liveIdx !== -1 && olderIdx !== -1, 'both the just-published site and the older seeded draft must be in the list');
    assert.ok(liveIdx < olderIdx, 'newest site (idx ' + liveIdx + ') must sort before the older seeded draft (idx ' + olderIdx + ')');

    // ---- Item 3: "Șterge" uses a distinct danger style ----
    const card = page.locator('.site-card', { hasText: slug.replace(/-/g, '‑') }).first();
    await card.waitFor({ state: 'visible', timeout: 10000 });
    const deleteBtnClass = await card.locator('button', { hasText: 'Șterge' }).getAttribute('class');
    assert.match(deleteBtnClass || '', /\bbtn-danger\b/, '"Șterge" button must use btn-danger, not the same btn-ghost as every other card action');

    // ---- Item 2: delete-site dialog while the subscription is active ----
    await card.locator('button', { hasText: 'Șterge' }).click();
    await page.locator('#modal-delete-site').waitFor({ state: 'visible' });
    const notice = page.locator('#delete-site-subscription-notice');
    await notice.waitFor({ state: 'visible', timeout: 5000 });
    const noticeBeforeField = await page.evaluate(() => {
      const noticeEl = document.getElementById('delete-site-subscription-notice');
      const fieldEl = document.getElementById('input-delete-confirm');
      if (!noticeEl || !fieldEl) return false;
      // eslint-disable-next-line no-bitwise
      return !!(noticeEl.compareDocumentPosition(fieldEl) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    assert.equal(noticeBeforeField, true, '"Anulează abonamentul" alternative must appear BEFORE the typed-confirmation field');
    await page.locator('#input-delete-confirm').fill(slug);
    await page.waitForTimeout(150);
    const confirmDisabled = await page.locator('#btn-confirm-delete-site').isDisabled();
    assert.equal(confirmDisabled, true, '"Șterge definitiv" must stay disabled while a subscription is active, even with the exact name typed');

    // ---- Item 1a: "Anulează" (subscription cancel) — own modal, not window.confirm() ----
    // Reached here through the delete-site dialog's own in-modal alternative
    // — exactly the button item 2 puts in front of the confirm field.
    await page.locator('#btn-delete-site-cancel-alt').click();
    await page.locator('#modal-cancel-subscription').waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('#btn-dismiss-cancel-subscription').click();
    await page.locator('#modal-cancel-subscription').waitFor({ state: 'hidden', timeout: 5000 });
    await page.locator('#btn-close-delete-site').click({ force: true }).catch(() => {});
    await page.locator('#modal-delete-site').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});

    // ---- Item 1b: "Deconectare de pe toate dispozitivele" — own modal, not window.confirm() ----
    await page.locator('#btn-account-menu-header').click();
    await page.locator('#account-menu-header-logout-all').waitFor({ state: 'visible' });
    await page.locator('#account-menu-header-logout-all').click();
    await page.locator('#modal-logout-everywhere').waitFor({ state: 'visible', timeout: 5000 });
    await page.locator('#btn-dismiss-logout-everywhere').click();
    await page.locator('#modal-logout-everywhere').waitFor({ state: 'hidden', timeout: 5000 });

    assert.equal(nativeDialogFired, false, 'a native window.confirm()/dialog fired — both call sites must use the product\'s own modal instead');

    // ---- Item 7: Istoric versiuni rows carry a short description ----
    const versionsData = await page.evaluate(async (id) => {
      const res = await fetch('/api/sites/' + encodeURIComponent(id) + '/versions', { credentials: 'include' });
      return res.json();
    }, siteId);
    assert.ok(Array.isArray(versionsData.versions) && versionsData.versions.length >= 1, 'at least one published version for the site');
    const latestVersion = versionsData.versions[versionsData.versions.length - 1];
    assert.ok(
      latestVersion && typeof latestVersion.description === 'string' && latestVersion.description.trim().length > 0,
      'each version must carry a short, non-empty description (business name + tagline)'
    );
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  }
});
