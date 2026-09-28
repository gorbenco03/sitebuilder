'use strict';
/**
 * bot/test/audit27-s-3-undo-redo-persist.test.js
 *
 * Task S-3, PLAN-UX-2026-09-27.md §5.3 "Undo/redo real dincolo de sesiunea
 * curentă" (04-QA-Evidence/Audit-2026-09-27-b45a3e4/findings-all.json,
 * ux-benchmark lens: "Undo/redo persistent dincolo de sesiune — standard la
 * toți competitorii majori; Hidook îl are doar în sesiunea curentă").
 *
 * Before this fix, resetHistory() (builder/app.js) always started a
 * brand-new one-entry undo/redo baseline on every #edit load, including a
 * plain reload — a reload or an accidental tab close+reopen silently threw
 * away every undo step with no warning to the owner mid-edit.
 *
 * Fix: pushHistory()/undo()/redo() now also persist historyState into
 * sessionStorage (builder/history-store.js), keyed by the same per-draft
 * scope key drafts already use and stamped with the same ownerUserId
 * ownership contract as hb.draft.scopes.v1 (gap-cross-account-draft-leak-
 * depth / R-02). resetHistory() resumes that persisted stack instead of a
 * fresh baseline when the scope+account match and the top entry still
 * matches what was actually just loaded into draft.config.
 *
 * Two things this oracle proves, both against the REAL browser/server, no
 * reimplementation:
 *
 *   1. Edit 3 fields, reload, undo twice restores the earlier values — the
 *      actual task acceptance criterion.
 *   2. A DIFFERENT account signed in on the SAME tab, right after the first
 *      account's real "Deconectare", sees NO trace of that history — same
 *      threat model / same real-UI repro shape as
 *      audit27-r-02-cross-account-draft-isolation.test.js, applied to the
 *      new persisted history store instead of the draft store.
 *
 * Local only — HIDOOK_TEST_PAY offline stub, no real Stripe/DNS calls.
 * Run: node --experimental-sqlite --test bot/test/audit27-s-3-undo-redo-persist.test.js
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

function escapeForRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function acceptCookiesAndStart(page, base, templateId) {
  await page.goto(base + '/app/', { waitUntil: 'networkidle' });
  await page.locator('#hb-cookie-accept').click().catch(() => {});
  await page.locator(`.template-card[data-template-id="${templateId}"] .btn-start-tpl`).click();
  await page.waitForURL(/#edit$/);
  await page.locator('#preview-iframe').waitFor({ state: 'visible' });
  await page.waitForTimeout(1200);
  if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
    await page.locator('#btn-close-drawer').click().catch(() => {});
    await page.waitForTimeout(400);
  }
}

/** Edit one canvas text field by its `data-hb-edit` path, wait for
 * draft.config to actually reflect it, then wait past the debounced
 * server-autosave/history-persist settle window (same 1600ms budget
 * audit27-r-02 uses for the same reason). */
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

