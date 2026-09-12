'use strict';
/**
 * bot/test/suite3-publish-messages.test.js
 *
 * PLAN-QA-2026-09-12, Suita 3 / S3-4 — four small, independently-wrong
 * messages around publish/auth (m9, m10, m22, m1). Each sub-test checks the
 * ACTUAL text a real browser shows, not the code that produces it.
 *
 * - m9:  republishing an ALREADY-PAID/live site re-shows "trial de 7 zile
 *        început" — no trial started, nothing to announce. A genuine first
 *        publish (unpaid draft → pay → live) must keep the trial message.
 * - m10: a reserved slug ("www") shows the generic "deja folosită" message
 *        client-side, even though the server returns a distinct, correct
 *        "rezervată de platformă" error — checkSlug() ignores data.error on
 *        the "not available" branch (builder/app.js).
 * - m22: a slug typed with spaces/diacritics/uppercase ("Café Deluxe") is
 *        silently rewritten to "cafe-deluxe" in the input with no
 *        explanation anywhere on screen.
 * - m1:  the auth modal opened from the DASHBOARD ("Autentificare" button,
 *        nobody is publishing anything) shows the publish-flow's static
 *        title "Autentifică-te ca să publici" (builder/index.html,
 *        `#publish-step-2 h2`) — wireDashboardAuthButton() never sets a
 *        context-appropriate title.
 *
 * Run: node --experimental-sqlite --test bot/test/suite3-publish-messages.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));

process.env.HIDOOK_TEST_PAY = '1';
process.env.HIDOOK_ISOLATED_DEPLOY = '1';
process.env.NODE_ENV = 'test';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hidook-s3b-messages-'));
process.env.SERVER_SECRET = 's3b-messages-' + crypto.randomBytes(8).toString('hex');
delete process.env.PUBLIC_URL;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.VERCEL_TOKEN;

require(path.join(ROOT, 'scripts', 'build-builder.js'));
const registry = require(path.join(ROOT, 'bot', 'registry.js'));
const webpublish = require(path.join(ROOT, 'bot', 'webpublish.js'));
const { startServer } = require(path.join(ROOT, 'bot', 'server.js'));

let server;
let base;

test.before(async () => {
  server = startServer({ port: 0 });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  base = 'http://127.0.0.1:' + server.address().port;
});

test.after(() => {
  if (server) server.close();
});

async function acceptCookiesIfShown(page) {
  const banner = page.locator('#hb-cookie-banner');
  if (await banner.isVisible().catch(() => false)) {
    await page.locator('#hb-cookie-accept').click();
    await banner.waitFor({ state: 'hidden' }).catch(() => {});
  }
}

async function closeDrawerIfOpen(page) {
  const drawer = page.locator('#details-drawer');
  if (await drawer.isVisible().catch(() => false)) {
    await page.locator('#btn-close-drawer').click({ timeout: 4000 }).catch(async () => {
      await page.locator('#btn-close-drawer').click({ force: true }).catch(() => {});
    });
    await drawer.waitFor({ state: 'hidden', timeout: 4000 }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// m9 — republish of an already-paid site must not re-announce the trial
// ---------------------------------------------------------------------------

test('a genuine first publish still announces the trial', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    await page.goto(base + '/app/', { waitUntil: 'networkidle' });
    await acceptCookiesIfShown(page);
    await page.locator('.template-card[data-template-id="product-menu"] .btn-start-tpl').click();
    await page.waitForURL(/#edit$/, { timeout: 25000 });
    await page.locator('#preview-iframe').waitFor({ state: 'visible' });
    await page.waitForTimeout(600);
    await closeDrawerIfOpen(page);

    await page.locator('#btn-publish').click();
    await page.locator('#modal-publish').waitFor({ state: 'visible' });
    const slug = 's3b-firstpub-' + Date.now().toString(36);
    await page.locator('#input-slug').fill(slug);
    await page.locator('#btn-publish-continue').click();
    await page.locator('#form-auth-email').waitFor({ state: 'visible' });
    const email = 's3b-m9-first-' + Date.now().toString(36) + '@example.com';
    await page.locator('#input-email').fill(email);
    await page.locator('#btn-send-magic').click();
    await page.locator('#dev-link').waitFor({ state: 'visible' });
    await page.locator('#dev-link').click();
    await page.locator('#btn-pay-publish').waitFor({ state: 'visible' });
    await page.locator('#btn-pay-publish').click();
    // The success modal is already open (pre-payment "Adaugă un card ca să
    // fii live" state, which itself contains the word "live") — wait for
    // the title to actually FLIP to the post-payment text (named by "trial",
    // the one word only the post-payment title carries), not just for the
    // element to still be visible.
    await page.locator('#modal-success-title').filter({ hasText: /trial/i }).waitFor({ state: 'visible', timeout: 15000 });

    const title = (await page.locator('#modal-success-title').innerText()).trim();
    assert.match(title, /trial/i, `a genuine first publish must still say "trial" — got "${title}"`);

    await context.close();
  } finally {
    await browser.close();
  }
});

test('republishing an already-paid, already-live site does not re-announce the trial', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const email = 's3b-m9-republish-' + Date.now().toString(36) + '@example.com';
    const user = registry.getOrCreateUserByEmail(email);
    const cfg = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'templates', 'product-menu', 'presets.json'), 'utf8')
    ).presets[0].config;
    const slug = 's3b-m9-' + Date.now().toString(36);
    const site = registry.createSite({
      userId: user.id, templateId: 'product-menu', templateVersion: 1, slug, platform: 'web',
    });
    const siteDir = path.join(process.env.DATA_DIR, 'sites', site.projectName);
    fs.mkdirSync(siteDir, { recursive: true });
    fs.writeFileSync(path.join(siteDir, 'index.html'), '<h1>' + slug + '</h1>');
    await webpublish.publishSite({ site: registry.getSite(site.id), config: cfg, images: [], siteDirAlreadyBuilt: true });
    // publishSite() only calls registry.saveVersion() when it built the site
    // dir itself (siteDirAlreadyBuilt skips that) — loadSiteForEdit() needs a
    // saved version to have any config to load into the editor, so seed it
    // directly, same as other oracles that seed a pre-built site (e.g.
    // wave7-payments-no-double-subscription.test.js).
    registry.saveVersion(site.id, cfg);
    // paidUntil (future) is required for hasActiveCommercialEntitlement()
    // (bot/server.js) to treat this as a currently-entitled site — without
    // it POST /api/publish falls through to the "unpaid draft" branch
    // regardless of the `paid` flag, which is not the scenario under test.
    registry.updateSite(site.id, {
      paid: true, status: 'live',
      paidUntil: new Date(Date.now() + 300 * 86400000).toISOString(),
    });

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    await page.goto(base + '/app/', { waitUntil: 'networkidle' });
    await acceptCookiesIfShown(page);
    await page.evaluate(() => { window.location.hash = '#dashboard'; });
    await page.waitForTimeout(300);
    await page.locator('#btn-dashboard-auth').click();
    await page.locator('#form-auth-email').waitFor({ state: 'visible' });
    await page.locator('#input-email').fill(email);
    await page.locator('#btn-send-magic').click();
    await page.locator('#dev-link').waitFor({ state: 'visible' });
    await page.locator('#dev-link').click();
    await page.waitForTimeout(600);
    await page.evaluate(() => { window.location.hash = '#dashboard'; });
    await page.locator('.site-card').first().waitFor({ state: 'visible' });
    await page.waitForTimeout(600);

    await page.locator('button:has-text("Editează")').first().click();
    await page.waitForURL(/#edit$/, { timeout: 20000 });
    await page.locator('#preview-iframe').waitFor({ state: 'visible' });
    await page.waitForTimeout(600);
    await closeDrawerIfOpen(page);

    // Paid #edit republish path skips the slug modal entirely (existing
    // behavior — see the "Paid #edit republish" branch in builder/app.js).
    await page.locator('#btn-publish').click();
    await page.locator('#modal-success-title').waitFor({ state: 'visible', timeout: 15000 });

    const title = (await page.locator('#modal-success-title').innerText()).trim();
    assert.doesNotMatch(
      title, /trial/i,
      `republishing an already-paid site must NOT re-announce a trial — got "${title}"`
    );
    assert.match(
      title, /live|modificăril|actualizat/i,
      `republish success title should say the update is live — got "${title}"`
    );

    await context.close();
  } finally {
    await browser.close();
  }
});

// ---------------------------------------------------------------------------
// m10 — reserved slug must show the SERVER's message, not the generic one
// ---------------------------------------------------------------------------

test('a reserved slug ("www") shows the server\'s own message, not the generic "already taken" one', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    await page.goto(base + '/app/', { waitUntil: 'networkidle' });
    await acceptCookiesIfShown(page);
    await page.locator('.template-card[data-template-id="product-menu"] .btn-start-tpl').click();
    await page.waitForURL(/#edit$/, { timeout: 25000 });
    await page.locator('#preview-iframe').waitFor({ state: 'visible' });
    await page.waitForTimeout(600);
    await closeDrawerIfOpen(page);

    await page.locator('#btn-publish').click();
    await page.locator('#modal-publish').waitFor({ state: 'visible' });
    await page.locator('#input-slug').fill('www');
    await page.locator('#slug-error').waitFor({ state: 'visible', timeout: 6000 });

    const serverCheck = await page.evaluate(async () => {
      const r = await fetch('/api/slug-check?slug=www');
      return r.json();
    });
    assert.ok(serverCheck.error, 'sanity: the server must return a distinct error for a reserved slug');

    const shown = (await page.locator('#slug-error').innerText()).trim();
    assert.equal(
      shown, serverCheck.error,
      `the client must show the SERVER's message for a reserved slug — server said "${serverCheck.error}", client showed "${shown}"`
    );

    await context.close();
  } finally {
    await browser.close();
  }
});

// ---------------------------------------------------------------------------
// m22 — silent slug normalization must be explained, only when it happens
// ---------------------------------------------------------------------------

test('typing a slug with spaces/diacritics/uppercase explains the normalization', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    await page.goto(base + '/app/', { waitUntil: 'networkidle' });
    await acceptCookiesIfShown(page);
    await page.locator('.template-card[data-template-id="product-menu"] .btn-start-tpl').click();
    await page.waitForURL(/#edit$/, { timeout: 25000 });
    await page.locator('#preview-iframe').waitFor({ state: 'visible' });
    await page.waitForTimeout(600);
    await closeDrawerIfOpen(page);

    await page.locator('#btn-publish').click();
    await page.locator('#modal-publish').waitFor({ state: 'visible' });

    const slugInput = page.locator('#input-slug');
    await slugInput.fill('Café Deluxe ' + Date.now().toString(36));
    // Debounced slug-check (550ms) + a real request round-trip.
    await page.waitForTimeout(1500);

    const finalValue = await slugInput.inputValue();
    assert.doesNotMatch(finalValue, /[ÀÁÂÃÄÅàáâãäåÉÈÊËéèêëÇç ]/, 'the slug must end up normalized (no spaces/diacritics/uppercase)');

    const note = page.locator('#slug-normalize-note');
    await assert.doesNotReject(
      note.waitFor({ state: 'visible', timeout: 4000 }),
      'a note explaining the normalization must appear once the address was actually changed'
    );
    const noteText = (await note.innerText()).trim();
    assert.match(noteText, new RegExp(finalValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `the note should name the actual normalized address — got "${noteText}" for "${finalValue}"`);

    // Sanity: typing an ALREADY-clean slug must not show the note.
    await slugInput.fill('already-clean-slug');
    await page.waitForTimeout(1200);
    assert.equal(
      await note.isVisible().catch(() => false), false,
      'the note must not appear when nothing needed normalizing'
    );

    await context.close();
  } finally {
    await browser.close();
  }
});

// ---------------------------------------------------------------------------
// m1 — dashboard auth modal must not claim the user is publishing
// ---------------------------------------------------------------------------

test('the auth modal opened from the dashboard does not claim the user is publishing', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

    // Context A: open the auth modal from #dashboard, no publish involved.
    const pageA = await context.newPage();
    pageA.setDefaultTimeout(20000);
    await pageA.goto(base + '/app/', { waitUntil: 'networkidle' });
    await acceptCookiesIfShown(pageA);
    await pageA.evaluate(() => { window.location.hash = '#dashboard'; });
    await pageA.waitForTimeout(300);
    await pageA.locator('#btn-dashboard-auth').click();
    await pageA.locator('#form-auth-email').waitFor({ state: 'visible' });
    const dashboardTitle = (await pageA.locator('#publish-step-2 .modal-title').innerText()).trim();
    assert.doesNotMatch(
      dashboardTitle, /public/i,
      `the dashboard's own auth modal must not talk about publishing — got "${dashboardTitle}"`
    );

    // Context B (regression guard): the REAL publish flow's auth step must
    // still say so — this sub-test only asks for a contextual title, not a
    // universally neutral one.
    const pageB = await context.newPage();
    pageB.setDefaultTimeout(20000);
    await pageB.goto(base + '/app/', { waitUntil: 'networkidle' });
    await acceptCookiesIfShown(pageB);
    await pageB.locator('.template-card[data-template-id="product-menu"] .btn-start-tpl').click();
    await pageB.waitForURL(/#edit$/, { timeout: 25000 });
    await pageB.locator('#preview-iframe').waitFor({ state: 'visible' });
    await pageB.waitForTimeout(600);
    await closeDrawerIfOpen(pageB);
    await pageB.locator('#btn-publish').click();
    await pageB.locator('#modal-publish').waitFor({ state: 'visible' });
    const slug = 's3b-m1-' + Date.now().toString(36);
    await pageB.locator('#input-slug').fill(slug);
    await pageB.locator('#btn-publish-continue').click();
    await pageB.locator('#form-auth-email').waitFor({ state: 'visible' });
    const publishTitle = (await pageB.locator('#publish-step-2 .modal-title').innerText()).trim();
    assert.match(
      publishTitle, /public/i,
      `the real publish flow's auth step should still mention publishing — got "${publishTitle}"`
    );

    await context.close();
  } finally {
    await browser.close();
  }
});
