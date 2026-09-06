'use strict';
/**
 * bot/test/wave5-local-service-list-add-remove.test.js — LS-02 regression gate.
 *
 * Audit finding (04-QA-Evidence/Audit-2026-09-06-2225ca7/template-local-service,
 * id LS-02, severity medium, effort L — the biggest open item on this
 * template): add/remove for services, "De ce noi" points, portfolio
 * categories and certifications was completely disconnected from the UI.
 * The mechanism existed in builder/app.js (onListAdd/onListRemove) but
 * nothing in the rendered template ever emitted a control that could send
 * {hb:'list-add'}/{hb:'list-remove'}, so an owner was stuck forever with
 * exactly the preset's item count.
 *
 * templates/local-service/script.js now injects its own "+ Adaugă" / "×"
 * controls (initEditableLists()) that speak the same postMessage protocol
 * builder/app.js already handles unconditionally — independent of
 * builder/edit-overlay.js's SAFE_LIST_PATHS whitelist (which still omits
 * "certifications" and "trust"; see HANDOFF-local-service.md). New items
 * are seeded with real Romanian placeholder text (never "New item") as
 * soon as they render empty, via the same {hb:'text'} protocol.
 *
 * This oracle drives the real browser editor end to end: add a service,
 * a portfolio category and a certification; verify each appears with
 * non-empty Romanian text and the count increases; remove one item back
 * out; then publish and confirm the added service survives onto the live
 * site.
 *
 * Run: HIDOOK_TEST_PAY=1 HIDOOK_ISOLATED_DEPLOY=1 \
 *   node --experimental-sqlite --test bot/test/wave5-local-service-list-add-remove.test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE_DIR = path.join(ROOT, '04-QA-Evidence', 'Wave5-local-service', 'add-remove');

async function main() {
  process.env.HIDOOK_TEST_PAY = '1';
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wave5-ls-listaddrm-'));
  process.env.SERVER_SECRET = 'wave5-ls-' + crypto.randomBytes(12).toString('hex');
  delete process.env.PUBLIC_URL;
  delete process.env.HIDOOK_FAKE_DEPLOY;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;

  require(path.join(ROOT, 'scripts', 'build-builder.js'));
  const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));
  const server = startServer({ port: 0 });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const base = 'http://127.0.0.1:' + server.address().port;

  fs.rmSync(EVIDENCE_DIR, { recursive: true, force: true });
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: process.env.HIDOOK_E2E_HEADLESS !== '0' });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();

  try {
    await page.goto(base + '/app/', { waitUntil: 'networkidle' });
    await page.locator('#hb-cookie-accept').click();
    await page.locator('.template-card[data-template-id="local-service"] .btn-start-tpl').click();
    await page.waitForURL(/#edit$/);

    const frame = page.frameLocator('#preview-iframe');
    await frame.locator('body').waitFor({ state: 'visible' });
    // Auto-open Details drawer covers the preview initially — close it so the
    // full page (and the injected +/- controls) is interactable.
    const closeDrawer = page.locator('#btn-close-drawer');
    if (await closeDrawer.isVisible().catch(() => false)) await closeDrawer.click();

    async function countAndReadLast(itemSelector, textSelector) {
      const items = frame.locator(itemSelector);
      const count = await items.count();
      const lastText = count > 0 ? (await items.nth(count - 1).locator(textSelector).first().textContent()) : null;
      return { count, lastText: lastText ? lastText.trim() : null };
    }

    // --- Services: add then remove -------------------------------------------
    // Uses this template's own .hb-ls-add/.hb-ls-remove controls (see
    // script.js's initEditableLists — the generic overlay's equivalent
    // controls for "services" are removed on sight, see the same comment).
    const servicesBefore = await countAndReadLast('.service-card', '.ls-punch__label');
    await frame.locator('.service-card').first().scrollIntoViewIfNeeded();
    await frame.locator('.service-card').last()
      .locator('xpath=following-sibling::button[contains(@class,"hb-ls-add")][1]').click();
    await page.waitForTimeout(600); // full re-render round trip (srcdoc reload)
    await frame.locator('.service-card').first().waitFor({ state: 'visible' });

    const servicesAfterAdd = await countAndReadLast('.service-card', '.ls-punch__label');
    assert.equal(servicesAfterAdd.count, servicesBefore.count + 1, 'adding a service must increase the count by exactly one');
    assert.ok(servicesAfterAdd.lastText, 'new service must render with visible, non-empty text');
    assert.notEqual(servicesAfterAdd.lastText.toLowerCase(), 'new item', 'placeholder must not be the literal "New item"');
    assert.match(servicesAfterAdd.lastText, /serviciu nou/i, 'new service should carry the Romanian placeholder text');
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '01-service-added.png') });

    await frame.locator('.service-card').nth(servicesAfterAdd.count - 1).locator('.hb-ls-remove').click();
    await page.waitForTimeout(600);
    const servicesAfterRemove = await countAndReadLast('.service-card', '.ls-punch__label');
    assert.equal(servicesAfterRemove.count, servicesBefore.count, 'removing the just-added service must restore the original count');

    // --- Portfolio categories: add then remove --------------------------------
    const catsBefore = await countAndReadLast('.ls-work', '.ls-work__t');
    await frame.locator('.ls-work').first().scrollIntoViewIfNeeded();
    await frame.locator('.ls-work').last()
      .locator('xpath=following-sibling::button[contains(@class,"hb-ls-add")][1]').click();
    await page.waitForTimeout(600);
    await frame.locator('.ls-work').first().waitFor({ state: 'visible' });
    const catsAfterAdd = await countAndReadLast('.ls-work', '.ls-work__t');
    assert.equal(catsAfterAdd.count, catsBefore.count + 1, 'adding a portfolio category must increase the count by exactly one');
    assert.ok(catsAfterAdd.lastText, 'new category must render with visible, non-empty text');
    assert.match(catsAfterAdd.lastText, /categorie de lucrări nouă/i, 'new category should carry the Romanian placeholder text');

    await frame.locator('.ls-work').nth(catsAfterAdd.count - 1).locator('.hb-ls-remove').click();
    await page.waitForTimeout(600);
    const catsAfterRemove = await countAndReadLast('.ls-work', '.ls-work__t');
    assert.equal(catsAfterRemove.count, catsBefore.count, 'removing the just-added category must restore the original count');

    // --- Certifications: add then remove ------------------------------------
    const certsBefore = await frame.locator('.ls-cert').count();
    await frame.locator('.ls-cert').first().scrollIntoViewIfNeeded();
    await frame.locator('.ls-certs .hb-ls-add').click();
    await page.waitForTimeout(600);
    await frame.locator('.ls-cert').first().waitFor({ state: 'visible' });
    const certsAfterAdd = await frame.locator('.ls-cert').count();
    assert.equal(certsAfterAdd, certsBefore + 1, 'adding a certification must increase the count by exactly one');
    const lastCertText = (await frame.locator('.ls-cert').nth(certsAfterAdd - 1).textContent() || '').trim();
    assert.match(lastCertText, /certificare nouă/i, 'new certification should carry the Romanian placeholder text');

    await frame.locator('.ls-cert').nth(certsAfterAdd - 1).locator('.hb-ls-remove').click();
    await page.waitForTimeout(600);
    const certsAfterRemove = await frame.locator('.ls-cert').count();
    assert.equal(certsAfterRemove, certsBefore, 'removing the just-added certification must restore the original count');

    // --- Publish and verify a newly-added service survives onto the live site ---
    await frame.locator('.service-card').first().scrollIntoViewIfNeeded();
    await frame.locator('.service-card').last()
      .locator('xpath=following-sibling::button[contains(@class,"hb-ls-add")][1]').click();
    await page.waitForTimeout(600);
    const servicesForPublish = await countAndReadLast('.service-card', '.ls-punch__label');
    assert.match(servicesForPublish.lastText, /serviciu nou/i);
    // Give the surviving new service a distinctive name so it's unambiguous on the live site.
    const distinctiveLabel = 'Zugrăveli decorative Wave5';
    const newLabelEl = frame.locator('.service-card').nth(servicesForPublish.count - 1).locator('.ls-punch__label [data-hb-edit]');
    await newLabelEl.click({ clickCount: 3 }); // triple-click selects the whole (single-line) text node
    await page.keyboard.type(distinctiveLabel);
    await newLabelEl.blur();
    await page.waitForTimeout(300);
    await frame.locator('.service-card').nth(servicesForPublish.count - 1).locator('.ls-punch__label')
      .filter({ hasText: distinctiveLabel }).waitFor({ state: 'visible' });

    await page.locator('#btn-publish').click();
    await page.locator('#modal-publish').waitFor({ state: 'visible' });
    const slug = 'wave5-ls-listaddrm-' + Date.now().toString(36);
    await page.locator('#input-slug').fill(slug);
    await page.locator('#btn-publish-continue').click();
    await page.locator('#form-auth-email').waitFor({ state: 'visible' });
    await page.locator('#input-email').fill('wave5-ls@example.com');
    await page.locator('#btn-send-magic').click();
    await page.locator('#dev-link').waitFor({ state: 'visible' });
    await page.locator('#dev-link').click();
    await page.locator('#btn-pay-publish').waitFor({ state: 'visible' });
    await page.locator('#btn-pay-publish').click();
    await page.locator('#modal-success-title').filter({ hasText: 'Site-ul tău e live' }).waitFor({ state: 'visible', timeout: 20000 });
    const liveHref = await page.locator('#success-url-link').getAttribute('href');
    assert.ok(liveHref && liveHref.includes('/live/' + slug + '/'), 'live href must contain the isolated slug');

    const opened = context.waitForEvent('page');
    await page.locator('#success-url-link').click();
    const livePage = await opened;
    await livePage.waitForLoadState('networkidle');
    await livePage.getByText(distinctiveLabel, { exact: false }).first().waitFor({ state: 'visible', timeout: 10000 });
    const liveHtml = await livePage.content();
    assert.ok(liveHtml.includes(distinctiveLabel), 'the service added through the UI must survive onto the published live site');
    await livePage.screenshot({ path: path.join(EVIDENCE_DIR, '02-added-service-live-site.png'), fullPage: true });

    console.log('PASS wave5-local-service-list-add-remove: add/edit/remove works end to end for services, categories and certifications, and survives publish');
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error('FAIL wave5-local-service-list-add-remove:', e.message);
  process.exit(1);
});