/** Real "Deconectare" via the editor topbar account menu — never a raw API call. */
async function signOutFromEditor(page) {
  await page.locator('#btn-account-menu').click();
  await page.locator('#account-menu').waitFor({ state: 'visible' });
  await page.locator('#account-menu-logout').waitFor({ state: 'visible' });
  await page.locator('#account-menu-logout').click();
  await page.waitForURL(/#templates$/);
}

/** Sign in from the dashboard auth form — same real magic-link flow as
 * audit27-r-02, entered directly via /app/#dashboard so it also works for a
 * SECOND account reusing the SAME tab right after the first one signed out. */
async function signInFromDashboard(page, base, email) {
  await page.goto(base + '/app/#dashboard', { waitUntil: 'networkidle' });
  await page.locator('#hb-cookie-accept').click().catch(() => {});
  await page.locator('#btn-dashboard-auth').click();
  await page.locator('#form-auth-email').waitFor({ state: 'visible' });
  await page.locator('#input-email').fill(email);
  await page.locator('#btn-send-magic').click();
  await page.locator('#dev-link').waitFor({ state: 'visible' });
  await page.locator('#dev-link').click();
  await page.waitForTimeout(600);
}

test('edit 3 fields, reload, undo twice restores the earlier values (persisted across the reload)', async () => {
  const shotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-s-3-persist-shots-'));
  const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));

  await withServer({
    HIDOOK_TEST_PAY: '1',
    HIDOOK_ISOLATED_DEPLOY: '1',
    NODE_ENV: 'test',
    DATA_DIR: freshTmpDataDir('audit27-s-3-'),
    SERVER_SECRET: 'audit27-s-3-' + crypto.randomBytes(8).toString('hex'),
  }, async (base) => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.setDefaultTimeout(30000);
    try {
      await acceptCookiesAndStart(page, base, 'local-service');

      const name0 = await readField(page, 'business.name');
      const tagline0 = await readField(page, 'business.tagline');
      const zone0 = await readField(page, 'business.zone');
      assert.ok(name0, 'business.name must have preset text to begin with');
      assert.ok(tagline0, 'business.tagline must have preset text to begin with');
      assert.ok(zone0, 'business.zone must have preset text to begin with');

      // ---- Edit 3 distinct fields — 3 distinct undo steps (each field has
      // its own coalesce key, see pendingHistoryCoalesceKey in app.js). ----
      await editField(page, 'business.name', 'Nume Modificat Unu');
      await editField(page, 'business.tagline', 'Tagline Modificat Doi');
      await editField(page, 'business.zone', 'Zona Modificat Trei');

      const beforeReload = await page.evaluate(() => ({
        index: historyState.index,
        length: historyState.stack.length,
      }));
      assert.ok(beforeReload.length >= 4, `expected baseline + 3 edits, got stack length ${beforeReload.length}`);
      assert.equal(beforeReload.index, beforeReload.length - 1, 'pointer sits at the most recent edit before reload');
      await page.screenshot({ path: path.join(shotDir, '01-three-fields-edited-before-reload.png') });

      // ---- RELOAD — the whole point of this oracle. Before the fix,
      // resetHistory() always started a fresh one-entry baseline here. ----
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('#preview-iframe').waitFor({ state: 'visible' });
      await page.waitForTimeout(1200);
      if (await page.locator('#details-drawer').isVisible().catch(() => false)) {
        await page.locator('#btn-close-drawer').click().catch(() => {});
        await page.waitForTimeout(400);
      }

      assert.equal(await readField(page, 'business.name'), 'Nume Modificat Unu', 'the edited values themselves must survive the reload');
      assert.equal(await readField(page, 'business.tagline'), 'Tagline Modificat Doi');
      assert.equal(await readField(page, 'business.zone'), 'Zona Modificat Trei');

      const afterReload = await page.evaluate(() => ({
        index: historyState.index,
        length: historyState.stack.length,
      }));
      assert.equal(afterReload.length, beforeReload.length, 'the persisted undo stack must be resumed, not reset to a fresh baseline, after a reload');
      assert.equal(afterReload.index, beforeReload.index, 'the pointer must resume at the same position, not reset to 0');

      const undoBtn = page.locator('#btn-undo');
      assert.equal(await undoBtn.isDisabled(), false, 'Undo must be enabled right after a reload that resumed real history');
      await page.screenshot({ path: path.join(shotDir, '02-after-reload-history-resumed.png') });

      // ---- Undo twice — must restore the two most-recently-edited fields'
      // EARLIER values, leaving the first edit (business.name) intact. ----
      await undoBtn.click();
      await page.waitForTimeout(1200);
      assert.equal(await readField(page, 'business.zone'), zone0, 'first undo (after reload) must revert business.zone to its pre-edit value');
      assert.equal(await readField(page, 'business.tagline'), 'Tagline Modificat Doi', 'first undo must not touch the earlier tagline edit yet');
      await page.screenshot({ path: path.join(shotDir, '03-after-first-undo.png') });

      await undoBtn.click();
      await page.waitForTimeout(1200);
      assert.equal(await readField(page, 'business.tagline'), tagline0, 'second undo (after reload) must revert business.tagline to its pre-edit value');
      assert.equal(await readField(page, 'business.name'), 'Nume Modificat Unu', 'second undo must leave the first (name) edit in place');
      await page.screenshot({ path: path.join(shotDir, '04-after-second-undo.png') });

      console.log('PASS audit27-s-3 (reload persistence): screenshots at', shotDir);
    } finally {
      await browser.close().catch(() => {});
    }
  });
});

