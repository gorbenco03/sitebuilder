'use strict';
/**
 * Test helper: seed accounts and sites through the API, then let a test drive
 * the real dashboard UI. The form editor is gone (2026-10-28), so a customer's
 * site now comes from the block editor; these oracles only need a site to exist.
 *
 * Everything goes through page.request (Playwright's own HTTP client, sharing
 * the browser context's cookies), never global fetch, so tests that stub
 * global.fetch keep working.
 */
const SB = require('../../../builder/blocks/blocks.js');

async function acceptCookies(page) {
  await page.locator('#hb-cookie-accept').click({ timeout: 3000 }).catch(() => {});
}

/** Real magic-link sign-in: dev link from the API, opened in the page. Lands on #dashboard. */
async function signInPage(page, base, email) {
  const res = await page.request.post(base + '/api/auth/email', { data: { email } });
  if (res.status() !== 200) throw new Error('auth/email ' + res.status() + ' ' + (await res.text()));
  const { devLink } = await res.json();
  const u = new URL(devLink, base);
  await page.goto(base + u.pathname + u.search, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/#dashboard$/, { timeout: 20000 });
  await acceptCookies(page);
}

/** A blocks config from a starter pack, with the business name swapped in. */
function blocksConfig(pack, name) {
  const cfg = SB.defaultSite(pack || 'restaurant');
  if (name) SB.applyIdentity(cfg, { name });
  return cfg;
}

async function postJson(page, base, urlPath, data) {
  const res = await page.request.post(base + urlPath, { data });
  let body = null;
  try { body = await res.json(); } catch (_) { /* not json */ }
  return { status: res.status(), body, res };
}

/**
 * Publish a site through the API. Returns { siteId, slug, sessionId, paymentUrl, body }.
 * opts: { slug, templateId, config, pack, name, siteId }
 */
async function publishSite(page, base, opts) {
  const o = opts || {};
  const templateId = o.templateId || 'blocks';
  const config = o.config || blocksConfig(o.pack, o.name);
  const payload = { templateId, config, images: [] };
  if (o.slug) payload.slug = o.slug;
  if (o.siteId) payload.siteId = o.siteId;
  const r = await postJson(page, base, '/api/publish', payload);
  if (r.status !== 200) throw new Error('publish ' + r.status + ' ' + JSON.stringify(r.body));
  const m = String(r.body.paymentUrl || '').match(/#test-checkout=(cs_test_[A-Za-z0-9]+)/);
  return {
    siteId: r.body.site.id,
    slug: r.body.site.slug,
    sessionId: m ? m[1] : null,
    paymentUrl: r.body.paymentUrl,
    body: r.body,
  };
}

/** Complete the test checkout through the API and wait until /live/<slug>/ serves. */
async function payViaApi(page, base, pub) {
  const r = await postJson(page, base, '/api/test-pay/complete', { sessionId: pub.sessionId });
  if (r.status !== 200) throw new Error('test-pay ' + r.status + ' ' + JSON.stringify(r.body));
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const live = await page.request.get(base + '/live/' + pub.slug + '/');
    if (live.status() === 200) return;
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error('site never went live: ' + pub.slug);
}

/** Publish + pay through the API. */
async function publishLive(page, base, opts) {
  const pub = await publishSite(page, base, opts);
  await payViaApi(page, base, pub);
  return pub;
}

/** Same as publishLive, but the payment is completed the way a customer does: the
 *  page follows the checkout return URL and the success modal opens. */
async function publishAndPayInUi(page, base, opts) {
  const pub = await publishSite(page, base, opts);
  await page.goto(base + pub.paymentUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('#modal-success').waitFor({ state: 'visible', timeout: 25000 });
  return pub;
}

/** Open the dashboard and return the locator of the card showing this slug. */
async function openDashboardCard(page, base, slug) {
  await page.goto(base + '/app/#dashboard', { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('#screen-dashboard').waitFor({ state: 'visible' });
  const card = page.locator('.site-card', { hasText: String(slug).replace(/-/g, '‑') }).first();
  await card.waitFor({ state: 'visible', timeout: 15000 });
  return card;
}

module.exports = { SB, acceptCookies, signInPage, blocksConfig, postJson, publishSite, payViaApi, publishLive, publishAndPayInUi, openDashboardCard };
