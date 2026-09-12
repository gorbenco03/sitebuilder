'use strict';
/**
 * bot/test/suite3-publish-single-flight.test.js
 *
 * M11 (PLAN-QA-2026-09-12, Suita 3 / S3-2): a rapid double-click on "Continuă
 * cu această adresă" (the publish modal's slug-confirm step) can fire TWO
 * concurrent POST /api/publish requests for the same click.
 *
 * Why it slipped through: the click handler (builder/app.js, wireEvents())
 * does `if (slugCheckTimer) { clearTimeout(slugCheckTimer); await
 * checkSlug(rawSlug); }` BEFORE calling doActualPublish(). setBtnLoading()
 * — the thing that disables the button — is only called deep inside
 * doActualPublish(), i.e. AFTER that await. Between the first click and that
 * await resolving, the button sits fully enabled and clickable. A second
 * click landing in that window (a real double-click, or a slow/flaky
 * network making the window wider) starts its own independent async chain
 * and reaches execPublish()/POST /api/publish a second time. Nothing in the
 * click handler is synchronous-and-first, so there is no point before the
 * first `await` where a second invocation could be told "someone's already
 * doing this".
 *
 * This oracle proves it with a REAL browser (Playwright) and a REAL delayed
 * /api/publish (page.route + artificial delay, standing in for "network was
 * slow right when you double-clicked") — not a unit test of the handler in
 * isolation, since the bug is specifically about timing between a click and
 * an eventual await.
 *
 * Two cases:
 *   1. Two clicks 50ms apart must produce EXACTLY ONE /api/publish request,
 *      and exactly one site row for this user (no duplicate site created).
 *   2. The flow must stay recoverable after a failed publish: a 500 from
 *      /api/publish must re-enable the button (not leave it stuck) and a
 *      following click must succeed.
 *
 * Run: node --experimental-sqlite --test bot/test/suite3-publish-single-flight.test.js
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
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hidook-s3b-singleflight-'));
process.env.SERVER_SECRET = 's3b-singleflight-' + crypto.randomBytes(8).toString('hex');
delete process.env.PUBLIC_URL;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.VERCEL_TOKEN;

require(path.join(ROOT, 'scripts', 'build-builder.js'));
const registry = require(path.join(ROOT, 'bot', 'registry.js'));
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

/** Start a template, sign in via the dev magic link, land back on #edit signed in. */
async function newSignedInEditorPage(browser, email) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  await page.goto(base + '/app/', { waitUntil: 'networkidle' });
  await page.locator('#hb-cookie-banner').waitFor({ state: 'visible' });
  await page.locator('#hb-cookie-accept').click();
  await page.locator('#hb-cookie-banner').waitFor({ state: 'hidden' });

  await page.locator('.template-card[data-template-id="product-menu"] .btn-start-tpl').click();
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

  // Sign in through the dashboard entry point (independent of the publish
  // modal's own auth step) so the double-click test below exercises ONLY
  // the already-authenticated path the QA report flagged.
  await page.locator('#btn-account-menu').click();
  await page.locator('#account-menu-projects').click();
  await page.waitForURL(/#dashboard$/);
  await page.locator('#btn-dashboard-auth').click();
  await page.locator('#form-auth-email').waitFor({ state: 'visible' });
  await page.locator('#input-email').fill(email);
  await page.locator('#btn-send-magic').click();
  await page.locator('#dev-link').waitFor({ state: 'visible' });
  await page.locator('#dev-link').click();
  await page.waitForURL(/#edit$/);
  await page.locator('#preview-iframe').waitFor({ state: 'visible' });
  await page.waitForTimeout(600);
  if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
    await page.locator('#btn-close-drawer').click().catch(() => {});
    await page.waitForTimeout(300);
  }
  return { context, page };
}