test('logout clears this tab\'s persisted history, and a different account in another tab of the same browser sees none of it', async () => {
  const shotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit27-s-3-crossaccount-shots-'));
  const { chromium } = require(path.join(ROOT, 'node_modules/playwright'));

  await withServer({
    HIDOOK_TEST_PAY: '1',
    HIDOOK_ISOLATED_DEPLOY: '1',
    NODE_ENV: 'test',
    DATA_DIR: freshTmpDataDir('audit27-s-3-xacct-'),
    SERVER_SECRET: 'audit27-s-3-xacct-' + crypto.randomBytes(8).toString('hex'),
  }, async (base) => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    try {
      const emailA = 'audit27-s3-a-' + crypto.randomUUID().slice(0, 8) + '@example.com';
      const emailB = 'audit27-s3-b-' + crypto.randomUUID().slice(0, 8) + '@example.com';
      const secretMarker = 'ISTORIC-PRIVAT-CONT-A-' + crypto.randomUUID().slice(0, 8);

      // ---- Account A: start a design, sign in, edit a private marker into
      // the canvas (creating a persisted, account-A-owned undo step), then
      // sign out via the real "Deconectare" menu item, in its OWN tab —
      // this is the exact scenario historyStoreClearOwned() exists for
      // (clearOwnedLocalDraftState() in builder/app.js). ----
      const pageA = await context.newPage();
      pageA.setDefaultTimeout(30000);
      await acceptCookiesAndStart(pageA, base, 'product-menu');
      await signInFromDashboard(pageA, base, emailA);
      await pageA.goto(base + '/app/#edit', { waitUntil: 'networkidle' });
      await pageA.locator('#preview-iframe').waitFor({ state: 'visible' });
      await pageA.waitForTimeout(1000);
      if (await pageA.locator('#details-drawer').isVisible().catch(() => false)) {
        await pageA.locator('#btn-close-drawer').click().catch(() => {});
        await pageA.waitForTimeout(300);
      }
      await editField(pageA, 'business.name', secretMarker);

      const accountAId = await pageA.evaluate(() => (typeof currentUser !== 'undefined' && currentUser && currentUser.id) || null);
      assert.ok(accountAId, 'account A must actually be signed in for this repro to mean anything');

      const historyDumpAfterA = await pageA.evaluate(() => sessionStorage.getItem('hb.history.v1') || '');
      assert.match(
        historyDumpAfterA,
        new RegExp(escapeForRegExp(secretMarker)),
        'sanity check: the persisted history store must actually hold account A\'s edit before logout'
      );
      assert.match(
        historyDumpAfterA,
        new RegExp(escapeForRegExp(accountAId)),
        'sanity check: the persisted record must be stamped with account A\'s id'
      );
      await pageA.screenshot({ path: path.join(shotDir, '01-account-a-history-has-marker.png') });

      await signOutFromEditor(pageA);
      await pageA.screenshot({ path: path.join(shotDir, '02-account-a-after-real-logout.png') });

      // ---- Storage-level check, in A's OWN tab, right after the real
      // logout, no reload in between: doLogout() -> clearOwnedLocalDraftState()
      // -> historyStoreClearOwned() must have already scrubbed A's record. ----
      const historyDumpAfterLogout = await pageA.evaluate(() => sessionStorage.getItem('hb.history.v1') || '');
      assert.doesNotMatch(
        historyDumpAfterLogout,
        new RegExp(escapeForRegExp(secretMarker)),
        'logout must clear account A\'s persisted undo history from this tab\'s sessionStorage'
      );
      // ...and the toolbar itself must reflect it — nothing left to undo,
      // in this same tab, immediately after logout.
      assert.equal(await pageA.locator('#btn-undo').isDisabled(), true, 'Undo must be disabled in this tab immediately after logout — no lingering in-memory history either');
      await pageA.close();

      // ---- A genuinely different tab of the SAME browser context (shares
      // localStorage/cookies, but sessionStorage starts empty — same
      // "genuinely fresh tab" shape as audit27-r-02's own repro) signs in
      // as a DIFFERENT account and opens /app/#edit. ----
      const pageB = await context.newPage();
      pageB.setDefaultTimeout(30000);
      await signInFromDashboard(pageB, base, emailB);
      await pageB.goto(base + '/app/#edit', { waitUntil: 'networkidle' });
      await pageB.waitForTimeout(800);
      await pageB.screenshot({ path: path.join(shotDir, '03-account-b-fresh-tab-edit-route.png') });

      const canvasText = await pageB.frameLocator('#preview-iframe').locator('body').innerText().catch(() => '');
      assert.doesNotMatch(
        canvasText,
        new RegExp(escapeForRegExp(secretMarker)),
        'account B\'s editor canvas must never show account A\'s private marker'
      );
      const undoBtnB = pageB.locator('#btn-undo');
      assert.equal(await undoBtnB.isDisabled(), true, 'account B must start with nothing to undo — no inherited history from A');

      const historyDumpForB = await pageB.evaluate(() => sessionStorage.getItem('hb.history.v1') || '');
      assert.doesNotMatch(
        historyDumpForB,
        new RegExp(escapeForRegExp(secretMarker)),
        'account B must never see account A\'s marker anywhere in the persisted history store'
      );

      // ---- Narrow, deterministic gate check on the shipped functions
      // themselves (same pattern as audit27-r-02's "gate only" test): even if
      // a record for A's old scope key somehow survived, historyStoreLoad()
      // must refuse to hand it to a DIFFERENT signed-in account. ----
      const gateResult = await pageB.evaluate((accId) => {
        const scopeKey = 'local:seeded-for-gate-check';
        const seeded = { ownerUserId: 'seeded-foreign-account-id', index: 0, entries: [{ json: '{"x":1}', size: 8 }], updatedAt: Date.now() };
        const all = JSON.parse(sessionStorage.getItem('hb.history.v1') || '{}');
        all[scopeKey] = seeded;
        sessionStorage.setItem('hb.history.v1', JSON.stringify(all));
        const loadedForRealAccount = historyStoreLoad(scopeKey, accId);
        const loadedForForeignOwner = historyStoreLoad(scopeKey, 'seeded-foreign-account-id');
        // Clean up the seeded probe record so it doesn't leak into other assertions.
        const all2 = JSON.parse(sessionStorage.getItem('hb.history.v1') || '{}');
        delete all2[scopeKey];
        sessionStorage.setItem('hb.history.v1', JSON.stringify(all2));
        return { loadedForRealAccount, loadedForForeignOwner: !!loadedForForeignOwner };
      }, accountAId);
      assert.equal(gateResult.loadedForRealAccount, null, 'historyStoreLoad() must refuse a record stamped to a DIFFERENT account than the one asking');
      assert.equal(gateResult.loadedForForeignOwner, true, 'sanity check: the SAME owner id must still be able to read its own seeded record');

      await pageB.screenshot({ path: path.join(shotDir, '04-account-b-final-state-clean.png') });
      console.log('PASS audit27-s-3 (cross-account isolation): screenshots at', shotDir);
    } finally {
      await browser.close().catch(() => {});
    }
  });
});
