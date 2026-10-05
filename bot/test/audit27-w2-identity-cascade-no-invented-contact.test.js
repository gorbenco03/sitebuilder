'use strict';
/**
 * bot/test/audit27-w2-identity-cascade-no-invented-contact.test.js
 *
 * VERIFICARE-2026-10-04 H-01 (+ journey-desktop#2/#3, templates-live#2/#3,
 * phone#10). Typing a business name used to rewrite the template's demo
 * Instagram/Facebook handle and e-mail into values derived from that name
 * (instagram.com/salon.aurora, contact@<name>.ro) — links the owner never
 * typed, live on the published site. The town rewrote only part of the demo
 * address; the wizard accepted any phone text.
 *
 * GREEN (real bot/server.js + real Chromium, no mocked editor state):
 *  A. Wizard (Salon Aurora / 0721 234 567 / Cluj) on the salon design: an
 *     invalid phone stays on step 2 with an inline Romanian message; then the
 *     valid one publishes. /live carries no Instagram/Facebook link, no
 *     invented e-mail, wa.me/40721234567, the town Cluj in the address, and
 *     the "Unde ne găsești" Google Maps link query contains Cluj.
 *  B. Untouched fresh restaurant draft: the publish checklist lists the demo
 *     social links and demo address; the quick-start bar rejects an invalid
 *     phone inline, accepts an international one (wa.me normalized), and the
 *     hero location label says the new town.
 *
 *  C. Wizard with phone + town but NO business name (restaurant design), then
 *     publish: /live carries no Instagram/Facebook link and no e-mail, because
 *     the template's sample contact values never ship.
 *  D. Untouched drafts of the restaurant and the professionals designs
 *     published as-is (no name, no wizard): same assertions, including the
 *     professionals sample e-mail and its structured data.
 *
 * Screenshots go to os.tmpdir(), named after the action just performed.
 *
 * Run: node --experimental-sqlite --test bot/test/audit27-w2-identity-cascade-no-invented-contact.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');

function loadPlaywright() {
  const candidates = [
    path.join(ROOT, 'node_modules/playwright'),
    '/Users/Work/.hermes/hermes-agent/node_modules/playwright',
    path.join(ROOT, '../fullpass-63230d2/node_modules/playwright'),
  ];
  for (const cand of candidates) {
    try { return require(cand); } catch (_) { /* try next */ }
  }
  throw new Error('playwright not found in any candidate location');
}
const { chromium } = loadPlaywright();

let browser;
let server;
let base;

