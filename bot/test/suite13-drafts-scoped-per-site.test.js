'use strict';
/**
 * bot/test/suite13-drafts-scoped-per-site.test.js
 *
 * MULTI-03 (QA explorer finding, MAJOR / data safety): DRAFT_KEY
 * ('hb.draft.v1', builder/app.js) used to be ONE global localStorage key
 * with no site scoping. With two DIFFERENT sites open in two browser tabs,
 * reloading one tab silently resumed the OTHER site — the existing
 * multi-tab conflict banner never fires for this because the two records
 * have different siteIds, so nothing warns the owner before the next save
 * from the confused tab overwrites the wrong site.
 *
 * Fix (builder/app.js): every draft also lives under its own scope key —
 * 'site:<siteId>' once the server has assigned one, else 'local:<draftId>'
 * for a not-yet-created design — inside one JSON map (hb.draft.scopes.v1).
 * Each browser tab pins itself to whichever scope it is editing via
 * sessionStorage (getTabBoundSiteId/ensureTabDraftId), so a RELOAD of that
 * tab always resumes the SAME scope regardless of what any other tab wrote
 * to the legacy single-key mirror in the meantime. Two tabs on the SAME
 * site still share one physical scope record (and the pre-existing 3-way
 * merge / tab-conflict banner) exactly as before. An existing installation's
 * one global hb.draft.v1 record is picked up lazily by whichever tab first
 * resolves it with nothing pinned yet — no separate migration step.
 *
 * Local only — HIDOOK_TEST_PAY offline checkout stub, no real Stripe/
 * Cloudflare network calls.
 *
 * Run: node --experimental-sqlite --test bot/test/suite13-drafts-scoped-per-site.test.js
 * Evidence: 04-QA-Evidence/Suite13-session-and-drafts/
 */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');
const EVIDENCE = path.join(ROOT, '04-QA-Evidence', 'Suite13-session-and-drafts');

function freshTmpDataDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function withServer(envOverrides, fn) {
  const saved = {};
  const clearKeys = ['PUBLIC_URL', 'STRIPE_SECRET_KEY', 'CLOUDFLARE_API_TOKEN', 'VERCEL_TOKEN', 'BRAND_DOMAIN', 'DEPLOY_PROVIDER', 'HIDOOK_FAKE_DEPLOY'];
  for (const k of Object.keys(envOverrides)) saved[k] = process.env[k];
  for (const k of clearKeys) saved[k] = process.env[k];
  Object.assign(process.env, envOverrides);
  for (const k of clearKeys) delete process.env[k];

  for (const rel of ['../server.js', '../webpublish.js', '../domains.js', '../registry.js']) {
    delete require.cache[require.resolve(rel)];
  }
  require(path.join(ROOT, 'scripts/build-builder.js'));
  const { startServer } = require('../server.js');
  const server = startServer({ port: 0 });
  await new Promise((res, rej) => { server.once('listening', res); server.once('error', rej); });
  const base = 'http://127.0.0.1:' + server.address().port;

  try {
    await fn(base);
  } finally {
    server.close();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

async function acceptCookiesAndStart(page, base, templateId) {
  await page.goto(base + '/app/', { waitUntil: 'networkidle' });
  await page.locator('#hb-cookie-accept').click().catch(() => {});
  await page.locator(`.template-card[data-template-id="${templateId}"] .btn-start-tpl`).click();
  await page.waitForURL(/#edit$/);
  await page.locator('#preview-iframe').waitFor({ state: 'visible' });
  await page.waitForTimeout(1000);
  if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
    await page.locator('#btn-close-drawer').click().catch(() => {});
    await page.waitForTimeout(300);
  }
}

async function editBusinessName(page, text) {
  const field = page.frameLocator('#preview-iframe').locator('[data-hb-edit="business.name"]').first();
  await field.click({ clickCount: 3 });
  await page.keyboard.type(text, { delay: 12 });
  await field.blur().catch(() => {});
  // Wait for draft.config itself to carry the typed value (not just the
  // save pill, which can already read "saved" from an EARLIER autosave —
  // e.g. one a background bind-to-account check kicked off with the still-
  // untouched preset name before this edit even started typing) — then give
  // the debounced server autosave (1200ms) room to also catch up, so a
  // caller that immediately signs in / publishes never races a stale value.
  await page.waitForFunction(
    (expected) => typeof draft !== 'undefined' && draft.config && draft.config.business &&
      draft.config.business.name === expected,
    text,
    { timeout: 5000 }
  );
  await page.locator('#save-status[data-state="saved"]').waitFor({ state: 'visible', timeout: 6000 });
  await page.waitForTimeout(1500);
}

async function readBusinessName(page) {
  return (await page.frameLocator('#preview-iframe').locator('[data-hb-edit="business.name"]').first().innerText()).trim();
}

async function signIn(page, email) {
  await page.locator('#btn-account-menu').click();
  await page.locator('#account-menu-projects').click();
  await page.waitForURL(/#dashboard$/);
  await page.locator('#btn-dashboard-auth').click();
  await page.locator('#form-auth-email').waitFor({ state: 'visible' });
  await page.locator('#input-email').fill(email);
  await page.locator('#btn-send-magic').click();
  await page.locator('#dev-link').waitFor({ state: 'visible' });
  await page.locator('#dev-link').click();
  // loadDashboard() (wireDashboardAuthButton's onAuthSuccess) only auto-jumps
  // to #edit for a BRAND NEW empty account with a local draft sitting
  // around — a RETURNING account that already has a site stays on
  // #dashboard instead. Handle both: wait for whichever happens, then
  // explicitly resume the local draft if it didn't already land on #edit.
  await Promise.race([
    page.waitForURL(/#edit$/),
    page.waitForURL(/#dashboard$/),
  ]);
  if (!/#edit$/.test(page.url())) {
    await page.evaluate(() => { window.location.hash = '#edit'; });
    await page.waitForURL(/#edit$/);
  }
  await page.locator('#preview-iframe').waitFor({ state: 'visible' });
  await page.waitForTimeout(600);
  if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
    await page.locator('#btn-close-drawer').click().catch(() => {});
    await page.waitForTimeout(300);
  }
}

/** Publish + pay through the UI with an explicit slug, ending on #dashboard. */
async function publishAndPayThroughUi(page, slug) {
  await page.locator('#btn-publish').click();
  await page.locator('#modal-publish').waitFor({ state: 'visible' });
  await page.locator('#input-slug').fill(slug);
  await page.locator('#btn-publish-continue').click();
  await page.locator('#modal-success').waitFor({ state: 'visible' });
  await page.locator('#btn-pay-publish').click();
  await page.waitForURL(/#dashboard$/, { timeout: 20000 });
  await page.locator('#modal-success').waitFor({ state: 'visible', timeout: 15000 });
  const siteId = await page.evaluate(() => currentSiteId);
  await page.locator('#btn-close-success').click().catch(() => {});
  return siteId;
}

/**
 * Bind this tab to a specific real site by id — exactly what dashboard
 * "Editează" does (buildSiteCard wires its button straight to
 * `loadSiteForEdit(site.id)`), called directly instead of hunting for the
 * card by slug/name so this test is immune to which slug the server ended
 * up assigning (two tabs sharing one signed-in browser session can each
 * trigger their own background autosave the instant they resolve the
 * account, before an explicit edit lands — a pre-existing, unrelated quirk
 * of the "reuse the single unpaid slot" rule in bot/server.js#handleSaveDraft,
 * not something this test is trying to prove either way).
 */
async function editSiteFromDashboard(page, base, siteId) {
  await page.goto(base + '/app/#dashboard', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.evaluate((id) => loadSiteForEdit(id), siteId);
  await page.waitForURL(/#edit$/);
  await page.locator('#preview-iframe').waitFor({ state: 'visible' });
  await page.waitForTimeout(800);
  if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
    await page.locator('#btn-close-drawer').click().catch(() => {});
    await page.waitForTimeout(300);
  }
}

test('MULTI-03: reloading a tab resumes the SAME site even when another tab most recently saved a DIFFERENT one', async () => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));

  await withServer({
    HIDOOK_TEST_PAY: '1',
    HIDOOK_ISOLATED_DEPLOY: '1',
    NODE_ENV: 'test',
    DATA_DIR: freshTmpDataDir('suite13-multi03-'),
    SERVER_SECRET: 'suite13-multi03-' + crypto.randomBytes(8).toString('hex'),
  }, async (base) => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      const slugA = 'suite13-a-' + crypto.randomUUID().slice(0, 8);
      const slugB = 'suite13-b-' + crypto.randomUUID().slice(0, 8);
      const email = 'suite13-multi03-' + crypto.randomUUID().slice(0, 8) + '@example.com';

      // ---- Create two real, paid/live sites for the SAME signed-in owner,
      // SEQUENTIALLY in one tab (deliberately — creating them concurrently in
      // two tabs races a pre-existing, unrelated server-side quirk:
      // bot/server.js#handleSaveDraft reuses "the account's one existing
      // unpaid draft slot" for an autosave with no siteId, so two tabs' very
      // first background autosave — fired the instant each resolves the
      // shared signed-in session, before either tab's own edit has landed —
      // can momentarily collide. Not what MULTI-03 is about: that finding is
      // specifically about reload-time scope resolution for sites that
      // already exist, which is exactly what this sets up next). ----
      const setup = await context.newPage();
      setup.setDefaultTimeout(30000);
      await acceptCookiesAndStart(setup, base, 'product-menu');
      await editBusinessName(setup, 'Suite13 Site Unu');
      await signIn(setup, email);
      await editBusinessName(setup, 'Suite13 Site Unu'); // re-assert after sign-in resume
      const siteIdA = await publishAndPayThroughUi(setup, slugA);

      // Sign out before starting the second design — same reasoning as site
      // A being edited BEFORE signIn() above: starting a new template while
      // ALREADY signed in schedules a background autosave of the
      // still-untouched preset content the instant the account resolves,
      // racing this test's own edit for which content becomes that site's
      // FIRST saved version (an unrelated, pre-existing quirk of
      // GET /api/sites/:id — bot/server.js#handleGetSite reads
      // listVersions()[0], which is the OLDEST kept version, not the
      // latest, so whichever content wins that very first save can stick
      // around in the editor indefinitely — flagged separately, not
      // something MULTI-03's fix touches). Signing back in with the SAME
      // email afterwards reattaches this second site to the SAME account.
      await setup.evaluate(() => doLogout());
      await setup.waitForTimeout(300);
      await setup.goto(base + '/app/#templates', { waitUntil: 'networkidle' });
      await setup.locator('.template-card[data-template-id="local-service"] .btn-start-tpl').click();
      await setup.waitForURL(/#edit$/);
      await setup.locator('#preview-iframe').waitFor({ state: 'visible' });
      await setup.waitForTimeout(1000);
      if (await setup.locator('#details-drawer').isVisible().catch(() => false)) {
        await setup.locator('#btn-close-drawer').click().catch(() => {});
        await setup.waitForTimeout(300);
      }
      await editBusinessName(setup, 'Suite13 Site Doi');
      await signIn(setup, email);
      await editBusinessName(setup, 'Suite13 Site Doi'); // re-assert after sign-in resume
      const siteIdB = await publishAndPayThroughUi(setup, slugB);
      await setup.close();

      // ---- NOW open each site in its OWN tab via dashboard "Editează" —
      // this is what pins each tab (sessionStorage) to its own scope key. ----
      const pageA = await context.newPage();
      pageA.setDefaultTimeout(30000);
      await editSiteFromDashboard(pageA, base, siteIdA);
      assert.equal(await readBusinessName(pageA), 'Suite13 Site Unu', 'tab A opened site A');

      const pageB = await context.newPage();
      pageB.setDefaultTimeout(30000);
      await editSiteFromDashboard(pageB, base, siteIdB);
      assert.equal(await readBusinessName(pageB), 'Suite13 Site Doi', 'tab B opened site B');

      // ---- Touch tab B AFTER tab A so the legacy single mirror key's most
      // recent write belongs to site B — the exact precondition of the old
      // bug (whichever tab saved last "wins" the shared slot). ----
      await pageA.waitForTimeout(200);
      await pageB.locator('#save-status').waitFor({ state: 'attached' });

      await pageA.screenshot({ path: path.join(EVIDENCE, '01-tabA-siteA-before-reload.png') });

      // ---- THE REPRO: reload tab A. Before the fix, #edit's auto-resume
      // read whatever the shared key last held (site B, written after A) and
      // silently swapped which site tab A was editing. ----
      await pageA.reload({ waitUntil: 'networkidle' });
      await pageA.locator('#preview-iframe').waitFor({ state: 'visible' });
      await pageA.waitForTimeout(1000);
      if (await pageA.locator('#details-drawer').isVisible().catch(() => false)) {
        await pageA.locator('#btn-close-drawer').click().catch(() => {});
        await pageA.waitForTimeout(300);
      }
      await pageA.screenshot({ path: path.join(EVIDENCE, '02-tabA-after-reload.png') });

      assert.equal(
        await readBusinessName(pageA),
        'Suite13 Site Unu',
        'MULTI-03: reloading tab A must resume site A, never site B just because tab B saved more recently'
      );
      const siteIdAAfterReload = await pageA.evaluate(() => currentSiteId);

      // ---- Symmetric check on tab B. ----
      await pageB.reload({ waitUntil: 'networkidle' });
      await pageB.locator('#preview-iframe').waitFor({ state: 'visible' });
      await pageB.waitForTimeout(1000);
      if (await pageB.locator('#details-drawer').isVisible().catch(() => false)) {
        await pageB.locator('#btn-close-drawer').click().catch(() => {});
        await pageB.waitForTimeout(300);
      }
      assert.equal(
        await readBusinessName(pageB),
        'Suite13 Site Doi',
        'MULTI-03: reloading tab B must resume site B, never site A'
      );
      const siteIdBAfterReload = await pageB.evaluate(() => currentSiteId);
      assert.notEqual(siteIdAAfterReload, siteIdBAfterReload, 'the two tabs must resolve to two DIFFERENT site ids');

      // ---- Storage shape: both sites have their OWN scope slot, both
      // distinct from whatever the legacy mirror currently shows. ----
      const scopes = await pageA.evaluate(() => JSON.parse(localStorage.getItem('hb.draft.scopes.v1') || '{}'));
      const scopeKeys = Object.keys(scopes);
      assert.ok(scopeKeys.some((k) => k === 'site:' + siteIdAAfterReload), 'site A has its own scope slot');
      assert.ok(scopeKeys.some((k) => k === 'site:' + siteIdBAfterReload), 'site B has its own scope slot');
      assert.equal(scopes['site:' + siteIdAAfterReload].config.business.name, 'Suite13 Site Unu');
      assert.equal(scopes['site:' + siteIdBAfterReload].config.business.name, 'Suite13 Site Doi');

      console.log('PASS suite13 MULTI-03: two tabs on two different sites never interfere across a reload');
    } finally {
      await browser.close().catch(() => {});
    }
  });
});

test('two tabs on the SAME site still share one scope and the existing conflict banner still fires', async () => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));

  await withServer({
    HIDOOK_TEST_PAY: '1',
    HIDOOK_ISOLATED_DEPLOY: '1',
    NODE_ENV: 'test',
    DATA_DIR: freshTmpDataDir('suite13-sametab-'),
    SERVER_SECRET: 'suite13-sametab-' + crypto.randomBytes(8).toString('hex'),
  }, async (base) => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      const slug = 'suite13-same-' + crypto.randomUUID().slice(0, 8);
      const email = 'suite13-sametab-' + crypto.randomUUID().slice(0, 8) + '@example.com';

      const page1 = await context.newPage();
      page1.setDefaultTimeout(30000);
      await acceptCookiesAndStart(page1, base, 'portfolio');
      await editBusinessName(page1, 'Suite13 Site Comun');
      await signIn(page1, email);
      await editBusinessName(page1, 'Suite13 Site Comun');
      const siteId = await publishAndPayThroughUi(page1, slug);

      // Both tabs now open the SAME site — same scope key by construction.
      await editSiteFromDashboard(page1, base, siteId);

      const page2 = await context.newPage();
      page2.setDefaultTimeout(30000);
      await editSiteFromDashboard(page2, base, siteId);

      // Edit a field in tab 2; tab 1 must see the multi-tab conflict banner —
      // proof that scoping did not sever the SAME-site two-tab protection.
      const field2 = page2.frameLocator('#preview-iframe').locator('[data-hb-edit="business.tagline"]').first();
      await field2.click({ clickCount: 3 }).catch(() => {});
      await page2.keyboard.type('Suite13 Slogan Tab 2', { delay: 12 });
      await page2.locator('#save-status[data-state="saved"]').waitFor({ state: 'visible', timeout: 4000 }).catch(() => {});

      await assert.doesNotReject(
        page1.locator('#tab-conflict-banner').waitFor({ state: 'visible', timeout: 6000 }),
        'two tabs on the SAME site must still trigger the existing tab-conflict banner'
      );
      await page1.screenshot({ path: path.join(EVIDENCE, '03-same-site-tab-conflict-still-fires.png') });

      console.log('PASS suite13: same-site two-tab conflict handling is unaffected by per-scope storage');
    } finally {
      await browser.close().catch(() => {});
    }
  });
});

