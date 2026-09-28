'use strict';
/**
 * bot/test/audit27-t-2-history-idb-persist.test.js
 *
 * Task T-2, PLAN-UX-2026-09-27.md §5.3 remainder ("Undo/redo real dincolo de
 * sesiunea curentă" — the part S-3 left open). S-3
 * (audit27-s-3-undo-redo-persist.test.js) made Ctrl+Z survive a reload or an
 * accidental tab close+reopen WITHIN the same browser session, backed by
 * sessionStorage — which is scoped to the browser session by design and is
 * wiped the moment the browser itself is actually closed. This oracle proves
 * the remaining gap is closed: the undo/redo stack (builder/history-store.js,
 * now IndexedDB-backed with a localStorage fallback) survives a FULLY closed
 * and reopened browser, for the SAME signed-in account, while still never
 * leaking to a different account, always clearing on logout, and always
 * expiring after 7 days.
 *
 * "Closed and reopened browser" is modeled the way Playwright recommends:
 * capture the context's storageState (cookies + localStorage + IndexedDB —
 * `indexedDB: true` is required, it is opt-in), close that BrowserContext
 * entirely, then open a brand-new BrowserContext seeded with that same
 * storageState. A brand-new context is a genuinely separate browser-session
 * object in Chromium — nothing survives across it except what storageState
 * explicitly carries — so this is a faithful "close the browser, reopen it
 * later" repro, not a same-context reload.
 *
 * Because sessionStorage is what scopes a not-yet-published LOCAL draft to
 * "this tab" (see TAB_BOUND_SITE_SESSION_KEY / TAB_DRAFT_ID_SESSION_KEY in
 * builder/app.js) and storageState never carries sessionStorage, only a REAL
 * PAID SITE (looked up from the server-side, account-scoped site list, via
 * the dashboard's own "Editează" button — never a URL typed by the test)
 * gives a stable 'site:<id>' scope that a brand-new context can resolve the
 * same way a real customer's new browser session would. This is also the
 * more realistic case: VISION.md §4.6 promises undo/redo persistence "per
 * site și per cont", not per anonymous local draft.
 *
 * Four things this file proves, matching the task's own oracle description:
 *   1. Same account, real browser-close-and-reopen (new context, same
 *      storageState) → Undo resumes and actually reverts to the pre-edit
 *      value.
 *   2. A DIFFERENT account, sharing the same underlying browser/IndexedDB
 *      (a library/shared-computer shape) → sees nothing, at both the real
 *      dashboard layer (never even offered the foreign site) and the
 *      client-side ownership gate directly (defense in depth).
 *   3. After a real "Deconectare", even the SAME account signing back in
 *      again finds nothing to undo — logout genuinely erases the persisted
 *      stack, not just hides it for the rest of that tab's life.
 *   4. An entry older than the 7-day TTL is treated as gone — proven
 *      deterministically by aging Date.now() inside the page (via
 *      page.addInitScript, applied before the next navigation) rather than
 *      either waiting 7 real days or fully virtualizing the page's timers
 *      (which would also freeze the editor's own debounce/autosave/heartbeat
 *      timers and risk an unrelated hang).
 *
 * Local only — HIDOOK_TEST_PAY offline stub, no real Stripe/DNS calls.
 * Run: node --experimental-sqlite --test bot/test/audit27-t-2-history-idb-persist.test.js
 */

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '../..');

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

/** Edit one canvas text field, wait for draft.config to reflect it, then wait
 * past the debounced server-autosave/history-persist settle window (same
 * 1600ms budget audit27-s-3/r-02 use for the same reason). */
async function editField(page, fieldPath, text) {
  const field = page.frameLocator('#preview-iframe').locator(`[data-hb-edit="${fieldPath}"]`).first();
  await field.click({ clickCount: 3 });
  await page.keyboard.type(text, { delay: 12 });
  await field.blur().catch(() => {});
  await page.waitForFunction(
    ({ p, expected }) => {
      if (typeof draft === 'undefined' || !draft.config) return false;
      let v = draft.config;
      for (const part of p.split('.')) { if (v == null) return false; v = v[part]; }
      return v === expected;
    },
    { p: fieldPath, expected: text },
    { timeout: 5000 }
  );
  await page.waitForTimeout(1600);
}