test('a rapid double-click on "Continuă cu această adresă" sends exactly one POST /api/publish', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const email = 's3b-singleflight-' + Date.now().toString(36) + '@example.com';
    const { context, page } = await newSignedInEditorPage(browser, email);
    try {
      let publishRequests = 0;
      await page.route('**/api/publish', async (route) => {
        publishRequests += 1;
        // Stand-in for "the network was slow exactly when you double-clicked" —
        // this is the window the real bug races inside.
        await new Promise((r) => setTimeout(r, 1200));
        await route.continue();
      });
      // The click handler's own race window is the `await checkSlug(...)`
      // BEFORE setBtnLoading() ever runs (builder/app.js ~7461-7477) — on a
      // fast localhost round-trip that await can resolve in a few ms, which
      // would let the button already be disabled by the time a real second
      // click 50ms later arrives, hiding the bug by accident. Delaying
      // /api/slug-check the same way a slow mobile connection would widens
      // that window back to something a real double-click/double-tap
      // reliably lands inside — same race, just no longer luck-dependent.
      await page.route('**/api/slug-check*', async (route) => {
        await new Promise((r) => setTimeout(r, 300));
        await route.continue();
      });

      await page.locator('#btn-publish').click();
      await page.locator('#modal-publish').waitFor({ state: 'visible' });
      const slug = 's3b-sf-' + Date.now().toString(36);
      await page.locator('#input-slug').fill(slug);

      const continueBtn = page.locator('#btn-publish-continue');
      await continueBtn.click();
      await page.waitForTimeout(50);
      // Second click: if the fix disabled the button synchronously, this
      // click cannot land at all (a disabled <button> never dispatches
      // 'click') — give it a short window and swallow the resulting
      // actionability timeout rather than treating it as a test error.
      await continueBtn.click({ timeout: 500, force: false }).catch(() => {});

      await page.locator('#modal-success-title').waitFor({ state: 'visible', timeout: 8000 });

      assert.equal(
        publishRequests, 1,
        `expected exactly 1 POST /api/publish for one rapid double-click, got ${publishRequests}`
      );

      const user = registry.getOrCreateUserByEmail(email);
      const sites = registry.listSites(user.id).filter((s) => s.slug === slug || s.projectName === slug);
      assert.equal(
        sites.length, 1,
        `expected exactly 1 site row for slug "${slug}", found ${sites.length} — a duplicate request must never create a duplicate site`
      );
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
});

test('a failed /api/publish re-enables the button so the customer can retry', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const email = 's3b-retry-' + Date.now().toString(36) + '@example.com';
    const { context, page } = await newSignedInEditorPage(browser, email);
    try {
      let failOnce = true;
      await page.route('**/api/publish', async (route) => {
        if (failOnce) {
          failOnce = false;
          await route.fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'boom (simulated)' }),
          });
          return;
        }
        await route.continue();
      });

      await page.locator('#btn-publish').click();
      await page.locator('#modal-publish').waitFor({ state: 'visible' });
      const slug = 's3b-retry-' + Date.now().toString(36);
      await page.locator('#input-slug').fill(slug);

      const continueBtn = page.locator('#btn-publish-continue');
      await continueBtn.click();

      await page.locator('#toast').filter({ hasText: /eșuat/i }).waitFor({ state: 'visible', timeout: 8000 });
      await assert.doesNotReject(
        continueBtn.waitFor({ state: 'visible', timeout: 4000 }).then(async () => {
          assert.equal(await continueBtn.isEnabled(), true, 'button must re-enable after a failed publish');
        }),
        'the publish button must recover to a clickable state after a failed request'
      );

      await continueBtn.click();
      await page.locator('#modal-success-title').waitFor({ state: 'visible', timeout: 8000 });

      const user = registry.getOrCreateUserByEmail(email);
      const sites = registry.listSites(user.id).filter((s) => s.slug === slug || s.projectName === slug);
      assert.equal(sites.length, 1, 'the retry after a failure must succeed and create exactly one site');
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
});