test('an existing single global hb.draft.v1 record (pre-scoping installation) is still resumed correctly', async () => {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));

  await withServer({
    HIDOOK_TEST_PAY: '1',
    HIDOOK_ISOLATED_DEPLOY: '1',
    NODE_ENV: 'test',
    DATA_DIR: freshTmpDataDir('suite13-migrate-'),
    SERVER_SECRET: 'suite13-migrate-' + crypto.randomBytes(8).toString('hex'),
  }, async (base) => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      const legacyRecord = {
        templateId: 'portfolio',
        config: { business: { name: 'Suite13 Migrat Din Vechi', title: 'x', metaDescription: 'x', lang: 'ro' } },
      };
      await context.addInitScript((rec) => {
        try { localStorage.setItem('hb.draft.v1', JSON.stringify(rec)); } catch (_) { /* ignore */ }
      }, legacyRecord);

      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      await page.goto(base + '/app/#edit', { waitUntil: 'networkidle' });
      await page.locator('#hb-cookie-accept').click().catch(() => {});
      await page.locator('#preview-iframe').waitFor({ state: 'visible', timeout: 15000 });
      await page.waitForTimeout(1000);
      if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
        await page.locator('#btn-close-drawer').click().catch(() => {});
        await page.waitForTimeout(300);
      }

      assert.equal(
        await readBusinessName(page),
        'Suite13 Migrat Din Vechi',
        'a pre-existing flat hb.draft.v1 record must still resume correctly with no separate migration step'
      );

      // Editing it now must ALSO create a scoped slot (lazy migration), while
      // the legacy mirror keeps working for anything still reading it directly.
      await editBusinessName(page, 'Suite13 Migrat Editat');
      const scopes = await page.evaluate(() => JSON.parse(localStorage.getItem('hb.draft.scopes.v1') || '{}'));
      const scopeValues = Object.values(scopes);
      assert.ok(
        scopeValues.some((v) => v && v.config && v.config.business && v.config.business.name === 'Suite13 Migrat Editat'),
        'the migrated draft must now also live under its own scope slot'
      );
      const mirror = await page.evaluate(() => JSON.parse(localStorage.getItem('hb.draft.v1') || 'null'));
      assert.ok(mirror && mirror.config.business.name === 'Suite13 Migrat Editat', 'the legacy mirror key keeps reflecting this tab\'s draft');

      await page.screenshot({ path: path.join(EVIDENCE, '04-legacy-draft-migrated.png') });
      console.log('PASS suite13 migration: an old single global draft record resumes and is lazily adopted into its own scope');
    } finally {
      await browser.close().catch(() => {});
    }
  });
});