async function readField(page, fieldPath) {
  return page.evaluate((p) => {
    if (typeof draft === 'undefined' || !draft.config) return null;
    let v = draft.config;
    for (const part of p.split('.')) { if (v == null) return null; v = v[part]; }
    return v;
  }, fieldPath);
}

/** Sign in through the dashboard entry point — same dev-magic-link flow
 * every other audit27 oracle uses. A local draft edited before this call
 * resumes straight to #edit once signed in (loadDashboard()'s own
 * behavior for a brand-new account with zero sites yet). */
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
  await Promise.race([page.waitForURL(/#edit$/), page.waitForURL(/#dashboard$/)]);
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

/** Real slug + HIDOOK_TEST_PAY checkout through the UI, same pattern
 * suite12-publish-lifecycle.test.js's publishAndPayThroughUi() uses — the
 * only way to get a REAL, server-tracked 'site:<id>' scope that a brand-new
 * browser context (no sessionStorage carried over) can resolve the same way
 * a real customer's dashboard does. */
async function publishAndPayThroughUi(page, slugPrefix) {
  await page.locator('#btn-publish').click();
  await page.locator('#modal-publish').waitFor({ state: 'visible' });
  const slug = slugPrefix + '-' + crypto.randomUUID().slice(0, 8);
  await page.locator('#input-slug').fill(slug);
  await page.locator('#btn-publish-continue').click();
  await page.locator('#modal-success').waitFor({ state: 'visible' });
  await page.locator('#btn-pay-publish').click();
  await page.waitForURL(/#dashboard$/, { timeout: 20000 });
  await page.locator('#modal-success').waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('#btn-close-success').click().catch(() => {});
  return slug;
}

/** Real "Editează" click from the dashboard's site card — never a direct URL
 * — so the scope this lands on is resolved exactly the way loadSiteForEdit()
 * resolves it for a real customer (site.id from the account-scoped
 * GET /api/sites list, not sessionStorage). */
async function openSiteFromDashboard(page, base) {
  if (!/#dashboard$/.test(page.url())) {
    await page.goto(base + '/app/#dashboard', { waitUntil: 'networkidle' });
  }
  await page.locator('#sites-list .site-card').first().waitFor({ state: 'visible', timeout: 10000 });
  await page.getByRole('button', { name: /Editează site-ul/ }).first().click();
  await page.waitForURL(/#edit$/);
  await page.locator('#preview-iframe').waitFor({ state: 'visible' });
  await page.waitForTimeout(1000);
  if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
    await page.locator('#btn-close-drawer').click().catch(() => {});
    await page.waitForTimeout(300);
  }
}

/** Real "Deconectare" via the editor topbar account menu. */
async function signOutFromEditor(page) {
  await page.locator('#btn-account-menu').click();
  await page.locator('#account-menu').waitFor({ state: 'visible' });
  await page.locator('#account-menu-logout').waitFor({ state: 'visible' });
  await page.locator('#account-menu-logout').click();
  await page.waitForURL(/#templates$/);
}

/** Probes historyStoreLoad() directly in-page — the same client-side
 * ownership gate S-3's "gate only" check exercises, used here as a second,
 * independent line of evidence alongside the real-UI dashboard check. */
async function probeHistoryLoad(page, scopeKey, ownerUserId) {
  return page.evaluate(({ sk, oid }) => historyStoreLoad(sk, oid), { sk: scopeKey, oid: ownerUserId });
}

test('T-2: same account resumes undo history after a real browser close+reopen (new context, same storageState)', async () => {
  const shotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-t-2-sameacct-shots-'));
  const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));

  await withServer({
    HIDOOK_TEST_PAY: '1',
    HIDOOK_ISOLATED_DEPLOY: '1',
    NODE_ENV: 'test',
    DATA_DIR: freshTmpDataDir('audit27-t-2-'),
    SERVER_SECRET: 'audit27-t-2-' + crypto.randomBytes(8).toString('hex'),
  }, async (base) => {
    const browser = await chromium.launch({ headless: true });
    const emailA = 'audit27-t2-a-' + crypto.randomUUID().slice(0, 8) + '@example.com';

    // ---- Phase 1: account A edits a real, paid site's canvas 3 times,
    // creating 3 undo steps, then closes the browser entirely. ----
    const context1 = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    let storageStateAfterA;
    let scopeKeyOfSite;
    let name0;
    let tagline0;
    try {
      const page = await context1.newPage();
      page.setDefaultTimeout(30000);
      await acceptCookiesAndStart(page, base, 'local-service');
      await editField(page, 'business.name', 'T2 Nume Inainte De Inchidere');
      await signIn(page, emailA);
      await publishAndPayThroughUi(page, 'audit27-t2');
      await openSiteFromDashboard(page, base);

      name0 = await readField(page, 'business.name');
      tagline0 = await readField(page, 'business.tagline');
      assert.ok(name0, 'business.name must have preset/published text to begin with');
      assert.ok(tagline0, 'business.tagline must have preset/published text to begin with');

      await editField(page, 'business.name', 'T2 Nume Dupa Inchidere Unu');
      await editField(page, 'business.tagline', 'T2 Tagline Dupa Inchidere Doi');

      scopeKeyOfSite = await page.evaluate(() => (typeof currentScopeKey === 'function' ? currentScopeKey() : null));
      assert.match(scopeKeyOfSite || '', /^site:/, 'a real paid site must scope to site:<id>, not a local draft');

      const beforeClose = await page.evaluate(() => ({ index: historyState.index, length: historyState.stack.length }));
      assert.ok(beforeClose.length >= 3, `expected baseline + 2 edits, got stack length ${beforeClose.length}`);

      await page.screenshot({ path: path.join(shotDir, '01-account-a-edited-before-close.png') });

      // Capture cookies + localStorage + IndexedDB — indexedDB:true is
      // opt-in (Playwright does not snapshot it by default).
      storageStateAfterA = await context1.storageState({ indexedDB: true });
      const idbEntry = (storageStateAfterA.origins || []).find((o) => Array.isArray(o.indexedDB) && o.indexedDB.length);
      assert.ok(idbEntry, 'storageState({ indexedDB: true }) must capture at least one IndexedDB database for this origin');
    } finally {
      // ---- THE ACTUAL "close the browser" step. ----
      await context1.close();
    }

    // ---- Phase 2: a BRAND-NEW BrowserContext, seeded with that exact
    // storageState — a faithful "reopen the browser later" repro, sharing
    // nothing with context1 except what storageState explicitly carried. ----
    const context2 = await browser.newContext({ viewport: { width: 1440, height: 1000 }, storageState: storageStateAfterA });
    try {
      const page2 = await context2.newPage();
      page2.setDefaultTimeout(30000);
      // Still signed in as account A purely via the restored cookie — no
      // magic-link step here, exactly like a customer who never logged out.
      await openSiteFromDashboard(page2, base);

      const scopeKeyAfterReopen = await page2.evaluate(() => (typeof currentScopeKey === 'function' ? currentScopeKey() : null));
      assert.equal(scopeKeyAfterReopen, scopeKeyOfSite, 'the reopened browser must resolve to the SAME site scope (server-side site id, not a tab-local id)');

      assert.equal(await readField(page2, 'business.name'), 'T2 Nume Dupa Inchidere Unu', 'the edited value itself must survive the close+reopen (ordinary draft persistence)');

      const afterReopen = await page2.evaluate(() => ({ index: historyState.index, length: historyState.stack.length }));
      assert.ok(afterReopen.length >= 3, `the persisted undo stack must be RESUMED after a real browser close+reopen, got stack length ${afterReopen.length}`);

      const undoBtn = page2.locator('#btn-undo');
      assert.equal(await undoBtn.isDisabled(), false, 'Undo must be enabled right after a browser close+reopen that resumed real history');
      await page2.screenshot({ path: path.join(shotDir, '02-account-a-reopened-history-resumed.png') });

      await undoBtn.click();
      await page2.waitForTimeout(1200);
      assert.equal(await readField(page2, 'business.tagline'), tagline0, 'first undo (after reopen) must revert the LAST step (the tagline edit) back to the pre-edit value');
      assert.equal(await readField(page2, 'business.name'), 'T2 Nume Dupa Inchidere Unu', 'first undo must not disturb the earlier (still-intact) name edit');
      await undoBtn.click();
      await page2.waitForTimeout(1200);
      assert.equal(await readField(page2, 'business.name'), name0, 'undoing all the way after a real browser close+reopen must restore the published baseline value (which already carried the pre-signin edit)');
      await page2.screenshot({ path: path.join(shotDir, '03-account-a-reopened-after-undo.png') });

      console.log('PASS audit27-t-2 (same-account close+reopen): screenshots at', shotDir);
    } finally {
      await context2.close();
    }
  });
});

test('T-2: a different account never resumes another account\'s undo history, and logging out erases it for good', async () => {
  const shotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-t-2-crossacct-logout-shots-'));
  const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));

  await withServer({
    HIDOOK_TEST_PAY: '1',
    HIDOOK_ISOLATED_DEPLOY: '1',
    NODE_ENV: 'test',
    DATA_DIR: freshTmpDataDir('audit27-t-2-xacct-'),
    SERVER_SECRET: 'audit27-t-2-xacct-' + crypto.randomBytes(8).toString('hex'),
  }, async (base) => {
    const browser = await chromium.launch({ headless: true });
    const emailA = 'audit27-t2b-a-' + crypto.randomUUID().slice(0, 8) + '@example.com';
    const emailB = 'audit27-t2b-b-' + crypto.randomUUID().slice(0, 8) + '@example.com';
    const secretMarker = 'ISTORIC-PRIVAT-T2-' + crypto.randomUUID().slice(0, 8);

    // ---- Account A publishes a real site and edits a private marker,
    // leaving a persisted, account-A-owned undo step behind. ----
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    let accountAId;
    let scopeKeyOfSite;
    try {
      const pageA = await context.newPage();
      pageA.setDefaultTimeout(30000);
      await acceptCookiesAndStart(pageA, base, 'product-menu');
      await signIn(pageA, emailA);
      await publishAndPayThroughUi(pageA, 'audit27-t2b');
      await openSiteFromDashboard(pageA, base);
      await editField(pageA, 'business.name', secretMarker);

      scopeKeyOfSite = await pageA.evaluate(() => (typeof currentScopeKey === 'function' ? currentScopeKey() : null));
      accountAId = await pageA.evaluate(() => (typeof currentUser !== 'undefined' && currentUser && currentUser.id) || null);
      assert.ok(accountAId, 'account A must actually be signed in for this repro to mean anything');
      assert.match(scopeKeyOfSite || '', /^site:/);

      // Sanity: the record really is there, stamped to A, before we probe
      // account B's view of it below.
      const selfLoad = await probeHistoryLoad(pageA, scopeKeyOfSite, accountAId);
      assert.ok(selfLoad && Array.isArray(selfLoad.entries) && selfLoad.entries.length, 'sanity check: account A must be able to load its own persisted history before logout');
      await pageA.screenshot({ path: path.join(shotDir, '01-account-a-history-has-marker.png') });

      // =====================================================================
      // Part 1: real "Deconectare" (this is a prerequisite for Part 2 below,
      // not just its own check — a browser CONTEXT here shares one cookie
      // jar across every tab, exactly like a real browser profile, so a
      // second account can only sign in for real once A's session is
      // actually gone; that single-session-per-profile shape is itself the
      // product's real security boundary between accounts sharing a device,
      // and matches audit27-r-02's own repro order). ----
      // =====================================================================
      await signOutFromEditor(pageA);
      await pageA.screenshot({ path: path.join(shotDir, '02-account-a-after-logout.png') });

      // =====================================================================
      // Part 2: a DIFFERENT account, SAME underlying browser/IndexedDB
      // (shared/library-computer shape — a brand-new tab in the same,
      // now-signed-out context), signs in as B.
      // =====================================================================
      const pageB = await context.newPage();
      pageB.setDefaultTimeout(30000);
      await pageB.goto(base + '/app/#dashboard', { waitUntil: 'networkidle' });
      await pageB.locator('#btn-dashboard-auth').click();
      await pageB.locator('#form-auth-email').waitFor({ state: 'visible' });
      await pageB.locator('#input-email').fill(emailB);
      await pageB.locator('#btn-send-magic').click();
      await pageB.locator('#dev-link').waitFor({ state: 'visible' });
      await pageB.locator('#dev-link').click();
      await pageB.waitForTimeout(800);

      // Real-UI check: B's own dashboard must never even offer A's site —
      // ownership is enforced server-side (GET /api/sites is account-scoped),
      // before the client-side history gate below is ever reached. B is a
      // brand-new account with zero sites of its own, so the dashboard must
      // show the empty state, not any site card.
      const siteCardCountB = await pageB.locator('#sites-list .site-card').count();
      assert.equal(siteCardCountB, 0, 'account B\'s dashboard must list zero sites — it must never see account A\'s site');
      const emptyStateVisible = await pageB.getByText('Nu ai creat încă niciun site').isVisible().catch(() => false);
      assert.equal(emptyStateVisible, true, 'account B must see the empty-dashboard state, confirming the dashboard actually loaded (not just an empty list from a stalled request)');
      await pageB.screenshot({ path: path.join(shotDir, '03-account-b-dashboard-no-foreign-site.png') });

      // Client-side gate, defense in depth: even given the exact scope key
      // (which B has no real way to discover through the product UI),
      // historyStoreLoad() must still refuse it for B's account id.
      const accountBId = await pageB.evaluate(() => (typeof currentUser !== 'undefined' && currentUser && currentUser.id) || null);
      assert.ok(accountBId && accountBId !== accountAId, 'account B must be a genuinely different signed-in account');
      const loadedForB = await probeHistoryLoad(pageB, scopeKeyOfSite, accountBId);
      assert.equal(loadedForB, null, 'historyStoreLoad() must refuse account A\'s record when asked for account B\'s id');

      // A browser context here is one shared cookie jar (like a real browser
      // profile) — only one account can hold the active session at a time,
      // so B must sign out (real "Deconectare", header button — always
      // visible when signed in, not only inside the editor topbar) before A
      // can sign back in below.
      await pageB.locator('#btn-logout').click();
      await pageB.waitForTimeout(500);
      await pageB.close();

      // =====================================================================
      // Part 3: A signs back in AGAIN (same account, same browser, a fresh
      // tab) — the persisted stack must be genuinely gone from logout, not
      // just hidden for the rest of the old tab's life.
      // =====================================================================
      const pageA2 = await context.newPage();
      pageA2.setDefaultTimeout(30000);
      await pageA2.goto(base + '/app/#dashboard', { waitUntil: 'networkidle' });
      await pageA2.locator('#btn-dashboard-auth').click();
      await pageA2.locator('#form-auth-email').waitFor({ state: 'visible' });
      await pageA2.locator('#input-email').fill(emailA);
      await pageA2.locator('#btn-send-magic').click();
      await pageA2.locator('#dev-link').waitFor({ state: 'visible' });
      await pageA2.locator('#dev-link').click();
      await pageA2.waitForTimeout(800);
      await openSiteFromDashboard(pageA2, base);

      const canvasTextAfterRelogin = await pageA2.frameLocator('#preview-iframe').locator('body').innerText().catch(() => '');
      // Ordinary draft persistence (unrelated to the undo STACK) means the
      // site's own last-saved content, including the marker, is still there
      // — that is correct and expected. What must be gone is the ability to
      // step BACK through undo history to before that edit.
      assert.match(canvasTextAfterRelogin, new RegExp(secretMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'sanity: the site\'s own saved content (not the undo stack) is unaffected by logout');
      const undoBtnAfterRelogin = pageA2.locator('#btn-undo');
      assert.equal(await undoBtnAfterRelogin.isDisabled(), true, 'after a real logout, even the SAME account signing back in must find nothing to undo — the persisted stack must have been actually erased, not just hidden');
      await pageA2.screenshot({ path: path.join(shotDir, '04-account-a-relogin-nothing-to-undo.png') });

      console.log('PASS audit27-t-2 (cross-account + post-logout erasure): screenshots at', shotDir);
    } finally {
      await context.close();
    }
  });
});

test('T-2: a persisted undo entry older than the 7-day TTL is treated as gone', async () => {
  const shotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-t-2-ttl-shots-'));
  const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));

  await withServer({
    HIDOOK_TEST_PAY: '1',
    HIDOOK_ISOLATED_DEPLOY: '1',
    NODE_ENV: 'test',
    DATA_DIR: freshTmpDataDir('audit27-t-2-ttl-'),
    SERVER_SECRET: 'audit27-t-2-ttl-' + crypto.randomBytes(8).toString('hex'),
  }, async (base) => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(30000);

      // A plain, unpaid local draft is enough here — the TTL check
      // (historyStoreIsExpired) is scope-agnostic, and this avoids the
      // overhead of a full publish for a check that is about elapsed time,
      // not ownership.
      await acceptCookiesAndStart(page, base, 'local-service');
      await editField(page, 'business.name', 'T2 TTL Editare Recenta');
      await editField(page, 'business.tagline', 'T2 TTL A Doua Editare');

      const beforeAge = await page.evaluate(() => ({ index: historyState.index, length: historyState.stack.length }));
      assert.ok(beforeAge.length >= 3, `expected baseline + 2 edits, got stack length ${beforeAge.length}`);

      // Sanity, real time, no aging yet: an ordinary reload right now must
      // still resume (same contract audit27-s-3 already proves) — this is
      // what rules out the TTL check below being a false positive from some
      // OTHER reason the stack failed to resume.
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('#preview-iframe').waitFor({ state: 'visible' });
      await page.waitForTimeout(1200);
      if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
        await page.locator('#btn-close-drawer').click().catch(() => {});
        await page.waitForTimeout(400);
      }
      const afterFreshReload = await page.evaluate(() => ({ index: historyState.index, length: historyState.stack.length }));
      assert.equal(afterFreshReload.length, beforeAge.length, 'sanity check: a reload with NO time elapsed must still resume the persisted stack');
      assert.equal(await page.locator('#btn-undo').isDisabled(), false, 'sanity check: Undo must be enabled right after the fresh (non-aged) reload');
      await page.screenshot({ path: path.join(shotDir, '01-fresh-reload-still-resumes.png') });

      // ---- Age the clock: override Date.now() to run 8 days ahead, applied
      // via addInitScript so it takes effect from the very start of the NEXT
      // navigation — before history-store.js's own Date.now() calls run —
      // without touching setTimeout/setInterval (leaves the app's own
      // debounce/autosave/heartbeat timers running at real speed, so nothing
      // else in the editor's boot sequence is at risk of hanging). ----
      const EIGHT_DAYS_MS = 8 * 24 * 60 * 60 * 1000;
      await page.addInitScript((deltaMs) => {
        const realNow = Date.now.bind(Date);
        Date.now = () => realNow() + deltaMs;
      }, EIGHT_DAYS_MS);

      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('#preview-iframe').waitFor({ state: 'visible' });
      await page.waitForTimeout(1200);
      if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
        await page.locator('#btn-close-drawer').click().catch(() => {});
        await page.waitForTimeout(400);
      }

      // The site's own content (ordinary draft persistence, unrelated to the
      // undo-stack TTL) must still be exactly as last saved.
      assert.equal(await readField(page, 'business.tagline'), 'T2 TTL A Doua Editare', 'the draft\'s own saved content must be unaffected by the undo-history TTL');

      const afterAgedReload = await page.evaluate(() => ({ index: historyState.index, length: historyState.stack.length }));
      assert.equal(afterAgedReload.length, 1, 'an entry older than the 7-day TTL must be treated as gone — resetHistory() must fall back to a fresh 1-entry baseline, not resume the (now-expired) persisted stack');
      assert.equal(afterAgedReload.index, 0);

      const undoBtn = page.locator('#btn-undo');
      assert.equal(await undoBtn.isDisabled(), true, 'Undo must be disabled once the only persisted history has aged past the 7-day TTL');
      await page.screenshot({ path: path.join(shotDir, '02-aged-8-days-history-expired.png') });

      console.log('PASS audit27-t-2 (7-day TTL expiry): screenshots at', shotDir);
    } finally {
      await context.close();
    }
  });
});