test.before(async () => {
  process.env.HIDOOK_TEST_PAY = '1';
  process.env.HIDOOK_ISOLATED_DEPLOY = '1';
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-w2-'));
  process.env.SERVER_SECRET = 'audit27-w2-' + crypto.randomBytes(8).toString('hex');
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

async function shot(page, actionJustPerformed) {
  const file = path.join(os.tmpdir(), `audit27-w2-${actionJustPerformed}.png`);
  await page.screenshot({ path: file }).catch(() => {});
  return file;
}

async function openCatalog(page) {
  await page.goto(base + '/app/', { waitUntil: 'domcontentloaded' });
  if (await page.locator('#hb-cookie-accept').isVisible().catch(() => false)) {
    await page.locator('#hb-cookie-accept').click().catch(() => {});
  }
}

async function waitEditor(page) {
  await page.waitForURL(/#edit$/, { timeout: 30000 });
  await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(900);
  if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
    await page.locator('#btn-close-drawer').click({ timeout: 4000 }).catch(() => {});
    await page.locator('#details-drawer').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }
  await page.waitForTimeout(300);
}

async function checklistRows(page) {
  await page.locator('#btn-publish').click();
  await page.locator('#modal-publish').waitFor({ state: 'visible', timeout: 8000 });
  const rows = page.locator('#publish-checklist-list .publish-checklist-item');
  await rows.first().waitFor({ state: 'visible', timeout: 5000 });
  const out = [];
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    out.push({
      text: (await rows.nth(i).locator('.publish-checklist-label').innerText()).trim(),
      done: /is-done/.test(await rows.nth(i).getAttribute('class')),
    });
  }
  return out;
}

test('A. wizard (Salon Aurora / 0721 234 567 / Cluj) publishes a site with no invented contact data, the right wa.me and a Cluj Maps link', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(25000);
  try {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
    await openCatalog(page);
    await page.locator('.template-card[data-template-id="portfolio"] .btn-start-tpl').click();
    await page.locator('#onboarding-wizard .onb-type-card[data-type="salon"]').click();
    await page.locator('#onb-identity-form').waitFor({ state: 'visible' });

    // Invalid phone: stays on step 2, Romanian inline message, nothing applied.
    await page.locator('#onb-name').fill('Salon Aurora');
    await page.locator('#onb-phone').fill('abc 12');
    await page.locator('#onb-town').fill('Cluj');
    await page.locator('#onb-continue-btn').click();
    await page.locator('#onb-phone-error').waitFor({ state: 'visible', timeout: 3000 });
    assert.match(await page.locator('#onb-phone-error').innerText(), /nu pare valid/i);
    assert.equal(await page.locator('#onb-identity-form').isVisible(), true, 'an invalid phone must keep the wizard on step 2');
    await shot(page, 'wizard-invalid-phone-inline-message');

    await page.locator('#onb-phone').fill('0721 234 567');
    await page.locator('#onb-continue-btn').click();
    await waitEditor(page);

    const cfg = await page.evaluate(() => JSON.parse(JSON.stringify(draft.config)));
    assert.equal(cfg.business.name, 'Salon Aurora');
    assert.equal(cfg.contact.phone, '+40721234567');
    assert.ok(cfg.contact.waHref.includes('wa.me/40721234567'), 'waHref: ' + cfg.contact.waHref);
    assert.ok(!/salon/i.test(JSON.stringify(cfg.contact.instagram || {})), 'no Instagram value derived from the name: ' + JSON.stringify(cfg.contact.instagram));
    assert.ok(!/salon/i.test(JSON.stringify(cfg.contact.facebook && cfg.contact.facebook.url) || ''), 'no Facebook link derived from the name');
    assert.ok(!(cfg.instagram && cfg.instagram.handle), 'no Instagram handle derived from the name');
    assert.ok(!/email|instagram|facebook/i.test(cfg.seo && cfg.seo.jsonLd || ''), 'structured data must not carry an e-mail or social profile');

    // The owner's town reaches the address; the hybrid street is still demo.
    assert.ok(cfg.footer.address.includes('Cluj') && !cfg.footer.address.includes('București'), 'footer address: ' + cfg.footer.address);
    assert.ok(/q=[^"]*Cluj/.test(cfg.contact.addressHref), 'contact.addressHref must carry the new town: ' + cfg.contact.addressHref);

    // Checklist before publish: the street is still the template's sample.
    let rows = await checklistRows(page);
    await shot(page, 'publish-modal-checklist-after-wizard');
    const addr = rows.find((r) => /Adresă/.test(r.text));
    assert.ok(addr && !addr.done && /de exemplu/.test(addr.text), 'checklist must flag the sample address: ' + JSON.stringify(rows));
    await page.keyboard.press('Escape');
    await page.locator('#modal-publish').waitFor({ state: 'hidden', timeout: 5000 });

    // "Unde ne găsești" added after the town was entered follows that town.
    await page.locator('#btn-open-drawer').click();
    await page.locator('#details-drawer').waitFor({ state: 'visible' });
    await page.locator('#btn-add-section-panel').click();
    await page.locator('#modal-add-section').waitFor({ state: 'visible' });
    await page.locator('.add-section-card', { hasText: 'Unde ne găsești' }).locator('[data-add-section-id="location"]').click();
    await page.locator('#modal-add-section').waitFor({ state: 'hidden', timeout: 5000 });
    await page.waitForTimeout(700);
    await page.locator('#btn-close-drawer').click({ timeout: 4000 }).catch(() => {});
    const locAddress = await page.evaluate(() => draft.config.location && draft.config.location.address);
    assert.ok(locAddress && locAddress.includes('Cluj') && !locAddress.includes('București'), 'seeded location address: ' + locAddress);
    await shot(page, 'location-section-added-with-town');

    // Publish.
    const slug = 'w2-' + crypto.randomBytes(8).toString('hex');
    await page.locator('#btn-publish').click();
    await page.locator('#modal-publish').waitFor({ state: 'visible' });
    await page.locator('#input-slug').fill(slug);
    await page.locator('#btn-publish-continue').click();
    await page.locator('#form-auth-email').waitFor({ state: 'visible' });
    await page.locator('#input-email').fill('audit27-w2-a@example.com');
    await page.locator('#btn-send-magic').click();
    await page.locator('#dev-link').waitFor({ state: 'visible' });
    await page.locator('#dev-link').click();
    await page.locator('#btn-pay-publish').waitFor({ state: 'visible' });
    await page.locator('#btn-pay-publish').click();
    await page.locator('#modal-success-title').waitFor({ state: 'visible', timeout: 25000 });
    await shot(page, 'published-salon-aurora');

    let html = '';
    for (let i = 0; i < 30; i++) {
      const resp = await page.request.get(base + '/live/' + slug + '/').catch(() => null);
      if (resp && resp.status() === 200) { html = await resp.text(); break; }
      await page.waitForTimeout(500);
    }
    assert.ok(html, '/live/' + slug + '/ must be reachable');

    assert.ok(!/href="https?:\/\/(www\.)?instagram\.com/i.test(html), 'live site must carry no Instagram link the owner did not type');
    assert.ok(!/instagram\.com\/salon/i.test(html), 'no instagram.com/salon.aurora');
    assert.ok(!/href="https?:\/\/(www\.)?facebook\.com/i.test(html), 'live site must carry no Facebook link the owner did not type');
    assert.ok(!/mailto:|contact@|@salon/i.test(html), 'live site must carry no invented e-mail');
    assert.ok(html.includes('wa.me/40721234567'), 'live site must link wa.me/40721234567');
    assert.ok(/Cluj/.test(html), 'live site must say Cluj');

    await page.goto(base + '/live/' + slug + '/', { waitUntil: 'load' });
    const mapsHref = await page.locator('[data-location-maps-link]').first().getAttribute('href');
    assert.ok(mapsHref && /query=[^&]*Cluj/.test(decodeURIComponent(mapsHref)), 'Maps link query must contain Cluj: ' + mapsHref);
    await shot(page, 'live-site-maps-link-checked');
  } finally {
    await page.close().catch(() => {});
  }
});

test('B. untouched draft: checklist names the sample social links and address; quick-start rejects a bad phone inline, accepts an international one and re-labels the hero town', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(25000);
  try {
    await openCatalog(page);
    await page.locator('.template-card[data-template-id="product-menu"] .btn-start-tpl').click();
    await waitEditor(page);

    const before = await checklistRows(page);
    await shot(page, 'publish-modal-checklist-untouched-draft');
    const social = before.find((r) => /Linkuri sociale/.test(r.text));
    const address = before.find((r) => /Adresă/.test(r.text));
    assert.ok(social && !social.done && /de exemplu/.test(social.text), 'checklist must flag sample social links: ' + JSON.stringify(before));
    assert.ok(address && !address.done && /de exemplu/.test(address.text), 'checklist must flag the sample address: ' + JSON.stringify(before));
    await page.keyboard.press('Escape');
    await page.locator('#modal-publish').waitFor({ state: 'hidden', timeout: 5000 });

    // Quick-start: obviously invalid phone -> inline message, nothing applied.
    await page.locator('#quickstart-form').waitFor({ state: 'visible' });
    const demoName = await page.evaluate(() => draft.config.business.name);
    await page.locator('#quickstart-name').fill('Bistro Aurora');
    await page.locator('#quickstart-phone').fill('12ab');
    await page.locator('#quickstart-town').fill('Cluj');
    await page.locator('#btn-quickstart-apply').click();
    await page.locator('#quickstart-phone-error').waitFor({ state: 'visible', timeout: 3000 });
    assert.match(await page.locator('#quickstart-phone-error').innerText(), /nu pare valid/i);
    assert.equal(await page.evaluate(() => draft.config.business.name), demoName, 'an invalid phone must not half-apply the identity');
    await shot(page, 'quickstart-invalid-phone-inline-message');

    // International number: accepted and normalized for wa.me.
    await page.locator('#quickstart-phone').fill('+44 20 7946 0958');
    await page.locator('#btn-quickstart-apply').click();
    await page.waitForTimeout(900);
    const cfg = await page.evaluate(() => JSON.parse(JSON.stringify(draft.config)));
    assert.equal(cfg.business.name, 'Bistro Aurora');
    assert.equal(cfg.contact.phone, '+442079460958');
    assert.ok(cfg.contact.waHref.includes('wa.me/442079460958'), 'waHref: ' + cfg.contact.waHref);
    assert.ok(/Cluj/.test(cfg.labels.heroEyebrow) && !/București/.test(cfg.labels.heroEyebrow), 'hero label: ' + cfg.labels.heroEyebrow);
    assert.ok(!/instagram/i.test(cfg.contact.instagram.url || ''), 'no Instagram link left');
    assert.ok(!/facebook/i.test(cfg.contact.facebook.url || ''), 'no Facebook link left');

    const heroText = await page.frameLocator('#preview-iframe').locator('body').innerText();
    assert.ok(/Restaurant · Cluj/i.test(heroText), 'the hero location label on the canvas must say Cluj');
    await shot(page, 'quickstart-applied-hero-says-cluj');

    const after = await checklistRows(page);
    const socialAfter = after.find((r) => /Linkuri sociale/.test(r.text));
    assert.ok(socialAfter && socialAfter.done, 'once cleared, the social-links row reads done: ' + JSON.stringify(after));
  } finally {
    await page.close().catch(() => {});
  }
});

async function publishAndFetchLive(page, slug, email) {
  await page.locator('#btn-publish').click();
  await page.locator('#modal-publish').waitFor({ state: 'visible' });
  await page.locator('#input-slug').fill(slug);
  await page.locator('#btn-publish-continue').click();
  await page.locator('#form-auth-email').waitFor({ state: 'visible' });
  await page.locator('#input-email').fill(email);
  await page.locator('#btn-send-magic').click();
  await page.locator('#dev-link').waitFor({ state: 'visible' });
  await page.locator('#dev-link').click();
  await page.locator('#btn-pay-publish').waitFor({ state: 'visible' });
  await page.locator('#btn-pay-publish').click();
  await page.locator('#modal-success-title').waitFor({ state: 'visible', timeout: 25000 });
  for (let i = 0; i < 30; i++) {
    const resp = await page.request.get(base + '/live/' + slug + '/').catch(() => null);
    if (resp && resp.status() === 200) return resp.text();
    await page.waitForTimeout(500);
  }
  throw new Error('/live/' + slug + '/ not reachable');
}

function assertNoSampleContact(html, label) {
  assert.ok(!/href="https?:\/\/(www\.)?instagram\.com/i.test(html), label + ': no Instagram link');
  assert.ok(!/href="https?:\/\/(www\.)?facebook\.com/i.test(html), label + ': no Facebook link');
  assert.ok(!/mailto:/i.test(html), label + ': no mailto link');
  assert.ok(!/instagram\.com\/(casa\.nord|atelier|renovari|desserdirina)/i.test(html), label + ': no sample Instagram handle anywhere');
  assert.ok(!/facebook\.com\/(casanord|atelier|renovari|desserdirina)/i.test(html), label + ': no sample Facebook page anywhere');
  assert.ok(!/contact@cabinetjuridicionescu/i.test(html), label + ': no sample e-mail anywhere');
}

test('C. wizard with phone and town but no business name: the published site carries no sample social links or e-mail', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(25000);
  try {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
    await openCatalog(page);
    await page.locator('.template-card[data-template-id="product-menu"] .btn-start-tpl').click();
    await page.locator('#onboarding-wizard .onb-type-card[data-type="restaurant"]').click();
    await page.locator('#onb-identity-form').waitFor({ state: 'visible' });
    await page.locator('#onb-phone').fill('0721 234 567');
    await page.locator('#onb-town').fill('Cluj');
    await page.locator('#onb-continue-btn').click();
    await waitEditor(page);
    await shot(page, 'wizard-phone-town-no-name-editor');

    const cfg = await page.evaluate(() => JSON.parse(JSON.stringify(draft.config)));
    assert.ok(cfg.contact.waHref.includes('wa.me/40721234567'), 'waHref: ' + cfg.contact.waHref);
    assert.ok(!cfg.contact.instagram.url && !cfg.contact.facebook.url, 'sample social links cleared in the draft');
    assert.ok(!(cfg.instagram && cfg.instagram.handle), 'sample handle cleared in the draft');

    const html = await publishAndFetchLive(page, 'w2c-' + crypto.randomBytes(8).toString('hex'), 'audit27-w2-c@example.com');
    await shot(page, 'published-wizard-phone-town-no-name');
    assertNoSampleContact(html, 'wizard without name');
    assert.ok(html.includes('wa.me/40721234567'), 'live site must link wa.me/40721234567');
  } finally {
    await page.close().catch(() => {});
  }
});

for (const tplId of ['product-menu', 'professionals']) {
  test('D. untouched ' + tplId + ' draft published as-is: no sample social links or e-mail reach /live', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(25000);
    try {
      await openCatalog(page);
      await page.locator('.template-card[data-template-id="' + tplId + '"] .btn-start-tpl').click();
      await waitEditor(page);
      const draftSocial = await page.evaluate(() => (draft.config.contact.instagram || {}).url || (draft.config.contact.email) || '');
      await shot(page, 'untouched-' + tplId + '-draft-before-publish');
      const html = await publishAndFetchLive(page, 'w2d-' + crypto.randomBytes(8).toString('hex'), 'audit27-w2-d-' + tplId + '@example.com');
      await shot(page, 'published-untouched-' + tplId);
      assertNoSampleContact(html, 'untouched ' + tplId + ' (draft carried "' + draftSocial + '")');
    } finally {
      await page.close().catch(() => {});
    }
  });
}
